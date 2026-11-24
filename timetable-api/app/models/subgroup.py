from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Subgroup(Base):
    __tablename__ = "subgroups"

    id: Mapped[int] = mapped_column(primary_key=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), index=True)
    subgroup_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    semester: Mapped[str | None] = mapped_column(String(20))

    school_class: Mapped["SchoolClass"] = relationship(back_populates="subgroups")
    lessons: Mapped[list["Lesson"]] = relationship(back_populates="subgroup", cascade="all, delete-orphan")
