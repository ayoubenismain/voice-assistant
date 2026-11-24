from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.config import Settings
from app.deps import get_db, get_settings, require_admin
from app.schemas.sync_schema import SyncRunResult, SyncStatus

router = APIRouter(prefix="/api/v1/sync", tags=["synchronization"])

_STATUS_FOR_CODE = {"sync_in_progress": 409, "validation_failed": 422, "invalid_workbook": 422}


@router.get("/status", response_model=SyncStatus)
def sync_status(db: Annotated[Session, Depends(get_db)], cfg: Annotated[Settings, Depends(get_settings)]):
    from app.models import SyncMetadata
    from app.timeutil import as_local

    m = db.get(SyncMetadata, 1)
    if m is None:
        return SyncStatus(status="never", last_synced_at=None, last_attempt_at=None, effective_from=None,
                          source_filename=None, number_of_classes=0, number_of_subgroups=0,
                          number_of_lessons=0, error_message=None, scheduler_enabled=cfg.scheduler_enabled)
    return SyncStatus(
        status=m.status, last_synced_at=as_local(m.last_synced_at, cfg.timezone),
        last_attempt_at=as_local(m.last_attempt_at, cfg.timezone), effective_from=m.effective_from,
        source_filename=m.source_filename, number_of_classes=m.number_of_classes,
        number_of_subgroups=m.number_of_subgroups, number_of_lessons=m.number_of_lessons,
        error_message=m.error_message, scheduler_enabled=cfg.scheduler_enabled)


@router.post("/run", response_model=SyncRunResult, dependencies=[Depends(require_admin)])
def run_sync(request: Request, force: bool = False):
    outcome = request.app.state.sync_service.run(force=force)
    if outcome.ok:
        return SyncRunResult(status=outcome.status, message=outcome.message, report=outcome.report)
    http = _STATUS_FOR_CODE.get(outcome.error_code or "", 502)
    return JSONResponse(status_code=http, content={"error": {
        "code": outcome.error_code, "message": outcome.message, "details": outcome.report or None}})
