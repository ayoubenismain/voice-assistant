"""Read-side queries and response building. Weekly pattern -> requested date via weekday mapping."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.config import Settings
from app.exceptions import NotFoundError
from app.models import Lesson, SchoolClass, Subgroup, SyncMetadata
from app.schemas.class_schema import ClassOut
from app.schemas.timetable import DayTimetable, LessonOut, NextLessons, WeekDay, WeekTimetable
from app.timeutil import WEEKDAY_NAMES, as_local, weekday_index

NOT_SYNCED_MSG = "The timetable has not been synchronized yet. Run a synchronization first."
WEEKLY_NOTE = "Recurring weekly pattern: lessons are matched by weekday, not individual calendar events."


def get_meta(db: Session) -> SyncMetadata | None:
    return db.get(SyncMetadata, 1)


def is_synchronized(meta: SyncMetadata | None) -> bool:
    return bool(meta and meta.last_synced_at)


def _meta_fields(meta: SyncMetadata | None, settings: Settings) -> dict:
    synced = is_synchronized(meta)
    eff = date.fromisoformat(meta.effective_from) if synced and meta.effective_from else None
    return {"synchronized": synced, "timetable_effective_from": eff,
            "last_synced_at": as_local(meta.last_synced_at, settings.timezone) if synced else None,
            "message": None if synced else NOT_SYNCED_MSG}


def list_classes(db: Session) -> list[ClassOut]:
    rows = db.scalars(select(SchoolClass).options(selectinload(SchoolClass.subgroups))
                      .order_by(SchoolClass.class_code)).all()
    return [ClassOut(class_code=c.class_code, subgroups=[s.subgroup_code for s in c.subgroups]) for c in rows]


def get_class(db: Session, class_code: str) -> SchoolClass:
    cls = db.scalar(select(SchoolClass).options(selectinload(SchoolClass.subgroups))
                    .where(SchoolClass.class_code == class_code.upper()))
    if cls is None:
        raise NotFoundError(f"Class '{class_code}' not found.")
    return cls


def _resolve_subgroup(cls: SchoolClass, subgroup: str | None) -> str | None:
    if subgroup is None:
        return None
    code = subgroup.upper()
    if code not in {s.subgroup_code for s in cls.subgroups}:
        raise NotFoundError(f"Subgroup '{subgroup}' does not belong to class '{cls.class_code}'.")
    return code


def _lessons(db: Session, cls: SchoolClass, day_idx: int | None, subgroup: str | None) -> list[Lesson]:
    q = (select(Lesson).options(joinedload(Lesson.subgroup)).join(Subgroup, Lesson.subgroup_id == Subgroup.id)
         .where(Lesson.class_id == cls.id))
    if day_idx is not None:
        q = q.where(Lesson.weekday_index == day_idx)
    if subgroup:
        q = q.where(Subgroup.subgroup_code == subgroup)
    q = q.order_by(Lesson.weekday_index, Lesson.start_time, Lesson.end_time, Subgroup.subgroup_code, Lesson.id)
    return list(db.scalars(q).unique())


def to_out(l: Lesson, class_code: str) -> LessonOut:
    return LessonOut(class_code=class_code, subgroup_code=l.subgroup.subgroup_code, semester=l.semester,
                     weekday=l.weekday, slot=l.slot, start_time=l.start_time, end_time=l.end_time,
                     weekly_hours=l.weekly_hours, subject=l.subject, subject_code=l.subject_code,
                     teacher=l.teacher, teaching_type=l.teaching_type, room=l.room, regime=l.regime)


def _unsynced_day(settings, meta, class_code, subgroup, target: date) -> DayTimetable:
    return DayTimetable(class_code=class_code.upper(), subgroup=subgroup.upper() if subgroup else None,
                        date=target, weekday=WEEKDAY_NAMES[weekday_index(target)], lesson_count=0,
                        lessons=[], **_meta_fields(meta, settings))


def day_timetable(db: Session, settings: Settings, class_code: str, target: date,
                  subgroup: str | None = None) -> DayTimetable:
    meta = get_meta(db)
    if not is_synchronized(meta):
        return _unsynced_day(settings, meta, class_code, subgroup, target)
    cls = get_class(db, class_code)
    sub = _resolve_subgroup(cls, subgroup)
    idx = weekday_index(target)
    out = [to_out(l, cls.class_code) for l in _lessons(db, cls, idx, sub)]
    fields = _meta_fields(meta, settings)
    fields["message"] = WEEKLY_NOTE if out else f"No lessons on {WEEKDAY_NAMES[idx]}. {WEEKLY_NOTE}"
    return DayTimetable(class_code=cls.class_code, subgroup=sub, date=target, weekday=WEEKDAY_NAMES[idx],
                        lesson_count=len(out), lessons=out, **fields)


def week_timetable(db: Session, settings: Settings, class_code: str,
                   subgroup: str | None = None) -> WeekTimetable:
    meta = get_meta(db)
    if not is_synchronized(meta):
        return WeekTimetable(class_code=class_code.upper(), subgroup=subgroup.upper() if subgroup else None,
                             days=[], **_meta_fields(meta, settings))
    cls = get_class(db, class_code)
    sub = _resolve_subgroup(cls, subgroup)
    by_day: dict[int, list[LessonOut]] = {i: [] for i in range(1, 7)}
    for l in _lessons(db, cls, None, sub):
        by_day.setdefault(l.weekday_index, []).append(to_out(l, cls.class_code))
    days = [WeekDay(weekday=WEEKDAY_NAMES[i], weekday_index=i, lesson_count=len(v), lessons=v)
            for i, v in sorted(by_day.items()) if i <= 6 or v]
    fields = _meta_fields(meta, settings)
    fields["message"] = WEEKLY_NOTE
    return WeekTimetable(class_code=cls.class_code, subgroup=sub, days=days, **fields)


def next_lessons(db: Session, settings: Settings, class_code: str, now: datetime,
                 subgroup: str | None = None) -> NextLessons:
    """Earliest lessons starting at/after `now` (local time), looking up to 7 days ahead.

    All simultaneous lessons sharing that start time are returned (several subgroups/regimes can overlap).
    """
    meta = get_meta(db)
    base = dict(class_code=class_code.upper(), subgroup=subgroup.upper() if subgroup else None)
    if not is_synchronized(meta):
        return NextLessons(found=False, **base, **_meta_fields(meta, settings))
    cls = get_class(db, class_code)
    sub = _resolve_subgroup(cls, subgroup)
    for offset in range(8):
        d = now.date() + timedelta(days=offset)
        lessons = _lessons(db, cls, weekday_index(d), sub)
        if offset == 0:
            lessons = [l for l in lessons if l.start_time >= now.strftime("%H:%M")]
        if lessons:
            first = lessons[0].start_time
            chosen = [to_out(l, cls.class_code) for l in lessons if l.start_time == first]
            return NextLessons(found=True, class_code=cls.class_code, subgroup=sub, date=d,
                               weekday=WEEKDAY_NAMES[weekday_index(d)], start_time=first, lessons=chosen,
                               **_meta_fields(meta, settings))
    return NextLessons(found=False, class_code=cls.class_code, subgroup=sub, **_meta_fields(meta, settings))
