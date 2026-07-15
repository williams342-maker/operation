"""Centralized backend configuration for Crafters Market.

Loads backend/.env once, preserves real deployment environment values, applies
safe local-development defaults, and validates production-required settings.
All backend code should import settings or env_get from this module instead of
reading os.environ directly.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import dotenv_values, load_dotenv

ROOT_DIR = Path(__file__).resolve().parent
ENV_PATH = ROOT_DIR / ".env"
_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


def _load_env_file() -> None:
    """Load backend/.env without clobbering real deployment env vars.

    If a platform injects masked placeholders containing `****`, replace them
    from .env so preview/dev stacks can still use real local secrets.
    """
    if os.environ.get("CONFIG_SKIP_ENV_FILE", "").lower() in _TRUE:
        return
    if not ENV_PATH.exists():
        return
    load_dotenv(ENV_PATH, override=False)
    for key, env_val in dotenv_values(ENV_PATH).items():
        if not env_val:
            continue
        current = os.environ.get(key, "")
        if current and "****" in current:
            os.environ[key] = env_val


def _raw(name: str, default: str = "") -> str:
    return (os.environ.get(name, default) or "").strip()


def _pick(*names: str, default: str = "") -> str:
    for name in names:
        value = _raw(name)
        if value:
            return value
    return default


def _csv(name: str) -> list[str]:
    return [part.strip() for part in _raw(name).split(",") if part.strip()]


def _bool(name: str, default: bool = False) -> bool:
    value = _raw(name)
    if not value:
        return default
    lowered = value.lower()
    if lowered in _TRUE:
        return True
    if lowered in _FALSE:
        return False
    return default


_load_env_file()

# Local defaults are written back to os.environ for compatibility with older
# scripts/tests while runtime modules migrate to settings/env_get.
_ENV_NAME = _pick("APP_ENV", "ENVIRONMENT", "NODE_ENV", default="local").lower()
_IS_PRODUCTION = _ENV_NAME in {"prod", "production"}
if not _IS_PRODUCTION:
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "craftersmarket")
    os.environ.setdefault("MAKER_AUTH_SECRET", "dev-local-secret-change-me")
    os.environ.setdefault("STORAGE_BACKEND", "local")


@dataclass(frozen=True)
class BackendConfig:
    environment: str = _ENV_NAME
    is_production: bool = _IS_PRODUCTION

    mongo_url: str = field(default_factory=lambda: _raw("MONGO_URL"))
    db_name: str = field(default_factory=lambda: _raw("DB_NAME"))
    maker_auth_secret: str = field(default_factory=lambda: _raw("MAKER_AUTH_SECRET"))

    storage_backend: str = field(default_factory=lambda: _raw("STORAGE_BACKEND", "r2" if _IS_PRODUCTION else "local").lower())
    r2_account_id: str = field(default_factory=lambda: _raw("R2_ACCOUNT_ID"))
    r2_access_key_id: str = field(default_factory=lambda: _raw("R2_ACCESS_KEY_ID"))
    r2_secret_access_key: str = field(default_factory=lambda: _raw("R2_SECRET_ACCESS_KEY"))
    r2_bucket: str = field(default_factory=lambda: _raw("R2_BUCKET"))
    r2_endpoint: str = field(default_factory=lambda: _raw("R2_ENDPOINT").rstrip("/"))
    r2_public_url: str = field(default_factory=lambda: _raw("R2_PUBLIC_URL").rstrip("/"))

    stripe_api_key: str = field(default_factory=lambda: _pick("STRIPE_API_KEY", "STRIPE_SECRET_KEY"))
    stripe_webhook_secret: str = field(default_factory=lambda: _raw("STRIPE_WEBHOOK_SECRET"))
    stripe_connect_webhook_secret: str = field(default_factory=lambda: _pick("STRIPE_CONNECT_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET"))
    stripe_automatic_tax: bool = field(default_factory=lambda: _bool("STRIPE_AUTOMATIC_TAX", True))

    paypal_environment: str = field(default_factory=lambda: (_raw("PAYPAL_ENVIRONMENT", "live" if _IS_PRODUCTION else "sandbox").lower()))
    paypal_public_enabled: bool = field(default_factory=lambda: _bool("PAYPAL_PUBLIC_ENABLED", _IS_PRODUCTION))
    paypal_autopayout_enabled: bool = field(default_factory=lambda: _bool("PAYPAL_AUTOPAYOUT_ENABLED", False))

    email_provider: str = field(default_factory=lambda: _raw("EMAIL_PROVIDER", "mailtrap").lower())
    email_fallback_provider: str = field(default_factory=lambda: _raw("EMAIL_FALLBACK_PROVIDER", "postmark").lower())
    email_fallback_provider_2: str = field(default_factory=lambda: _raw("EMAIL_FALLBACK_PROVIDER_2", "").lower())
    resend_api_key: str = field(default_factory=lambda: _raw("RESEND_API_KEY"))

    google_ads_enabled: bool = field(default_factory=lambda: _bool("GOOGLE_ADS_ENABLED", False))
    google_ads_developer_token: str = field(default_factory=lambda: _raw("GOOGLE_ADS_DEVELOPER_TOKEN"))
    google_ads_client_id: str = field(default_factory=lambda: _raw("GOOGLE_ADS_CLIENT_ID"))
    google_ads_client_secret: str = field(default_factory=lambda: _raw("GOOGLE_ADS_CLIENT_SECRET"))
    google_ads_login_customer_id: str = field(default_factory=lambda: _raw("GOOGLE_ADS_LOGIN_CUSTOMER_ID"))
    google_ads_customer_id: str = field(default_factory=lambda: _raw("GOOGLE_ADS_CUSTOMER_ID"))
    google_ads_redirect_uri: str = field(default_factory=lambda: _raw("GOOGLE_ADS_REDIRECT_URI"))

    public_backend_url: str = field(default_factory=lambda: _raw("PUBLIC_BACKEND_URL").rstrip("/"))
    public_site_url: str = field(default_factory=lambda: _raw("PUBLIC_SITE_URL").rstrip("/"))
    public_app_url: str = field(default_factory=lambda: _pick("PUBLIC_APP_URL", "PUBLIC_SITE_URL", "FRONTEND_URL", default="https://craftersmarket.org").rstrip("/"))
    frontend_url: str = field(default_factory=lambda: _pick("FRONTEND_URL", "PUBLIC_SITE_URL", default="https://craftersmarket.org").rstrip("/"))
    ops_email: str = field(default_factory=lambda: _raw("OPS_EMAIL"))
    admin_emails: tuple[str, ...] = field(default_factory=lambda: tuple(e.lower() for e in (_csv("ADMIN_EMAILS") or _csv("OPS_EMAIL"))))

    def get(self, name: str, default: str = "") -> str:
        return _raw(name, default)

    def get_bool(self, name: str, default: bool = False) -> bool:
        return _bool(name, default)

    def get_int(self, name: str, default: int = 0) -> int:
        try:
            return int(_raw(name, str(default)))
        except ValueError:
            return default

    def get_float(self, name: str, default: float = 0.0) -> float:
        try:
            return float(_raw(name, str(default)))
        except ValueError:
            return default

    @property
    def r2_required(self) -> bool:
        forced = _raw("R2_REQUIRED").lower()
        if forced in _FALSE:
            return False
        if forced in _TRUE:
            return True
        return self.storage_backend not in {"local", "filesystem", "fs"}

    @property
    def r2_configured(self) -> bool:
        return not self.missing_r2_vars()

    def missing_r2_vars(self) -> list[str]:
        required = {
            "R2_ACCOUNT_ID": self.r2_account_id,
            "R2_ACCESS_KEY_ID": self.r2_access_key_id,
            "R2_SECRET_ACCESS_KEY": self.r2_secret_access_key,
            "R2_BUCKET": self.r2_bucket,
            "R2_ENDPOINT": self.r2_endpoint,
            "R2_PUBLIC_URL": self.r2_public_url,
        }
        return [key for key, value in required.items() if not value]

    def paypal_mode_config(self) -> dict[str, str]:
        env = self.paypal_environment if self.paypal_environment in {"sandbox", "live"} else "sandbox"
        suffix = "LIVE" if env == "live" else "SANDBOX"
        return {
            "env": env,
            "client_id": _raw(f"PAYPAL_CLIENT_ID_{suffix}"),
            "client_secret": _raw(f"PAYPAL_CLIENT_SECRET_{suffix}"),
            "webhook_id": _raw(f"PAYPAL_WEBHOOK_ID_{suffix}"),
            "checkout_webhook_id": _pick(f"PAYPAL_CHECKOUT_WEBHOOK_ID_{suffix}", "PAYPAL_CHECKOUT_WEBHOOK_ID"),
            "payout_webhook_id": _pick(
                f"PAYPAL_PAYOUT_STATUS_WEBHOOK_ID_{suffix}",
                "PAYPAL_PAYOUT_STATUS_WEBHOOK_ID",
                f"PAYPAL_PAYOUT_WEBHOOK_ID_{suffix}",
            ),
        }

    def google_ads_redirect(self) -> str:
        if self.google_ads_redirect_uri:
            return self.google_ads_redirect_uri
        if not self.public_backend_url:
            return ""
        return f"{self.public_backend_url}/api/admin/integrations/google-ads/oauth/callback"

    def validate_startup(self) -> None:
        missing: list[str] = []
        core = {
            "MONGO_URL": self.mongo_url,
            "DB_NAME": self.db_name,
            "MAKER_AUTH_SECRET": self.maker_auth_secret,
        }
        missing.extend(key for key, value in core.items() if not value)

        r2_missing = self.missing_r2_vars()
        if self.r2_required and r2_missing:
            missing.extend(r2_missing)
        elif any(_raw(k) for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT", "R2_PUBLIC_URL")) and r2_missing:
            missing.extend(r2_missing)

        if self.is_production:
            stripe_required = {
                "STRIPE_API_KEY": self.stripe_api_key,
                "STRIPE_WEBHOOK_SECRET": self.stripe_webhook_secret,
            }
            missing.extend(key for key, value in stripe_required.items() if not value)

            paypal_disabled = _raw("PAYPAL_ENABLED").lower() in _FALSE
            if not paypal_disabled and self.paypal_public_enabled:
                paypal = self.paypal_mode_config()
                suffix = "LIVE" if paypal["env"] == "live" else "SANDBOX"
                if not paypal["client_id"]:
                    missing.append(f"PAYPAL_CLIENT_ID_{suffix}")
                if not paypal["client_secret"]:
                    missing.append(f"PAYPAL_CLIENT_SECRET_{suffix}")
                if not paypal["webhook_id"]:
                    missing.append(f"PAYPAL_WEBHOOK_ID_{suffix}")

            active_email_providers = {self.email_provider, self.email_fallback_provider, self.email_fallback_provider_2}
            if "resend" in active_email_providers and not self.resend_api_key:
                missing.append("RESEND_API_KEY")

            if self.google_ads_enabled:
                google_required = {
                    "GOOGLE_ADS_DEVELOPER_TOKEN": self.google_ads_developer_token,
                    "GOOGLE_ADS_CLIENT_ID": self.google_ads_client_id,
                    "GOOGLE_ADS_CLIENT_SECRET": self.google_ads_client_secret,
                    "GOOGLE_ADS_LOGIN_CUSTOMER_ID": self.google_ads_login_customer_id,
                    "GOOGLE_ADS_REDIRECT_URI/PUBLIC_BACKEND_URL": self.google_ads_redirect(),
                }
                missing.extend(key for key, value in google_required.items() if not value)

        if missing:
            unique = sorted(set(missing))
            raise RuntimeError(
                "Backend configuration error. Missing required environment variables: "
                + ", ".join(unique)
            )

    def summary(self) -> dict[str, Any]:
        return {
            "environment": self.environment,
            "is_production": self.is_production,
            "db_name": self.db_name,
            "storage_backend": self.storage_backend,
            "r2_configured": self.r2_configured,
            "stripe_configured": bool(self.stripe_api_key),
            "paypal_environment": self.paypal_environment,
            "email_provider": self.email_provider,
            "google_ads_enabled": self.google_ads_enabled,
        }


settings = BackendConfig()

# Backward-compatible constants for modules migrating from core/os.environ.
MONGO_URL = settings.mongo_url
DB_NAME = settings.db_name
MAKER_AUTH_SECRET = settings.maker_auth_secret
STRIPE_API_KEY = settings.stripe_api_key
PUBLIC_BACKEND_URL = settings.public_backend_url
PUBLIC_SITE_URL = settings.public_site_url
ADMIN_EMAILS = set(settings.admin_emails)


def env_get(name: str, default: str = "") -> str:
    return settings.get(name, default)


def env_bool(name: str, default: bool = False) -> bool:
    return settings.get_bool(name, default)


def env_int(name: str, default: int = 0) -> int:
    return settings.get_int(name, default)


def env_float(name: str, default: float = 0.0) -> float:
    return settings.get_float(name, default)


def validate_startup_config() -> None:
    settings.validate_startup()
