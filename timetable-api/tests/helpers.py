"""Test helpers: fake ISSATSO+ upstream and settings factory."""
import json
from pathlib import Path

import httpx

from app.config import Settings
from app.services.issatso_client import IssatsoClient
from tests.workbook import SHEET, build_workbook, lesson, sample_rows, _row  # noqa: F401

TOKEN = "test-token-123"
FIXTURES = Path(__file__).parent / "fixtures"


class FakeUpstream:
    """Mocks both the authenticated API and the public storage download."""

    def __init__(self, workbook: bytes | None = None):
        self.workbook = workbook or build_workbook()
        self.api_status = 200
        self.download_status = 200
        self.download_body: bytes | None = None  # override raw body (e.g. HTML error page)
        self.valid_token = TOKEN
        self.requests: list[httpx.Request] = []
        self.api_json = json.loads((FIXTURES / "timetable_response.json").read_text())

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path.startswith("/bo/public/api/student/timetable/"):
            if request.headers.get("authorization") != f"Bearer {self.valid_token}":
                return httpx.Response(401, json={"message": "Unauthenticated."})
            if self.api_status != 200:
                return httpx.Response(self.api_status, json={"message": "error"})
            return httpx.Response(200, json=self.api_json)
        if request.url.path.startswith("/bo/storage/app/public/"):
            if self.download_status != 200:
                return httpx.Response(self.download_status, text="error")
            return httpx.Response(200, content=self.download_body if self.download_body is not None else self.workbook)
        return httpx.Response(404)

    def api_calls(self):
        return [r for r in self.requests if "/api/student/timetable/" in r.url.path]

    def download_calls(self):
        return [r for r in self.requests if r.url.path.startswith("/bo/storage/")]

    def client_factory(self, settings):
        return lambda: IssatsoClient(settings, transport=httpx.MockTransport(self.handler), sleep=lambda s: None)


def make_settings(tmp_path, **over) -> Settings:
    base = dict(_env_file=None, issatso_bearer_token=TOKEN, database_url=f"sqlite:///{tmp_path / 'test.db'}",
                scheduler_enabled=False, student_class="LSI-A3-02", student_subgroup="LSI-A3-02-1",
                admin_secret="adm1n", min_request_interval_seconds=0, http_backoff_base_seconds=0,
                http_max_retries=2, discovery_class="LSI-A3-02")
    base.update(over)
    return Settings(**base)
