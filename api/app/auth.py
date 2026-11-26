"""Verify Supabase access tokens sent by the PWA (Authorization: Bearer <jwt>)."""

import hmac
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, Header, HTTPException

from app.config import Settings, get_settings


@lru_cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True)


def decode_token(token: str, settings: Settings) -> dict[str, Any]:
    opts = {"require": ["sub", "exp"]}
    if settings.supabase_jwt_secret:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience=settings.supabase_jwt_audience,
            options=opts,
        )
    if not settings.supabase_url:
        raise HTTPException(503, "Auth is not configured (SUPABASE_URL)")
    key = _jwks_client(settings.supabase_url).get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        key.key,
        algorithms=["ES256", "RS256"],
        audience=settings.supabase_jwt_audience,
        options=opts,
    )


def current_user_id(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    try:
        claims = decode_token(authorization.split(" ", 1)[1], settings)
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "Invalid token") from exc
    return str(claims["sub"])


def require_cron(
    settings: Annotated[Settings, Depends(get_settings)],
    x_cron_secret: Annotated[str | None, Header()] = None,
) -> None:
    if not settings.cron_secret or not x_cron_secret:
        raise HTTPException(401, "Cron secret required")
    if not hmac.compare_digest(settings.cron_secret, x_cron_secret):
        raise HTTPException(401, "Bad cron secret")


UserId = Annotated[str, Depends(current_user_id)]
Cron = Annotated[None, Depends(require_cron)]
