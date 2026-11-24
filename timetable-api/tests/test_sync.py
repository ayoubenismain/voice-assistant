import json

import pytest

from app.exceptions import DownloadError
from app.models import Lesson
from app.services.issatso_client import build_download_url, extract_metadata
from app.services.sync_service import SyncService
from sqlalchemy import func, select
from tests.helpers import FIXTURES, TOKEN, build_workbook, make_settings, sample_rows
from app.main import create_app
from fastapi.testclient import TestClient


def lesson_count(app):
    with app.state.session_factory() as db:
        return db.scalar(select(func.count()).select_from(Lesson))


# ---------------------------------------------------------------- metadata & URL
def test_extract_metadata_decodes_json_encoded_link():
    meta = extract_metadata(json.loads((FIXTURES / "timetable_response.json").read_text()))
    assert str(meta.effective_from) == "2026-11-17"
    assert meta.download_path == "emplois/November2026/ycCxPpUFuF3auGl2U0h2.xls"
    assert meta.original_name.endswith("S1ouS2.xls")


def test_build_download_url_and_rejections():
    url = build_download_url("https://issatso.rnu.tn", "/bo/storage/app/public/", "emplois/November2026/x.xls")
    assert url == "https://issatso.rnu.tn/bo/storage/app/public/emplois/November2026/x.xls"
    with pytest.raises(DownloadError):
        build_download_url("https://issatso.rnu.tn", "/bo/storage/app/public/", "../../etc/passwd")
    with pytest.raises(DownloadError):
        build_download_url("https://issatso.rnu.tn", "/bo/storage/app/public/", "https://evil.example/x.xls")


# ---------------------------------------------------------------- happy path
def test_first_sync_populates_and_records_metadata(client, app, upstream):
    out = app.state.sync_service.run()
    assert out.status == "success"
    s = client.get("/api/v1/sync/status").json()
    assert s["status"] == "success" and s["number_of_classes"] == 2 and s["number_of_subgroups"] == 3
    assert s["number_of_lessons"] == 8 and s["effective_from"] == "2026-11-17"
    assert s["source_filename"].endswith("S1ouS2.xls") and s["last_synced_at"]
    # token only goes to the API, never to the public storage host
    assert all("authorization" not in r.headers for r in upstream.download_calls())
    assert len(upstream.api_calls()) == 1  # ONE API call, not 99


# ---------------------------------------------------------------- failures keep old data
def test_failed_download_preserves_existing_data(synced, app, upstream):
    before = lesson_count(app)
    upstream.requests.clear()  # ignore the successful download made by the `synced` fixture
    upstream.download_status = 500
    upstream.workbook = build_workbook(sample_rows(2))  # would differ, but never arrives
    out = app.state.sync_service.run()
    assert out.status == "failed" and out.error_code == "upstream_error"
    assert len(upstream.download_calls()) == 2  # retried http_max_retries times with backoff, then gave up
    assert lesson_count(app) == before
    st = synced.get("/api/v1/sync/status").json()
    assert st["status"] == "failed" and st["error_message"] and st["number_of_lessons"] == before
    assert synced.get("/api/v1/classes/LSI-A3-02/today").json()["lesson_count"] == 3


def test_html_error_page_is_not_accepted_as_workbook(synced, app, upstream):
    before = lesson_count(app)
    upstream.download_body = b"<html><body>Not found</body></html>"
    out = app.state.sync_service.run()
    assert out.status == "failed" and out.error_code == "download_failed"
    assert lesson_count(app) == before


def test_wrong_sheet_rejected_and_data_kept(synced, app, upstream):
    before = lesson_count(app)
    upstream.workbook = build_workbook(sheet="Feuil1")
    out = app.state.sync_service.run()
    assert out.status == "failed" and out.error_code == "invalid_workbook"
    assert lesson_count(app) == before


def test_suspiciously_incomplete_workbook_does_not_overwrite(synced, app, upstream):
    before = lesson_count(app)
    upstream.workbook = build_workbook(sample_rows()[:9])  # truncated: far fewer lessons
    out = app.state.sync_service.run()
    assert out.status == "failed" and out.error_code == "validation_failed"
    assert "Existing data kept" in out.message
    assert lesson_count(app) == before


# ---------------------------------------------------------------- authentication
def test_expired_token_fails_clearly_without_retry_or_leak(client, app, upstream):
    upstream.valid_token = "a-different-valid-token"
    out = app.state.sync_service.run()
    assert out.status == "failed" and out.error_code == "upstream_auth_failed"
    assert "expired" in out.message and TOKEN not in out.message
    assert len(upstream.api_calls()) == 1  # no retry loop on 401
    assert TOKEN not in client.get("/api/v1/sync/status").text


def test_missing_token(tmp_path, upstream):
    s = make_settings(tmp_path, issatso_bearer_token=None)
    app = create_app(s, client_factory=upstream.client_factory(s))
    with TestClient(app):
        out = app.state.sync_service.run()
    assert out.status == "failed" and out.error_code == "upstream_auth_failed"
    assert upstream.api_calls() == []  # never even called the API


def test_fallback_url_used_when_discovery_fails(tmp_path, upstream):
    upstream.valid_token = "other"
    s = make_settings(tmp_path, fallback_workbook_url="https://issatso.rnu.tn/bo/storage/app/public/emplois/x/fallback.xls")
    app = create_app(s, client_factory=upstream.client_factory(s))
    with TestClient(app):
        out = app.state.sync_service.run()
    assert out.status == "success"
    assert any("fallback" in w.lower() for w in out.report["warnings"])


# ---------------------------------------------------------------- idempotence & concurrency
def test_unchanged_workbook_does_not_replace_database(synced, app, monkeypatch):
    calls = []
    original = SyncService._replace_snapshot
    monkeypatch.setattr(SyncService, "_replace_snapshot", lambda self, *a, **k: (calls.append(1), original(self, *a, **k))[1])
    out = app.state.sync_service.run()
    assert out.status == "unchanged" and calls == []
    assert app.state.sync_service.run(force=True).status == "success" and calls == [1]


def test_changed_workbook_replaces_snapshot(synced, app, upstream):
    upstream.workbook = build_workbook(sample_rows(2))
    assert app.state.sync_service.run().status == "success"
    assert lesson_count(app) == 9
    assert synced.get("/api/v1/classes/ING-A1-01/date/2026-11-20").json()["lesson_count"] == 2


def test_concurrent_sync_is_rejected(client, app):
    assert app.state.sync_service._lock.acquire(blocking=False)
    try:
        out = app.state.sync_service.run()
    finally:
        app.state.sync_service._lock.release()
    assert out.status == "busy" and out.error_code == "sync_in_progress"


# ---------------------------------------------------------------- admin endpoint protection
def test_sync_run_endpoint_requires_secret(client):
    assert client.post("/api/v1/sync/run").status_code == 401
    assert client.post("/api/v1/sync/run", headers={"X-Admin-Secret": "wrong"}).status_code == 403
    ok = client.post("/api/v1/sync/run", headers={"X-Admin-Secret": "adm1n"})
    assert ok.status_code == 200 and ok.json()["status"] == "success"
    again = client.post("/api/v1/sync/run", headers={"X-Admin-Secret": "adm1n"})
    assert again.json()["status"] == "unchanged"


def test_sync_run_disabled_without_admin_secret(tmp_path, upstream):
    s = make_settings(tmp_path, admin_secret=None)
    with TestClient(create_app(s, client_factory=upstream.client_factory(s))) as c:
        assert c.post("/api/v1/sync/run", headers={"X-Admin-Secret": "x"}).status_code == 403


def test_sync_run_endpoint_failure_is_structured(client, upstream):
    upstream.valid_token = "other"
    r = client.post("/api/v1/sync/run", headers={"X-Admin-Secret": "adm1n"})
    assert r.status_code == 502 and r.json()["error"]["code"] == "upstream_auth_failed"
