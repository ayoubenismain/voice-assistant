import datetime as dt

from pydantic import BaseModel


class LessonOut(BaseModel):
    class_code: str
    subgroup_code: str
    semester: str | None
    weekday: str
    slot: str | None
    start_time: str
    end_time: str
    weekly_hours: float | None
    subject: str
    subject_code: str | None
    teacher: str | None
    teaching_type: str | None
    room: str | None
    regime: str | None


class TimetableMeta(BaseModel):
    synchronized: bool
    timetable_effective_from: dt.date | None
    last_synced_at: dt.datetime | None
    message: str | None = None


class DayTimetable(TimetableMeta):
    class_code: str
    subgroup: str | None  # null => lessons of ALL subgroups, each tagged with subgroup_code
    date: dt.date
    weekday: str
    lesson_count: int
    lessons: list[LessonOut]


class WeekDay(BaseModel):
    weekday: str
    weekday_index: int
    lesson_count: int
    lessons: list[LessonOut]


class WeekTimetable(TimetableMeta):
    class_code: str
    subgroup: str | None
    days: list[WeekDay]


class NextLessons(TimetableMeta):
    class_code: str
    subgroup: str | None
    found: bool
    date: dt.date | None = None
    weekday: str | None = None
    start_time: str | None = None
    lessons: list[LessonOut] = []
