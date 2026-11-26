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

    # Pricing (USD per 1M tokens) for cost reports. Haiku 5.5, prompts <= 100k tokens.
    price_input_per_mtok: float = 0.10
    price_output_per_mtok: float = 0.50
    batch_discount: float = 0.5
    usd_to_inr: float = 88.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
