"""Timezone helpers. All "today" logic uses the configured local timezone (Africa/Tunis)."""
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

WEEKDAY_NAMES = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday",
                 5: "Friday", 6: "Saturday", 7: "Sunday"}


def utcnow() -> datetime:
    """Naive UTC timestamp (what we store in SQLite)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def now_local(tz_name: str) -> datetime:
    return datetime.now(ZoneInfo(tz_name))


def weekday_index(d: date) -> int:
    """Monday=1 ... Sunday=7."""
    return d.isoweekday()


def as_local(naive_utc: datetime | None, tz_name: str) -> datetime | None:
    if naive_utc is None:
        return None
    return naive_utc.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(tz_name))
