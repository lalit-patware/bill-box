from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    # Kill switch: false = never call the model; bills are saved with QR/barcode data only
    # and re-read automatically once AI is back.
    ai_enabled: bool = True
    # Max "details pending" bills re-read per cron run (keeps each function call short).
    reprocess_limit: int = 5
    anthropic_model: str = "claude-haiku-5-5"
    max_output_tokens: int = 2048

    max_upload_mb: int = 5
    max_files_live: int = 3

    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://cloud.langfuse.com"

    batch_store_path: str = ".data/batches.json"

    # Supabase (Phase 2). Service role key is server-only: never ship it to the PWA.
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    # Legacy HS256 JWT secret. Leave empty to verify via the project's JWKS (asymmetric keys).
    supabase_jwt_secret: str = ""
    supabase_jwt_audience: str = "authenticated"

    # Web Push (VAPID). Public key also goes to the PWA as VITE_VAPID_PUBLIC_KEY.
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:lalit.patware@gmail.com"
    # Optional email fallback for reminders (Resend). Empty = push + in-app only.
    resend_api_key: str = ""
    resend_from: str = ""
    app_url: str = "https://bill-box-web.vercel.app"

    # Shared secret for cron-triggered job endpoints (X-Cron-Secret header).
    cron_secret: str = ""
    # Comma-separated origins allowed to call the API from a browser.
    cors_origins: str = "http://localhost:5173"

    # Pricing (USD per 1M tokens) for cost reports. Haiku 5.5, prompts <= 100k tokens.
    price_input_per_mtok: float = 0.10
    price_output_per_mtok: float = 0.50
    batch_discount: float = 0.5
    usd_to_inr: float = 88.0


def ai_available(settings: "Settings | None" = None) -> bool:
    s = settings or get_settings()
    return s.ai_enabled and bool(s.anthropic_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
