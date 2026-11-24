from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.deps import ClassCode, get_db
from app.schemas.class_schema import ClassList, SubgroupList
from app.services import timetable_service as svc

router = APIRouter(prefix="/api/v1/classes", tags=["classes"])


@router.get("", response_model=ClassList)
def list_classes(db: Annotated[Session, Depends(get_db)]):
    return ClassList(synchronized=svc.is_synchronized(svc.get_meta(db)), classes=svc.list_classes(db))


@router.get("/{class_code}/subgroups", response_model=SubgroupList)
def class_subgroups(class_code: ClassCode, db: Annotated[Session, Depends(get_db)]):
    cls = svc.get_class(db, class_code)
    return SubgroupList(class_code=cls.class_code, subgroups=[s.subgroup_code for s in cls.subgroups])
