from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import Settings
from app.deps import get_db, get_settings

router = APIRouter(tags=["general"])


@router.get("/health")
def health(db: Annotated[Session, Depends(get_db)], settings: Annotated[Settings, Depends(get_settings)]):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "ok", "timezone": settings.timezone}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "degraded", "database": "unavailable",
                                                      "timezone": settings.timezone})
