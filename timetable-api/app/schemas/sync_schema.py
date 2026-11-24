from datetime import datetime

from pydantic import BaseModel


class SyncStatus(BaseModel):
    status: str
    last_synced_at: datetime | None
    last_attempt_at: datetime | None
    effective_from: str | None
    source_filename: str | None
    number_of_classes: int
    number_of_subgroups: int
    number_of_lessons: int
    error_message: str | None
    scheduler_enabled: bool


class SyncRunResult(BaseModel):
    status: str
    message: str
    report: dict = {}
