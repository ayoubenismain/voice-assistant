"""HTTP client for ISSATSO+: authenticated timetable metadata + public workbook download.

Security: the Bearer token is only sent to the timetable API, never to the storage download, never
logged, and never included in exception messages.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import date
from typing import Any
from urllib.parse import quote, urlparse

import httpx

from app.config import Settings
from app.exceptions import AuthenticationError, DownloadError, UpstreamError
from app.services.auth import StaticTokenProvider, TokenProvider
from app.services.excel_parser import XLS_MAGIC, XLSX_MAGIC

log = logging.getLogger(__name__)


@dataclass
class TimetableMetadata:
    effective_from: date | None
    download_path: str
    original_name: str | None
    html: str | None = None


def extract_metadata(payload: dict) -> TimetableMetadata:
    """Interpret the per-class JSON. `link` is a JSON-encoded string holding a list of files."""
    data = payload.get("data", payload) if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        raise UpstreamError("Unexpected timetable response: no 'data' object.")

    link = data.get("link")
    if isinstance(link, str):
        try:
            link = json.loads(link)
        except json.JSONDecodeError as exc:
            raise UpstreamError("Timetable 'link' field is not valid JSON.") from exc
    if isinstance(link, dict):
        link = [link]
    if not isinstance(link, list) or not link:
        raise UpstreamError("Timetable response has no downloadable workbook link.")

    chosen = next((i for i in link if isinstance(i, dict)
                   and str(i.get("download_link", "")).lower().endswith((".xls", ".xlsx"))), None)
    if chosen is None:
        raise UpstreamError("No .xls/.xlsx file listed in timetable 'link' metadata.")

    effective = None
    if data.get("from"):
        try:
            effective = date.fromisoformat(str(data["from"])[:10])
        except ValueError:
            log.warning("Unparseable 'from' date in timetable metadata")
    return TimetableMetadata(effective, str(chosen["download_link"]), chosen.get("original_name"),
                             data.get("html") if isinstance(data.get("html"), str) else None)


def build_download_url(base_url: str, storage_prefix: str, download_path: str) -> str:
    """Build the public workbook URL, refusing anything that could point off-site or traverse paths."""
    base = urlparse(base_url)
    path = download_path.strip()
    if path.lower().startswith(("http://", "https://")):
        parsed = urlparse(path)
        if parsed.netloc != base.netloc:
            raise DownloadError("Workbook link points to an unexpected host; refusing to download.")
        return path
    path = path.lstrip("/")
    if not path or ".." in path.split("/") or "\\" in path or "\x00" in path:
        raise DownloadError("Workbook link has an invalid path.")
    prefix = "/" + storage_prefix.strip("/") + "/"
    return f"{base.scheme}://{base.netloc}{prefix}{quote(path, safe='/')}"


class IssatsoClient:
    def __init__(self, settings: Settings, token_provider: TokenProvider | None = None,
                 transport: httpx.BaseTransport | None = None, sleep=time.sleep):
        self.s = settings
        self.tokens = token_provider or StaticTokenProvider(settings.issatso_bearer_token)
        self._sleep = sleep
        self._last_request = 0.0
        self._http = httpx.Client(timeout=settings.http_timeout_seconds, transport=transport,
                                  follow_redirects=False)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self) -> None:
        self._http.close()

    # -- internals ----------------------------------------------------------------------
    def _throttle(self) -> None:
        wait = self.s.min_request_interval_seconds - (time.monotonic() - self._last_request)
        if wait > 0:
            self._sleep(wait)
        self._last_request = time.monotonic()

    def _get(self, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
        attempts = max(1, self.s.http_max_retries)
        last_problem = "unknown error"
        for attempt in range(1, attempts + 1):
            self._throttle()
            try:
                resp = self._http.get(url, headers=headers)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_problem = type(exc).__name__  # class name only: no URLs/headers in messages
            else:
                code = resp.status_code
                if code in (401, 403):
                    raise AuthenticationError(
                        f"ISSATSO+ rejected the request (HTTP {code}). The Bearer token is missing, "
                        "expired or not authorised; update ISSATSO_BEARER_TOKEN.")
                if code == 429 or code >= 500:
                    last_problem = f"HTTP {code}"
                    if code == 429:
                        try:
                            self._sleep(min(float(resp.headers.get("Retry-After", 0)), 60))
                        except ValueError:
                            pass
                elif code >= 400:
                    raise UpstreamError(f"ISSATSO+ returned HTTP {code}.")
                else:
                    return resp
            if attempt < attempts:
                delay = self.s.http_backoff_base_seconds * 2 ** (attempt - 1)
                log.warning("Request failed (%s); retry %d/%d in %.1fs", last_problem, attempt, attempts - 1, delay)
                self._sleep(delay)
        raise UpstreamError(f"ISSATSO+ unavailable after {attempts} attempts ({last_problem}).")

    # -- public API ---------------------------------------------------------------------
    def fetch_class_timetable(self, class_code: str) -> dict[str, Any]:
        url = self.s.issatso_base_url.rstrip("/") + self.s.issatso_timetable_path.format(
            class_code=quote(class_code, safe="-_"))
        resp = self._get(url, headers={"Authorization": f"Bearer {self.tokens.get_token()}",
                                       "Accept": "application/json"})
        try:
            return resp.json()
        except ValueError as exc:
            raise UpstreamError("Timetable endpoint did not return JSON.") from exc

    def discover_workbook(self, class_code: str) -> tuple[str, TimetableMetadata]:
        meta = extract_metadata(self.fetch_class_timetable(class_code))
        return build_download_url(self.s.issatso_base_url, self.s.issatso_storage_prefix,
                                  meta.download_path), meta

    def download_workbook(self, url: str) -> bytes:
        """Public download (no Authorization header). Verifies size and that it is really Excel."""
        if not urlparse(url).path.lower().endswith((".xls", ".xlsx")):
            raise DownloadError("Workbook URL does not end in .xls/.xlsx.")
        resp = self._get(url)
        body = resp.content
        if not body:
            raise DownloadError("Downloaded workbook is empty.")
        if len(body) > self.s.max_workbook_bytes:
            raise DownloadError(f"Workbook too large ({len(body)} bytes).")
        if not (body.startswith(XLS_MAGIC) or body.startswith(XLSX_MAGIC)):
            raise DownloadError("Downloaded file is not an Excel workbook (possibly an HTML error page).")
        return body
