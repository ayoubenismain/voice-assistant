from sqlalchemy import Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Lesson(Base):
    """One recurring weekly lesson. Times are zero-padded "HH:MM" strings (sort lexicographically)."""

    __tablename__ = "lessons"
    __table_args__ = (
        Index("ix_lessons_class_day_start", "class_id", "weekday_index", "start_time"),
        Index("ix_lessons_subgroup_day_start", "subgroup_id", "weekday_index", "start_time"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"))
    subgroup_id: Mapped[int] = mapped_column(ForeignKey("subgroups.id", ondelete="CASCADE"))
    weekday: Mapped[str] = mapped_column(String(10))
    weekday_index: Mapped[int] = mapped_column(Integer)  # Monday=1
    original_day_label: Mapped[str] = mapped_column(String(30))
    slot: Mapped[str | None] = mapped_column(String(20))
    weekly_hours: Mapped[float | None] = mapped_column(Float)
    start_time: Mapped[str] = mapped_column(String(5))
    end_time: Mapped[str] = mapped_column(String(5))
    subject: Mapped[str] = mapped_column(String(300))
    subject_code: Mapped[str | None] = mapped_column(String(20))
    teacher: Mapped[str | None] = mapped_column(String(150))
    teaching_type: Mapped[str | None] = mapped_column(String(30))
    room: Mapped[str | None] = mapped_column(String(50))
    regime: Mapped[str | None] = mapped_column(String(30))
    semester: Mapped[str | None] = mapped_column(String(20))

    school_class: Mapped["SchoolClass"] = relationship(back_populates="lessons")
    subgroup: Mapped["Subgroup"] = relationship(back_populates="lessons")
