from datetime import date, datetime, timezone

from app.timeutil import as_local, weekday_index
from tests.conftest import TUNIS


def test_weekday_index():
    assert weekday_index(date(2026, 11, 19)) == 4  # Thursday
    assert weekday_index(date(2026, 11, 22)) == 7  # Sunday


def test_today_uses_tunis_not_utc(synced, app):
    # 23:30 UTC on Thursday is already 00:30 Friday in Tunis (UTC+1, no DST)
    app.state.clock = lambda: datetime(2026, 11, 19, 23, 30, tzinfo=timezone.utc).astimezone(TUNIS)
    body = synced.get("/api/v1/classes/ING-A1-01/today").json()
    assert body["weekday"] == "Friday" and body["date"] == "2026-11-20"
    assert body["lesson_count"] == 1


def test_as_local_converts_naive_utc():
    assert as_local(datetime(2026, 11, 19, 8, 0), "Africa/Tunis").hour == 9
    assert as_local(None, "Africa/Tunis") is None


def test_sunday_is_empty_not_error(synced):
    r = synced.get("/api/v1/classes/LSI-A3-02/date/2026-11-22")
    assert r.status_code == 200 and r.json()["lessons"] == [] and r.json()["weekday"] == "Sunday"


def test_invalid_date_rejected(synced):
    r = synced.get("/api/v1/classes/LSI-A3-02/date/2026-13-45")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_parameters"
