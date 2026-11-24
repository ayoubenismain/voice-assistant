# ISSATSO+ Timetable API

A local FastAPI service that downloads the ISSATSO (University of Sousse) timetable workbook once a
week, validates and normalizes it into SQLite, and serves it to a voice assistant
("What do I have tomorrow?", "Which room is my next lesson in?").

## How it works

```
ISSATSO+ API (Bearer token) ──► discover latest .xls path + effective date
                                      │
public storage (no login) ──────► download workbook ──► validate file (size, signature, sheet)
                                                              │
                                    stateful parser ──► validation report ──► atomic snapshot swap
                                                                                   │
                      FastAPI /api/v1  ◄──── SQLite (classes, subgroups, lessons, sync_metadata)
```

* **One API call per sync, not 99**: the single workbook holds every class.
* **Last known good data is never destroyed**: a failed download, malformed workbook, or suspiciously
  small result (< 50 % of the current lesson count) leaves the database untouched; only status fields change.
* **Unchanged workbook** (same SHA-256) → database is not rewritten.
* The workbook is a **recurring weekly pattern**: a date is mapped to its weekday (Africa/Tunis);
  responses include `timetable_effective_from` and `last_synced_at`.

```
app/
  main.py  config.py  database.py  deps.py  scheduler.py  cli.py  timeutil.py  exceptions.py
  models/      class_model, subgroup, lesson, sync_metadata
  schemas/     timetable, class_schema, sync_schema
  api/routes/  health, classes, timetables, synchronization
  services/    auth, issatso_client, excel_parser, validation, html_parser (experimental),
               timetable_service, sync_service
tests/         parser, API, date logic, sync (mocked HTTP; ISSATSO+ is never contacted)
```

## Installation (macOS)

```bash
cd timetable_api
python3 -m venv .venv            # needs Python 3.11+  (brew install python@3.12 if needed)
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env             # then edit .env
```

## Configuration (`.env`)

| Variable | Purpose | Default |
|---|---|---|
| `ISSATSO_BEARER_TOKEN` | Your current Bearer token (never logged) | – |
| `DISCOVERY_CLASS` | Class used to read the workbook metadata | `LSI-A3-02` |
| `FALLBACK_WORKBOOK_URL` | Direct `.xls` URL if discovery fails | empty |
| `EXCEL_SHEET_NAME` | Expected worksheet (empty = first sheet) | `E-02EditionParGroupeS1ouS2` |
| `STUDENT_CLASS` / `STUDENT_SUBGROUP` | Used by `/api/v1/me/...` | – |
| `ADMIN_SECRET` | Required header for `POST /sync/run`; unset = endpoint disabled | – |
| `HOST` / `PORT` | Bind address (keep `127.0.0.1`) | `127.0.0.1` / `8000` |
| `CORS_ORIGINS` | Comma-separated allowed origins; empty = off | empty |
| `DATABASE_URL` | SQLAlchemy URL | `sqlite:///./data/timetable.db` |
| `SCHEDULER_ENABLED`, `SYNC_WEEKDAY`, `SYNC_HOUR`, `SYNC_MINUTE` | Weekly job (Africa/Tunis) | `true`, `mon`, `8`, `0` |
| `SYNC_ON_STARTUP` | Also sync right after the server starts | `false` |

### Getting a Bearer token

Use only your own, authorized student account:

1. Log in to ISSATSO+ in your browser.
2. Open Developer Tools → Network, open your timetable page, and select the request to
   `.../api/student/timetable/<class>`.
3. Copy the value after `Bearer ` in the `Authorization` request header into `ISSATSO_BEARER_TOKEN`.

The token is short-lived. When it expires, sync fails with `upstream_auth_failed` (the service does not
retry authentication failures) and the **existing timetable keeps being served**; paste a fresh token and
re-run. The workbook itself is public, so setting `FALLBACK_WORKBOOK_URL` lets sync continue
even with an expired token (you must update that URL when a new workbook is published).
Authentication lives behind `services/auth.py`'s `TokenProvider`, so automatic renewal through the official
login flow can be added later without touching the rest of the code.

## First synchronization

```bash
python -m app.cli sync            # add --force to rewrite even if the workbook hash is unchanged
```

It prints the validation report (parent groups, subgroups, lessons, skipped/malformed rows, missing
fields, unexpected days). Exit code is non-zero on failure.

## Running

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
# docs: http://127.0.0.1:8000/docs
```

> **The weekly job only runs while this process is running.** APScheduler lives inside the API process:
> if your Mac is asleep or the service is stopped at the scheduled time, APScheduler will run the missed job
> on the next start only within a 6-hour grace window. Otherwise run `python -m app.cli sync`,
> use `SYNC_ON_STARTUP=true`, or call the manual endpoint. For permanent use, run it under `launchd`.

## Endpoints

```bash
curl localhost:8000/health
curl localhost:8000/api/v1/classes
curl localhost:8000/api/v1/classes/LSI-A3-02/subgroups
curl "localhost:8000/api/v1/classes/LSI-A3-02/today?subgroup=LSI-A3-02-1"
curl localhost:8000/api/v1/classes/LSI-A3-02/week
curl "localhost:8000/api/v1/classes/LSI-A3-02/date/2026-11-19?subgroup=LSI-A3-02-1"
curl localhost:8000/api/v1/classes/LSI-A3-02/next            # next lesson(s): teacher + room
curl localhost:8000/api/v1/me/timetable/{today,tomorrow,week,next}
curl localhost:8000/api/v1/sync/status
curl -X POST localhost:8000/api/v1/sync/run -H "X-Admin-Secret: $ADMIN_SECRET"   # ?force=true
```

* Without `subgroup`, **all subgroups' lessons are returned**, each tagged with `subgroup_code`.
* Lessons are sorted by start time; simultaneous lessons (different subgroups/regimes such as Z1/Z2/QA/QB/H)
  are all kept. Regimes are returned as-is, not interpreted.
* Empty days return `200` with `lessons: []`. Before the first sync, responses have `synchronized: false`
  and an explanatory `message`.
* Errors share one shape: `{"error": {"code": "...", "message": "...", "details": ...}}`
  (`not_found` 404, `invalid_parameters` 422, `unauthorized` 401, `forbidden` 403, `sync_in_progress` 409,
  `validation_failed` / `invalid_workbook` 422, `upstream_auth_failed` / `upstream_error` / `download_failed` 502).

## Tests

```bash
pytest -v
```

All HTTP is mocked (`httpx.MockTransport`); no network or token needed. Fixtures build representative
workbooks on the fly with openpyxl. See "Known limitations" about real-workbook verification.

## Security notes

* Binds to `127.0.0.1`; secrets only in `.env` (git-ignored); the token is never logged, never put in
  error messages, and never sent to the storage host.
* The download URL is built from metadata but must stay on the ISSATSO host and may not contain `..`.
* `POST /sync/run` needs `X-Admin-Secret` (constant-time comparison) and is disabled if unset.
* For online deployment: put it behind a TLS reverse proxy, set `HOST` appropriately, restrict CORS, use
  PostgreSQL via `DATABASE_URL`, and run a single worker (the scheduler lives in-process).

## Known limitations

* The parser was written from the column description in the project brief; the **real `.xls` was not
  available** during development. Run `python -m app.cli sync` on the real workbook and inspect the printed
  report (malformed rows, unexpected days). Columns are located by header name, with A–O positions as fallback.
* `tests/fixtures/timetable_response.json` is synthetic (built from the metadata in the brief). Replace it with a
  sanitized real response (never include tokens) and extend `tests/test_sync.py`.
* `services/html_parser.py` is a generic table extractor only and is not wired into synchronization, because the real
  HTML structure has not been inspected.
