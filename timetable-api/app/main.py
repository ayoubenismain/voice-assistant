import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import classes, health, synchronization, timetables
from app.config import Settings, get_settings
from app.database import init_db, make_engine, make_session_factory
from app.exceptions import AppError
from app.scheduler import build_scheduler
from app.services.sync_service import SyncService
from app.timeutil import now_local

log = logging.getLogger("timetable_api")


def _error(status: int, code: str, message: str, details=None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details}})


def create_app(settings: Settings | None = None, *, client_factory=None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    engine = make_engine(settings.database_url)
    session_factory = make_session_factory(engine)
    service = SyncService(settings, session_factory, client_factory)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db(engine)
        scheduler = None
        if settings.scheduler_enabled:
            scheduler = build_scheduler(settings, service)
            scheduler.start()
            if settings.sync_on_startup:
                scheduler.add_job(lambda: service.run(), id="startup-sync")
            log.info("Scheduler started: weekly sync %s %02d:%02d (%s)", settings.sync_weekday,
                     settings.sync_hour, settings.sync_minute, settings.timezone)
        yield
        if scheduler:
            scheduler.shutdown(wait=False)

    app = FastAPI(title="ISSATSO+ Timetable API", version="1.0.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.sync_service = service
    app.state.clock = lambda: now_local(settings.timezone)

    if settings.cors_origin_list:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list,
                           allow_methods=["GET", "POST"], allow_headers=["X-Admin-Secret"])

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return _error(exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        return _error(exc.status_code, "http_error", str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        errs = [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
        return _error(422, "invalid_parameters", "Invalid request parameters.", errs)

    app.include_router(health.router)
    app.include_router(classes.router)
    app.include_router(timetables.router)
    app.include_router(synchronization.router)
    return app


app = create_app()
