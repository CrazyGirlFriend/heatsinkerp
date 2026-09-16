from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import quote, quote_plus, urlsplit


def _as_bool(value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _database_url() -> str:
    explicit = os.getenv("DATABASE_URL")
    if explicit:
        return explicit
    username = quote_plus(os.getenv("MYSQL_USER", "heatsink"))
    password = quote_plus(os.getenv("MYSQL_PASSWORD", "heatsink"))
    host = os.getenv("MYSQL_HOST", "127.0.0.1")
    port = int(os.getenv("MYSQL_PORT", "3306"))
    database = quote(os.getenv("MYSQL_DATABASE", "heatsink_rep"), safe="")
    return (
        f"mysql+pymysql://{username}:{password}@{host}:{port}/{database}"
        "?charset=utf8mb4"
    )


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str
    app_env: str
    database_url: str
    cors_origins: tuple[str, ...]
    auto_create_tables: bool
    session_ttl_hours: int
    factory_timezone: str
    seed_admin_username: str
    seed_admin_password: str
    seed_admin_display_name: str
    site_access_password: str
    site_access_secret: str
    site_access_secure_cookie: bool
    main_system_base_url: str = ""
    main_system_token: str = ""
    main_system_timeout_seconds: float = 5.0
    main_system_config_key: str = ""
    main_system_allowed_origins: str = ""

    def __post_init__(self) -> None:
        if self.main_system_base_url:
            url = urlsplit(self.main_system_base_url)
            if (url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment
                or any(c.isspace() for c in self.main_system_base_url)):
                raise ValueError("MAIN_SYSTEM_BASE_URL must be an HTTPS URL without credentials, query or fragment")
            _ = url.port  # Validate malformed/out-of-range ports at startup.
            if not self.main_system_token or any(ord(c) < 33 or ord(c) > 126 for c in self.main_system_token):
                raise ValueError("MAIN_SYSTEM_TOKEN must be a nonempty printable ASCII bearer token")
        if not 0.1 <= self.main_system_timeout_seconds <= 30:
            raise ValueError("MAIN_SYSTEM_TIMEOUT_SECONDS must be between 0.1 and 30")
        if self.site_access_password and len(self.site_access_secret.encode("utf-8")) < 32:
            raise ValueError(
                "SITE_ACCESS_SECRET must contain at least 32 bytes when "
                "SITE_ACCESS_PASSWORD is enabled; use a cryptographically random secret"
            )


def get_settings() -> Settings:
    origins = tuple(
        item.strip()
        for item in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
        if item.strip()
    )
    return Settings(
        app_name=os.getenv("APP_NAME", "Heat Sink Production Flow API"),
        app_env=os.getenv("APP_ENV", "development"),
        database_url=_database_url(),
        cors_origins=origins,
        auto_create_tables=_as_bool(os.getenv("AUTO_CREATE_TABLES"), default=True),
        session_ttl_hours=int(os.getenv("SESSION_TTL_HOURS", "24")),
        factory_timezone=os.getenv("FACTORY_TIMEZONE", "Asia/Shanghai"),
        seed_admin_username=os.getenv("SEED_ADMIN_USERNAME", "admin"),
        seed_admin_password=os.getenv("SEED_ADMIN_PASSWORD", "Admin123!"),
        seed_admin_display_name=os.getenv("SEED_ADMIN_DISPLAY_NAME", "系统管理员"),
        site_access_password=os.getenv("SITE_ACCESS_PASSWORD", ""),
        site_access_secret=os.getenv("SITE_ACCESS_SECRET", ""),
        site_access_secure_cookie=_as_bool(
            os.getenv("SITE_ACCESS_SECURE_COOKIE"), default=False
        ),
        main_system_base_url=os.getenv("MAIN_SYSTEM_BASE_URL", "").strip().rstrip("/"),
        main_system_token=os.getenv("MAIN_SYSTEM_TOKEN", ""),
        main_system_timeout_seconds=float(os.getenv("MAIN_SYSTEM_TIMEOUT_SECONDS", "5")),
        main_system_config_key=os.getenv("MAIN_SYSTEM_CONFIG_KEY", ""),
        main_system_allowed_origins=os.getenv("MAIN_SYSTEM_ALLOWED_ORIGINS", ""),
    )


settings = get_settings()
