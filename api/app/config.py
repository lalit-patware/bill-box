from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
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

    # Shared secret for cron-triggered job endpoints (X-Cron-Secret header).
    cron_secret: str = ""
    # Comma-separated origins allowed to call the API from a browser.
    cors_origins: str = "http://localhost:5173"

    # Pricing (USD per 1M tokens) for cost reports. Haiku 5.5, prompts <= 100k tokens.
    price_input_per_mtok: float = 0.10
    price_output_per_mtok: float = 0.50
    batch_discount: float = 0.5
    usd_to_inr: float = 88.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
