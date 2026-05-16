"""Tests for Stripe webhook auto-rotation API + nudge scheduler.

We mock out the Stripe SDK entirely — we never want a unit test to
touch a real Stripe account. The tests verify:
  • /stripe-webhook/rotate creates an override row + returns secret
  • /stripe-webhook/pending reflects the override (and redacts secret)
  • /stripe-webhook/finalize writes secret_rotations + deletes override
  • /stripe-webhook/cancel removes override (and asks Stripe to delete new ep)
  • Refusing a second rotation while one is in flight (409)
  • Dual-secret verification (env + override) via get_active_webhook_secrets
  • Nudge job classifies overdue/due_soon and dedups per (id, status)
"""
import asyncio
import os
import sys
import types

import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")


# --------- Stripe SDK mock helper ---------
class _MockStripeEndpoint(dict):
    def __getattr__(self, k):
        return self.get(k)


class _MockWebhookEndpoint:
    last_create_kwargs = None
    last_delete_id = None
    list_data: list = []

    @classmethod
    def reset(cls):
        cls.last_create_kwargs = None
        cls.last_delete_id = None
        cls.list_data = []

    @classmethod
    def create(cls, **kwargs):
        cls.last_create_kwargs = kwargs
        return _MockStripeEndpoint(
            id="we_test_new_123",
            secret="whsec_test_NEW_SECRET_abc1234567890XYZ",
            url=kwargs.get("url"),
            enabled_events=kwargs.get("enabled_events", []),
        )

    @classmethod
    def list(cls, **kwargs):
        return {"data": list(cls.list_data)}

    @classmethod
    def delete(cls, endpoint_id):
        cls.last_delete_id = endpoint_id
        return {"deleted": True, "id": endpoint_id}


@pytest.fixture(autouse=True)
def _patch_stripe(monkeypatch):
    """Inject mock SDK + ensure STRIPE_API_KEY/PUBLIC_BACKEND_URL set."""
    monkeypatch.setenv("STRIPE_API_KEY", "sk_test_mockkey")
    monkeypatch.setenv("PUBLIC_BACKEND_URL", "https://test.example.com")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_env_OLD_secret")

    fake = types.ModuleType("stripe")
    fake.api_key = None
    fake.WebhookEndpoint = _MockWebhookEndpoint

    class _Webhook:
        @staticmethod
        def construct_event(payload, signature, secret):
            # Accept any signature that matches the secret literally (test mode)
            if signature == f"sig_for_{secret}":
                return {"type": "test.event", "id": "evt_1"}
            raise ValueError("Invalid signature")

    fake.Webhook = _Webhook
    monkeypatch.setitem(sys.modules, "stripe", fake)
    _MockWebhookEndpoint.reset()
    yield


# --------- Helpers ---------
async def _cleanup(db_):
    await db_.secret_overrides.delete_many({})
    await db_.secret_rotations.delete_many({"secret_id": "stripe_webhook"})
    await db_.admin_audit_log.delete_many({
        "kind": {"$in": [
            "stripe_webhook_rotation_started",
            "stripe_webhook_rotation_finalized",
            "stripe_webhook_rotation_cancelled",
        ]},
    })


# --------- Tests ---------
@pytest.mark.asyncio
async def test_rotate_creates_override_and_returns_secret():
    from core import db
    from routers.admin_secrets import (
        stripe_webhook_rotate, RotateRequest, stripe_webhook_pending,
    )
    await _cleanup(db)
    _MockWebhookEndpoint.list_data = [
        {"id": "we_test_OLD_456", "url": "https://test.example.com/api/webhook/stripe"},
    ]
    claims = {"email": "ops@example.com"}

    result = await stripe_webhook_rotate(RotateRequest(kind="main"), claims=claims)
    assert result["ok"] is True
    assert result["new_endpoint_id"] == "we_test_new_123"
    assert result["new_secret"].startswith("whsec_test_NEW_SECRET")
    assert result["old_endpoint_id"] == "we_test_OLD_456"
    assert result["env_var_to_update"] == "STRIPE_WEBHOOK_SECRET"

    # Override row persisted
    row = await db.secret_overrides.find_one({"_id": "stripe_webhook_pending"})
    assert row is not None
    assert row["new_endpoint_id"] == "we_test_new_123"
    assert row["new_secret"] == "whsec_test_NEW_SECRET_abc1234567890XYZ"

    # Pending endpoint reflects override but redacts secret
    pend = await stripe_webhook_pending(_claims=claims)
    assert pend["pending"]["main"] is not None
    preview = pend["pending"]["main"]["new_secret_preview"]
    assert preview.startswith("whsec_t")
    assert preview.endswith("0XYZ")  # last 4 chars of new_secret
    assert "abc1234567890" not in preview  # middle is redacted

    await _cleanup(db)


@pytest.mark.asyncio
async def test_rotate_refuses_when_already_pending():
    from fastapi import HTTPException
    from core import db
    from routers.admin_secrets import stripe_webhook_rotate, RotateRequest
    await _cleanup(db)
    _MockWebhookEndpoint.list_data = []
    claims = {"email": "ops@example.com"}
    await stripe_webhook_rotate(RotateRequest(kind="main"), claims=claims)
    with pytest.raises(HTTPException) as exc:
        await stripe_webhook_rotate(RotateRequest(kind="main"), claims=claims)
    assert exc.value.status_code == 409
    await _cleanup(db)


@pytest.mark.asyncio
async def test_finalize_deletes_old_and_writes_rotation_row():
    from core import db
    from routers.admin_secrets import (
        stripe_webhook_rotate, stripe_webhook_finalize, RotateRequest,
    )
    await _cleanup(db)
    _MockWebhookEndpoint.list_data = [
        {"id": "we_OLD", "url": "https://test.example.com/api/webhook/stripe"},
    ]
    claims = {"email": "ops@example.com"}
    await stripe_webhook_rotate(RotateRequest(kind="main"), claims=claims)
    res = await stripe_webhook_finalize(RotateRequest(kind="main"), claims=claims)

    assert res["ok"] is True
    assert res["old_endpoint_deleted"] is True
    assert _MockWebhookEndpoint.last_delete_id == "we_OLD"

    # Override cleared
    assert await db.secret_overrides.find_one({"_id": "stripe_webhook_pending"}) is None
    # secret_rotations row written → main tracker now shows reset timer
    rot = await db.secret_rotations.find_one({"secret_id": "stripe_webhook"})
    assert rot is not None
    assert rot["admin_email"] == "ops@example.com"

    await _cleanup(db)


@pytest.mark.asyncio
async def test_cancel_deletes_new_and_clears_override():
    from core import db
    from routers.admin_secrets import (
        stripe_webhook_rotate, stripe_webhook_cancel, RotateRequest,
    )
    await _cleanup(db)
    _MockWebhookEndpoint.list_data = []
    claims = {"email": "ops@example.com"}
    await stripe_webhook_rotate(RotateRequest(kind="main"), claims=claims)
    res = await stripe_webhook_cancel(RotateRequest(kind="main"), claims=claims)

    assert res["ok"] is True
    assert res["new_endpoint_deleted"] is True
    assert _MockWebhookEndpoint.last_delete_id == "we_test_new_123"
    # No new rotation row (cancel ≠ rotation)
    rot = await db.secret_rotations.find_one({"secret_id": "stripe_webhook"})
    assert rot is None
    assert await db.secret_overrides.find_one({"_id": "stripe_webhook_pending"}) is None

    await _cleanup(db)


@pytest.mark.asyncio
async def test_active_secrets_returns_env_plus_override():
    from core import db
    from stripe_webhook_secrets import get_active_webhook_secrets
    await db.secret_overrides.delete_many({})

    # Env only
    secrets = await get_active_webhook_secrets("main")
    assert secrets == ["whsec_test_env_OLD_secret"]

    # Env + override
    await db.secret_overrides.insert_one({
        "_id": "stripe_webhook_pending",
        "new_secret": "whsec_NEW_pending",
        "kind": "main",
    })
    secrets = await get_active_webhook_secrets("main")
    assert "whsec_test_env_OLD_secret" in secrets
    assert "whsec_NEW_pending" in secrets
    assert secrets.index("whsec_test_env_OLD_secret") < secrets.index("whsec_NEW_pending")

    await db.secret_overrides.delete_many({})


@pytest.mark.asyncio
async def test_nudge_dedups_per_id_and_status():
    """Run nudge twice in a row — second run should send no emails because
    every overdue row already has a fresh `secret_rotation_nudge` audit row.
    """
    from datetime import datetime, timezone
    from core import db
    # Prime with a stale audit row from 10 days ago for stripe_webhook (status=overdue)
    await db.admin_audit_log.delete_many({"kind": "secret_rotation_nudge"})
    # Mark stripe_webhook overdue by inserting a 200d old rotation
    await db.secret_rotations.delete_many({"secret_id": "stripe_webhook"})
    old_iso = datetime(2025, 1, 1, tzinfo=timezone.utc).isoformat()
    await db.secret_rotations.insert_one({
        "secret_id": "stripe_webhook", "label": "Stripe webhook signing secret",
        "admin_email": "test", "created_at": old_iso,
    })

    from scheduler import _job_secrets_rotation_nudge
    await _job_secrets_rotation_nudge()
    count_after_first = await db.admin_audit_log.count_documents({"kind": "secret_rotation_nudge"})
    assert count_after_first >= 1

    # Run again immediately — should NOT add more rows for same (id, status)
    await _job_secrets_rotation_nudge()
    count_after_second = await db.admin_audit_log.count_documents({"kind": "secret_rotation_nudge"})
    assert count_after_second == count_after_first

    # Cleanup
    await db.secret_rotations.delete_many({"secret_id": "stripe_webhook"})
    await db.admin_audit_log.delete_many({"kind": "secret_rotation_nudge"})


if __name__ == "__main__":
    # Run all tests directly: python tests/test_secrets_rotation.py
    pytest.main([__file__, "-v", "-s"])
