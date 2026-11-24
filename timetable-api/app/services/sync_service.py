"""Weekly synchronization: discover -> download -> parse -> validate -> atomically replace snapshot."""
from __future__ import annotations

import hashlib
import logging
import threading
from dataclasses import dataclass, field
from typing import Callable

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.exceptions import AppError, ValidationFailedError
from app.models import Lesson, SchoolClass, Subgroup, SyncMetadata
from app.services.excel_parser import ParseResult, parse_workbook
from app.services.issatso_client import IssatsoClient
from app.services.validation import validate_parse
from app.timeutil import utcnow

log = logging.getLogger(__name__)


@dataclass
class SyncOutcome:
    status: str  # success | unchanged | failed | busy
    message: str
    error_code: str | None = None
    report: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status in ("success", "unchanged")


class SyncService:
    def __init__(self, settings: Settings, session_factory: sessionmaker,
                 client_factory: Callable[[], IssatsoClient] | None = None):
        self.settings = settings
        self.session_factory = session_factory
        self.client_factory = client_factory or (lambda: IssatsoClient(settings))
        self._lock = threading.Lock()  # one sync at a time (scheduler + manual endpoint + CLI-in-process)

    # ------------------------------------------------------------------ public
    def run(self, *, force: bool = False) -> SyncOutcome:
        if not self._lock.acquire(blocking=False):
            return SyncOutcome("busy", "A synchronization is already running.", "sync_in_progress")
        try:
            return self._run(force)
        finally:
            self._lock.release()

    # ------------------------------------------------------------------ steps
    def _run(self, force: bool) -> SyncOutcome:
        warnings: list[str] = []
        try:
            with self.client_factory() as client:
                url, filename, effective = self._discover(client, warnings)
                data = client.download_workbook(url)

            digest = hashlib.sha256(data).hexdigest()
            if not force and self._is_unchanged(digest):
                with self.session_factory() as db, db.begin():
                    meta = self._meta(db)
                    meta.status, meta.last_attempt_at, meta.error_message = "unchanged", utcnow(), None
                    if effective:
                        meta.effective_from = effective.isoformat()
                log.info("Workbook unchanged (sha256 %s…); database not modified", digest[:12])
                return SyncOutcome("unchanged", "Workbook unchanged; database not modified.")

            result = parse_workbook(data, self.settings.excel_sheet_name)
            with self.session_factory() as db:
                previous = db.scalar(select(func.count()).select_from(Lesson))
            report = validate_parse(
                result, min_classes=self.settings.min_classes, min_lessons=self.settings.min_lessons,
                max_malformed_ratio=self.settings.max_malformed_ratio, previous_lessons=previous,
                min_ratio_vs_previous=self.settings.min_ratio_vs_previous,
                expected_class=self.settings.discovery_class)
            report.warnings.extend(warnings)
            if not report.ok:
                raise ValidationFailedError("Validation failed: " + " ".join(report.errors),
                                            details=report.as_dict())

            self._replace_snapshot(result, url=url, filename=filename, digest=digest,
                                   effective=effective.isoformat() if effective else None)
            log.info("Sync OK: %d classes, %d subgroups, %d lessons", result.number_of_classes,
                     result.number_of_subgroups, len(result.lessons))
            return SyncOutcome("success", "Timetable synchronized.", report=report.as_dict())

        except AppError as exc:
            log.error("Sync failed [%s]: %s", exc.code, exc.message)
            self._record_failure(exc.message)
            return SyncOutcome("failed", exc.message, exc.code, exc.details or {})
        except Exception as exc:  # keep message generic: unknown exceptions might carry sensitive data
            log.exception("Unexpected sync failure")
            msg = f"Unexpected error during synchronization ({type(exc).__name__})."
            self._record_failure(msg)
            return SyncOutcome("failed", msg, "internal_error")

    def _discover(self, client: IssatsoClient, warnings: list[str]):
        try:
            url, meta = client.discover_workbook(self.settings.discovery_class)
            return url, meta.original_name or url.rsplit("/", 1)[-1], meta.effective_from
        except AppError as exc:
            fallback = self.settings.fallback_workbook_url
            if not fallback:
                raise
            log.warning("Metadata discovery failed (%s); using FALLBACK_WORKBOOK_URL", exc.code)
            warnings.append(f"Used fallback workbook URL because discovery failed: {exc.message}")
            return fallback, fallback.rsplit("/", 1)[-1], None

    def _is_unchanged(self, digest: str) -> bool:
        with self.session_factory() as db:
            meta = db.get(SyncMetadata, 1)
            lessons = db.scalar(select(func.count()).select_from(Lesson))
            return bool(meta and meta.source_hash == digest and meta.last_synced_at and lessons)

    @staticmethod
    def _meta(db: Session) -> SyncMetadata:
        meta = db.get(SyncMetadata, 1)
        if meta is None:
            meta = SyncMetadata(id=1, status="never")
            db.add(meta)
        return meta

    def _replace_snapshot(self, result: ParseResult, *, url: str, filename: str, digest: str,
                          effective: str | None) -> None:
        """Delete + insert + metadata update in ONE transaction: all-or-nothing."""
        with self.session_factory() as db, db.begin():
            db.execute(delete(Lesson))
            db.execute(delete(Subgroup))
            db.execute(delete(SchoolClass))

            class_objs = {code: SchoolClass(class_code=code) for code in result.classes}
            db.add_all(class_objs.values())
            sub_objs: dict[str, Subgroup] = {}
            for code, subs in result.classes.items():
                for sub_code, sem in subs.items():
                    sub_objs[sub_code] = Subgroup(school_class=class_objs[code], subgroup_code=sub_code,
                                                  semester=sem)
            db.add_all(sub_objs.values())
            db.flush()

            db.add_all(Lesson(
                class_id=class_objs[l.class_code].id, subgroup_id=sub_objs[l.subgroup_code].id,
                weekday=l.weekday, weekday_index=l.weekday_index, original_day_label=l.original_day_label,
                slot=l.slot, weekly_hours=l.weekly_hours, start_time=l.start_time, end_time=l.end_time,
                subject=l.subject, subject_code=l.subject_code, teacher=l.teacher,
                teaching_type=l.teaching_type, room=l.room, regime=l.regime, semester=l.semester)
                for l in result.lessons)

            now = utcnow()
            meta = self._meta(db)
            meta.last_synced_at = meta.last_attempt_at = now
            meta.effective_from, meta.source_filename, meta.source_url = effective, filename, url
            meta.source_hash, meta.status, meta.error_message = digest, "success", None
            meta.number_of_classes = len(class_objs)
            meta.number_of_subgroups = len(sub_objs)
            meta.number_of_lessons = len(result.lessons)

    def _record_failure(self, message: str) -> None:
        """Only touches status fields; the active snapshot columns are left as they were."""
        try:
            with self.session_factory() as db, db.begin():
                meta = self._meta(db)
                meta.status, meta.last_attempt_at, meta.error_message = "failed", utcnow(), message[:2000]
        except Exception:
            log.exception("Could not record sync failure")
