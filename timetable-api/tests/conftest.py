from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.helpers import FakeUpstream, make_settings

TUNIS = ZoneInfo("Africa/Tunis")


@pytest.fixture
def upstream():
    return FakeUpstream()


@pytest.fixture
def settings(tmp_path):
    return make_settings(tmp_path)


@pytest.fixture
def app(settings, upstream):
    application = create_app(settings, client_factory=upstream.client_factory(settings))
    # Thursday 2026-11-19, 09:00 in Tunis
    application.state.clock = lambda: datetime(2026, 11, 19, 9, 0, tzinfo=TUNIS)
    return application


@pytest.fixture
def client(app):
    with TestClient(app) as c:  # runs lifespan -> creates tables
        yield c


@pytest.fixture
def synced(client, app):
    outcome = app.state.sync_service.run()
    assert outcome.status == "success", outcome.message
    return client
