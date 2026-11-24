"""Weekly sync via APScheduler 3.x. The scheduler lives inside the API process: it only fires while
the service is running (see README)."""
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import Settings
from app.services.sync_service import SyncService

log = logging.getLogger(__name__)


def build_scheduler(settings: Settings, sync_service: SyncService) -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone=settings.timezone)
    trigger = CronTrigger(day_of_week=settings.sync_weekday, hour=settings.sync_hour,
                          minute=settings.sync_minute, timezone=settings.timezone)
    scheduler.add_job(lambda: sync_service.run(), trigger, id="weekly-sync", max_instances=1,
                      coalesce=True, misfire_grace_time=6 * 3600, replace_existing=True)
    return scheduler
