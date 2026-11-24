def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["database"] == "ok"


def test_unsynchronized_is_explicit(client):
    body = client.get("/api/v1/classes/LSI-A3-02/today").json()
    assert body["synchronized"] is False and body["lessons"] == [] and "not been synchronized" in body["message"]
    assert client.get("/api/v1/classes").json() == {"synchronized": False, "classes": []}


def test_list_classes_and_subgroups(synced):
    body = synced.get("/api/v1/classes").json()
    assert {c["class_code"] for c in body["classes"]} == {"ING-A1-01", "LSI-A3-02"}
    lsi = next(c for c in body["classes"] if c["class_code"] == "LSI-A3-02")
    assert lsi["subgroups"] == ["LSI-A3-02-1", "LSI-A3-02-2"]
    r = synced.get("/api/v1/classes/LSI-A3-02/subgroups").json()
    assert r == {"class_code": "LSI-A3-02", "subgroups": ["LSI-A3-02-1", "LSI-A3-02-2"]}


def test_today_all_subgroups_tags_each_lesson(synced):  # Thursday
    body = synced.get("/api/v1/classes/LSI-A3-02/today").json()
    assert body["subgroup"] is None and body["weekday"] == "Thursday" and body["synchronized"] is True
    assert body["timetable_effective_from"] == "2026-11-17" and body["last_synced_at"]
    assert [(l["start_time"], l["subgroup_code"]) for l in body["lessons"]] == [
        ("08:30", "LSI-A3-02-1"), ("10:15", "LSI-A3-02-1"), ("14:00", "LSI-A3-02-2")]  # chronological


def test_filter_by_parent_class(synced):
    body = synced.get("/api/v1/classes/ING-A1-01/week").json()
    assert {l["class_code"] for d in body["days"] for l in d["lessons"]} == {"ING-A1-01"}


def test_filter_by_subgroup(synced):
    body = synced.get("/api/v1/classes/LSI-A3-02/today?subgroup=LSI-A3-02-2").json()
    assert body["subgroup"] == "LSI-A3-02-2"
    assert [l["subject_code"] for l in body["lessons"]] == ["1803"]
    assert synced.get("/api/v1/classes/LSI-A3-02/date/2026-11-19?subgroup=LSI-A3-02-1").json()["lesson_count"] == 2


def test_unknown_class_and_subgroup(synced):
    r = synced.get("/api/v1/classes/NOPE-1-1/today")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert synced.get("/api/v1/classes/LSI-A3-02/today?subgroup=ING-A1-01-1").status_code == 404
    assert synced.get("/api/v1/classes/bad%20code/today").status_code == 422


def test_week(synced):
    body = synced.get("/api/v1/classes/LSI-A3-02/week").json()
    assert [d["weekday"] for d in body["days"]] == ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    counts = {d["weekday"]: d["lesson_count"] for d in body["days"]}
    assert counts == {"Monday": 4, "Tuesday": 0, "Wednesday": 0, "Thursday": 3, "Friday": 0, "Saturday": 0}


def test_empty_day_returns_empty_list(synced):  # Wednesday 2026-11-18
    r = synced.get("/api/v1/classes/LSI-A3-02/date/2026-11-18")
    assert r.status_code == 200
    body = r.json()
    assert body["lessons"] == [] and body["lesson_count"] == 0 and body["weekday"] == "Wednesday"


def test_duplicate_regimes_returned(synced):
    body = synced.get("/api/v1/classes/LSI-A3-02/date/2026-11-23?subgroup=LSI-A3-02-1").json()  # Monday
    assert sorted(l["regime"] for l in body["lessons"] if l["start_time"] == "08:30") == ["Z1", "Z2"]


def test_personal_endpoints(synced):
    today = synced.get("/api/v1/me/timetable/today").json()
    assert today["class_code"] == "LSI-A3-02" and today["subgroup"] == "LSI-A3-02-1" and today["lesson_count"] == 2
    week = synced.get("/api/v1/me/timetable/week").json()
    assert week["subgroup"] == "LSI-A3-02-1"
    assert synced.get("/api/v1/me/timetable/tomorrow").json()["weekday"] == "Friday"


def test_personal_not_configured(client, app):
    app.state.settings.student_class = None
    r = client.get("/api/v1/me/timetable/today")
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_request"


def test_next_lesson_today_then_following_week(synced, app):
    nxt = synced.get("/api/v1/me/timetable/next").json()  # now = Thu 09:00
    assert nxt["found"] and nxt["date"] == "2026-11-19" and nxt["start_time"] == "10:15"
    assert nxt["lessons"][0]["teacher"] == "TRABELSI Omar" and nxt["lessons"][0]["room"] == "B07"
    from datetime import datetime
    from tests.conftest import TUNIS
    app.state.clock = lambda: datetime(2026, 11, 19, 20, 0, tzinfo=TUNIS)
    nxt = synced.get("/api/v1/me/timetable/next").json()
    assert nxt["date"] == "2026-11-23" and nxt["start_time"] == "08:30" and len(nxt["lessons"]) == 2
