"""Process settings from environment. Secrets stay server-side and are never echoed."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql://logorder:logorder@localhost:5433/logorder"
    test_database_url: str = "postgresql://logorder:logorder@localhost:5433/logorder_test"
    dataset_path: str = str(REPO_ROOT / "htn_challenge_logs_2026.txt")
    model_dir: str = str(REPO_ROOT / "ml" / "artifacts")
    config_dir: str = str(REPO_ROOT / "config")
    upload_dir: str = str(REPO_ROOT / "data" / "uploads")
    max_upload_bytes: int = 200 * 1024 * 1024
    app_base_url: str = "http://127.0.0.1:5173"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173"

    app_auth_secret: str = ""
    ingest_token: str = ""

    sentry_dsn: str = ""
    sentry_environment: str = "development"
    sentry_release: str = ""
    sentry_traces_sample_rate: float = Field(default=0.1, ge=0, le=1)

    llm_provider: str = "anthropic"
    llm_model: str = "claude-opus-5"
    llm_api_key: str = ""

    slack_mode: str = Field(default="preview", pattern="^(preview|live)$")
    slack_webhook_url: str = ""
    max_run_notification_count: int = 20

    # Worker identity; overridden per process.
    worker_id: str = ""

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key)

    @property
    def sentry_enabled(self) -> bool:
        return bool(self.sentry_dsn)

    @property
    def slack_live(self) -> bool:
        return self.slack_mode == "live" and bool(self.slack_webhook_url)

    @property
    def loopback_only(self) -> bool:
        return self.api_host in ("127.0.0.1", "localhost", "::1")

    def integration_status(self) -> dict[str, str]:
        """Visible integration status. Never includes secret values."""
        if self.slack_live:
            slack = "live"
        elif self.slack_mode == "preview":
            slack = "preview"
        else:
            slack = "live_requested_missing_webhook"
        return {
            "sentry": "enabled" if self.sentry_enabled else "disabled_no_dsn",
            "llm": f"enabled:{self.llm_provider}" if self.llm_enabled else "deterministic_only_no_key",
            "slack": slack,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
