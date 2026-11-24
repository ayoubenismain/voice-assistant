from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import Settings
from app.deps import ClassCode, SubgroupQuery, get_db, get_now, get_settings, personal_target
from app.schemas.timetable import DayTimetable, NextLessons, WeekTimetable
from app.services import timetable_service as svc

DB = Annotated[Session, Depends(get_db)]
Cfg = Annotated[Settings, Depends(get_settings)]
Now = Annotated[datetime, Depends(get_now)]
Me = Annotated[tuple[str, str | None], Depends(personal_target)]

router = APIRouter(prefix="/api/v1", tags=["timetable"])


@router.get("/classes/{class_code}/today", response_model=DayTimetable)
def class_today(class_code: ClassCode, db: DB, cfg: Cfg, now: Now, subgroup: SubgroupQuery = None):
    return svc.day_timetable(db, cfg, class_code, now.date(), subgroup)


@router.get("/classes/{class_code}/week", response_model=WeekTimetable)
def class_week(class_code: ClassCode, db: DB, cfg: Cfg, subgroup: SubgroupQuery = None):
    return svc.week_timetable(db, cfg, class_code, subgroup)


@router.get("/classes/{class_code}/date/{target_date}", response_model=DayTimetable)
def class_date(class_code: ClassCode, target_date: date, db: DB, cfg: Cfg, subgroup: SubgroupQuery = None):
    return svc.day_timetable(db, cfg, class_code, target_date, subgroup)


@router.get("/classes/{class_code}/next", response_model=NextLessons)
def class_next(class_code: ClassCode, db: DB, cfg: Cfg, now: Now, subgroup: SubgroupQuery = None):
    return svc.next_lessons(db, cfg, class_code, now, subgroup)


@router.get("/me/timetable/today", response_model=DayTimetable)
def me_today(db: DB, cfg: Cfg, now: Now, me: Me):
    return svc.day_timetable(db, cfg, me[0], now.date(), me[1])


@router.get("/me/timetable/tomorrow", response_model=DayTimetable)
def me_tomorrow(db: DB, cfg: Cfg, now: Now, me: Me):
    from datetime import timedelta
    return svc.day_timetable(db, cfg, me[0], now.date() + timedelta(days=1), me[1])


@router.get("/me/timetable/week", response_model=WeekTimetable)
def me_week(db: DB, cfg: Cfg, me: Me):
    return svc.week_timetable(db, cfg, me[0], me[1])


@router.get("/me/timetable/next", response_model=NextLessons)
def me_next(db: DB, cfg: Cfg, now: Now, me: Me):
    return svc.next_lessons(db, cfg, me[0], now, me[1])
