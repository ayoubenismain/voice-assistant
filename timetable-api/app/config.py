from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- ISSATSO+ source ---
    issatso_bearer_token: SecretStr | None = None
    issatso_base_url: str = "https://issatso.rnu.tn"
    issatso_timetable_path: str = "/bo/public/api/student/timetable/{class_code}"
    issatso_storage_prefix: str = "/bo/storage/app/public/"
    discovery_class: str = "LSI-A3-02"
    fallback_workbook_url: str | None = None
    excel_sheet_name: str = "E-02EditionParGroupeS1ouS2"  # empty string = first sheet

    # --- HTTP behaviour ---
    http_timeout_seconds: float = 30.0
    http_max_retries: int = 3
    http_backoff_base_seconds: float = 1.0
    min_request_interval_seconds: float = 1.1  # observed limit: 60 req/min
    max_workbook_bytes: int = 25 * 1024 * 1024

    # --- Database ---
    database_url: str = "sqlite:///./data/timetable.db"

    # --- Time / scheduler ---
    timezone: str = "Africa/Tunis"
    scheduler_enabled: bool = True
    sync_weekday: str = "mon"  # mon,tue,wed,thu,fri,sat,sun
    sync_hour: int = 8
    sync_minute: int = 0
    sync_on_startup: bool = False

    # --- Personal timetable (voice assistant shortcuts) ---
    student_class: str | None = None
    student_subgroup: str | None = None

    # --- Security ---
    admin_secret: SecretStr | None = None
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: str = ""  # comma separated, empty = CORS disabled

    # --- Validation thresholds ---
    min_classes: int = 1
    min_lessons: int = 1
    max_malformed_ratio: float = 0.05
    min_ratio_vs_previous: float = 0.5  # new snapshot must keep >= 50% of old lesson count

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
