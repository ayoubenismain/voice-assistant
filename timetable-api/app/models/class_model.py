from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SchoolClass(Base):
    """A parent class group, e.g. LSI-A3-02."""

    __tablename__ = "classes"

    id: Mapped[int] = mapped_column(primary_key=True)
    class_code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    subgroups: Mapped[list["Subgroup"]] = relationship(
        back_populates="school_class", cascade="all, delete-orphan", order_by="Subgroup.subgroup_code"
    )
    lessons: Mapped[list["Lesson"]] = relationship(back_populates="school_class", cascade="all, delete-orphan")
