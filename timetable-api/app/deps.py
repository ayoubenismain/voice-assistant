import secrets
from datetime import datetime
from typing import Annotated, Iterator

from fastapi import Depends, Header, Path, Query, Request
from sqlalchemy.orm import Session

from app.config import Settings
from app.exceptions import BadRequestError, ForbiddenError, UnauthorizedError

CODE_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_-]{1,49}$"

ClassCode = Annotated[str, Path(pattern=CODE_PATTERN, description="Parent class code, e.g. LSI-A3-02")]
SubgroupQuery = Annotated[str | None, Query(pattern=CODE_PATTERN, description="Optional subgroup code")]


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as db:
        yield db


def get_now(request: Request) -> datetime:
    """Current time in the configured timezone (overridable in tests via app.state.clock)."""
    return request.app.state.clock()


def require_admin(settings: Annotated[Settings, Depends(get_settings)],
                  x_admin_secret: Annotated[str | None, Header()] = None) -> None:
    if settings.admin_secret is None:
        raise ForbiddenError("Manual synchronization is disabled: ADMIN_SECRET is not configured.")
    if not x_admin_secret:
        raise UnauthorizedError("Missing X-Admin-Secret header.")
    if not secrets.compare_digest(x_admin_secret.encode(), settings.admin_secret.get_secret_value().encode()):
        raise ForbiddenError("Invalid admin secret.")


def personal_target(settings: Annotated[Settings, Depends(get_settings)]) -> tuple[str, str | None]:
    if not settings.student_class:
        raise BadRequestError("Personal timetable not configured: set STUDENT_CLASS (and STUDENT_SUBGROUP) in .env.")
    return settings.student_class, settings.student_subgroup
