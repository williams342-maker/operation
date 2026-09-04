from __future__ import annotations

import importlib

import pytest


@pytest.fixture(scope="module", autouse=True)
def _restore_config_module_after_this_file():
    """Put the real `config` module back when this file is done.

    Every test below calls importlib.reload(config) under a monkeypatched
    environment. monkeypatch faithfully restores os.environ afterwards, but
    NOTHING undoes a module reload: the reloaded `config` stays in sys.modules
    holding whatever the last test set, for the rest of the session.

    That leaked across the whole suite. One of the cases below reloads config
    with MONGO_URL="mongodb://mongo:27017" — a Docker service alias that does
    not resolve outside a container network — and every later consumer of
    config then stalled until pymongo's 30s server selection expired. In the
    first CI run that could report it, 68 tests failed with

        ServerSelectionTimeoutError: mongo:27017:
            [Errno -3] Temporary failure in name resolution

    and before the pytest timeout was raised above pymongo's own, they were
    simply opaque hangs with no cause attached.

    Module scope is deliberate: this finalizer runs after every function-scoped
    monkeypatch has already been undone, so the reload below sees the real
    environment.
    """
    yield
    import config
    importlib.reload(config)


def _reload_config(monkeypatch, values):
    keys = {
        "CONFIG_SKIP_ENV_FILE", "APP_ENV", "ENVIRONMENT", "NODE_ENV", "MONGO_URL", "DB_NAME", "MAKER_AUTH_SECRET",
        "STORAGE_BACKEND", "R2_REQUIRED", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT", "R2_PUBLIC_URL",
        "STRIPE_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
        "PAYPAL_ENABLED", "PAYPAL_PUBLIC_ENABLED", "PAYPAL_ENVIRONMENT",
        "PAYPAL_CLIENT_ID_LIVE", "PAYPAL_CLIENT_SECRET_LIVE", "PAYPAL_WEBHOOK_ID_LIVE",
        "RESEND_API_KEY", "EMAIL_PROVIDER", "EMAIL_FALLBACK_PROVIDER", "EMAIL_FALLBACK_PROVIDER_2",
        "GOOGLE_ADS_ENABLED", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID",
        "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_LOGIN_CUSTOMER_ID", "PUBLIC_BACKEND_URL",
    }
    for key in keys:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("CONFIG_SKIP_ENV_FILE", "true")
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    import config
    return importlib.reload(config)


def test_local_defaults_are_sensible(monkeypatch):
    cfg = _reload_config(monkeypatch, {})
    assert cfg.settings.mongo_url == "mongodb://localhost:27017"
    assert cfg.settings.db_name == "craftersmarket"
    assert cfg.settings.storage_backend == "local"
    cfg.validate_startup_config()


def test_production_missing_required_vars_fails_clearly(monkeypatch):
    cfg = _reload_config(monkeypatch, {"APP_ENV": "production"})
    with pytest.raises(RuntimeError) as exc:
        cfg.validate_startup_config()
    message = str(exc.value)
    assert "MONGO_URL" in message
    assert "MAKER_AUTH_SECRET" in message
    assert "R2_BUCKET" in message
    assert "STRIPE_API_KEY" in message


def test_production_can_disable_optional_paypal_and_local_storage(monkeypatch):
    cfg = _reload_config(monkeypatch, {
        "APP_ENV": "production",
        "MONGO_URL": "mongodb://mongo:27017",
        "DB_NAME": "craftersmarket",
        "MAKER_AUTH_SECRET": "prod-secret",
        "STORAGE_BACKEND": "local",
        "STRIPE_API_KEY": "sk_live_x",
        "STRIPE_WEBHOOK_SECRET": "whsec_x",
        "PAYPAL_ENABLED": "false",
    })
    cfg.validate_startup_config()


def test_resend_required_when_active_production_email_provider(monkeypatch):
    cfg = _reload_config(monkeypatch, {
        "APP_ENV": "production",
        "MONGO_URL": "mongodb://mongo:27017",
        "DB_NAME": "craftersmarket",
        "MAKER_AUTH_SECRET": "prod-secret",
        "STORAGE_BACKEND": "local",
        "STRIPE_API_KEY": "sk_live_x",
        "STRIPE_WEBHOOK_SECRET": "whsec_x",
        "PAYPAL_ENABLED": "false",
        "EMAIL_PROVIDER": "resend",
    })
    with pytest.raises(RuntimeError, match="RESEND_API_KEY"):
        cfg.validate_startup_config()


def test_google_required_only_when_enabled(monkeypatch):
    cfg = _reload_config(monkeypatch, {
        "APP_ENV": "production",
        "MONGO_URL": "mongodb://mongo:27017",
        "DB_NAME": "craftersmarket",
        "MAKER_AUTH_SECRET": "prod-secret",
        "STORAGE_BACKEND": "local",
        "STRIPE_API_KEY": "sk_live_x",
        "STRIPE_WEBHOOK_SECRET": "whsec_x",
        "PAYPAL_ENABLED": "false",
        "GOOGLE_ADS_ENABLED": "true",
    })
    with pytest.raises(RuntimeError, match="GOOGLE_ADS_DEVELOPER_TOKEN"):
        cfg.validate_startup_config()
