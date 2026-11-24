from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SyncMetadata(Base):
    """Single row (id=1).

    last_synced_at / effective_from / source_* / number_of_* describe the ACTIVE snapshot
    (last successful sync). status / last_attempt_at / error_message describe the latest attempt.
    """

    __tablename__ = "sync_metadata"

    id: Mapped[int] = mapped_column(primary_key=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime)
    effective_from: Mapped[str | None] = mapped_column(String(10))
    source_filename: Mapped[str | None] = mapped_column(String(300))
    source_url: Mapped[str | None] = mapped_column(String(600))
    source_hash: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="never")  # never|success|unchanged|failed
    number_of_classes: Mapped[int] = mapped_column(Integer, default=0)
    number_of_subgroups: Mapped[int] = mapped_column(Integer, default=0)
    number_of_lessons: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
