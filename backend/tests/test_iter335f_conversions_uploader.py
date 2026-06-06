"""iter335.8 — Server-side Conversions Uploads tests.

Verifies:
  • Email normalization + SHA-256 hashing matches Meta/Google's spec
  • Each platform only fires when its click ID is present
  • Idempotency: re-firing on the same session_id doesn't re-upload
    successful entries (avoids double-counting in ad-platform dashboards)
  • Per-channel failure isolation — Meta outage doesn't block Google
  • Config-missing paths log err + don't crash
"""
from __future__ import annotations
import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
import pytest_asyncio

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture(autouse=True)
async def _isolate_db():
    from core import db
    await db.conversion_upload_log.delete_many({})
    await db.integration_credentials.delete_many({})
    yield


def test_sha256_normalizes_email_per_meta_spec():
    """Meta and Google both require lower(trim(email)) before hashing.
    The hash for 'Test@Example.COM' MUST equal the hash for
    'test@example.com'."""
    from services.conversions_uploader import _sha256, _norm_email
    assert _norm_email("  Test@Example.COM ") == "test@example.com"
    h1 = _sha256(_norm_email("Test@Example.COM"))
    h2 = _sha256(_norm_email("test@example.com"))
    assert h1 == h2
    # Sanity: known hash of 'test@example.com' is stable.
    assert h2.startswith("973dfe463ec85785")


async def test_no_click_ids_means_no_uploads(monkeypatch):
    """If a transaction has no gclid/fbclid/msclkid, no uploads fire."""
    from services.conversions_uploader import fire_conversions
    tx = {
        "session_id": "cs_test_1",
        "customer_email": "buyer@example.com",
        "amount_total": 4500,
        "currency": "usd",
    }
    results = await fire_conversions(tx)
    assert results == {}


async def test_fbclid_fires_only_meta(monkeypatch):
    """A tx with only fbclid must NOT call Google or Microsoft."""
    calls = {"meta": 0, "google": 0, "microsoft": 0}

    async def fake_meta(*a, **kw):  calls["meta"] += 1
    async def fake_google(*a, **kw): calls["google"] += 1
    async def fake_microsoft(*a, **kw): calls["microsoft"] += 1

    import services.conversions_uploader as mod
    monkeypatch.setattr(mod, "_upload_meta", fake_meta)
    monkeypatch.setattr(mod, "_upload_google", fake_google)
    monkeypatch.setattr(mod, "_upload_microsoft", fake_microsoft)

    results = await mod.fire_conversions({
        "session_id": "cs_test_meta_only",
        "customer_email": "x@y.com",
        "amount_total": 5000, "currency": "usd",
        "fbclid": "FB.1.abc",
    })
    assert calls == {"meta": 1, "google": 0, "microsoft": 0}
    assert results == {"meta": "ok"}


async def test_all_three_click_ids_fire_all_three_channels(monkeypatch):
    calls = {"meta": 0, "google": 0, "microsoft": 0}

    async def fake_meta(*a, **kw):  calls["meta"] += 1
    async def fake_google(*a, **kw): calls["google"] += 1
    async def fake_microsoft(*a, **kw): calls["microsoft"] += 1

    import services.conversions_uploader as mod
    monkeypatch.setattr(mod, "_upload_meta", fake_meta)
    monkeypatch.setattr(mod, "_upload_google", fake_google)
    monkeypatch.setattr(mod, "_upload_microsoft", fake_microsoft)

    results = await mod.fire_conversions({
        "session_id": "cs_test_all",
        "customer_email": "x@y.com",
        "amount_total": 7500, "currency": "usd",
        "fbclid": "FB.1.abc", "gclid": "Cj0abc", "msclkid": "ms_xyz",
    })
    assert calls == {"meta": 1, "google": 1, "microsoft": 1}
    assert results == {"meta": "ok", "google": "ok", "microsoft": "ok"}


async def test_one_channel_failure_doesnt_block_others(monkeypatch):
    """If Meta CAPI is down, Google + Microsoft must still upload."""
    import services.conversions_uploader as mod
    calls = {"google": 0, "microsoft": 0}

    async def boom_meta(*a, **kw): raise RuntimeError("Meta CAPI down")
    async def ok_google(*a, **kw): calls["google"] += 1
    async def ok_microsoft(*a, **kw): calls["microsoft"] += 1

    monkeypatch.setattr(mod, "_upload_meta", boom_meta)
    monkeypatch.setattr(mod, "_upload_google", ok_google)
    monkeypatch.setattr(mod, "_upload_microsoft", ok_microsoft)

    results = await mod.fire_conversions({
        "session_id": "cs_test_isolated",
        "customer_email": "x@y.com",
        "amount_total": 5000, "currency": "usd",
        "fbclid": "FB", "gclid": "GC", "msclkid": "MS",
    })
    assert calls["google"] == 1
    assert calls["microsoft"] == 1
    assert results["meta"].startswith("err:")
    assert results["google"] == "ok"
    assert results["microsoft"] == "ok"


async def test_idempotent_on_repeat_fire(monkeypatch):
    """Re-firing on the same session_id must not re-upload successful
    rows. (Critical because Stripe webhooks occasionally fire twice.)"""
    import services.conversions_uploader as mod
    calls = {"meta": 0, "google": 0}

    async def fake_meta(*a, **kw):  calls["meta"] += 1
    async def fake_google(*a, **kw): calls["google"] += 1

    monkeypatch.setattr(mod, "_upload_meta", fake_meta)
    monkeypatch.setattr(mod, "_upload_google", fake_google)

    tx = {
        "session_id": "cs_test_dedupe",
        "customer_email": "x@y.com",
        "amount_total": 5000, "currency": "usd",
        "fbclid": "FB", "gclid": "GC",
    }
    r1 = await mod.fire_conversions(tx)
    r2 = await mod.fire_conversions(tx)

    # Each channel uploaded exactly once across both calls.
    assert calls["meta"] == 1, "Meta double-uploaded"
    assert calls["google"] == 1, "Google double-uploaded"
    # First call returns "ok" for both; second call returns empty
    # because both channels are already in conversion_upload_log.
    assert r1 == {"meta": "ok", "google": "ok"}
    assert r2 == {}


async def test_idempotency_retries_failed_channels(monkeypatch):
    """If Meta failed the first time, the SECOND fire should retry
    Meta (since the prior log row is `err:...`, not `ok`)."""
    import services.conversions_uploader as mod
    attempts = {"meta": 0}

    async def flaky_meta(*a, **kw):
        attempts["meta"] += 1
        if attempts["meta"] == 1:
            raise RuntimeError("transient outage")
    monkeypatch.setattr(mod, "_upload_meta", flaky_meta)

    tx = {
        "session_id": "cs_test_retry",
        "customer_email": "x@y.com",
        "amount_total": 5000, "currency": "usd",
        "fbclid": "FB",
    }
    r1 = await mod.fire_conversions(tx)
    assert r1["meta"].startswith("err:")

    r2 = await mod.fire_conversions(tx)
    # Retry succeeded.
    assert r2.get("meta") == "ok"
    assert attempts["meta"] == 2


async def test_meta_missing_config_logs_error_not_crash(monkeypatch):
    """If META_PIXEL_ID isn't configured, the upload returns err: not
    a 500 to the caller."""
    monkeypatch.delenv("META_PIXEL_ID", raising=False)
    monkeypatch.delenv("META_CAPI_ACCESS_TOKEN", raising=False)
    from services.conversions_uploader import fire_conversions
    r = await fire_conversions({
        "session_id": "cs_test_noenv",
        "customer_email": "x@y.com",
        "amount_total": 5000, "currency": "usd",
        "fbclid": "FB",
    })
    assert r.get("meta", "").startswith("err:")
