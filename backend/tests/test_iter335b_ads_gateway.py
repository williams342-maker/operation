"""iter335.5 — External Ads Gateway tests.

Covers:
  • Gateway factory dispatches to the right adapter
  • Google + Meta stubs report `not eligible` with helpful reasons
  • Microsoft stub-mode (when OAuth credential is missing) reports
    `not eligible` cleanly without raising SOAP errors
  • Launch endpoint enforces per-listing minimum + plan-exists guards
  • Launch endpoint returns 501 for stub channels
  • Idempotency: re-launching the same (channel, slug) returns the
    existing row without a second API call
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
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio

MAKER_SLUG = "ext-test-maker"
MAKER_EMAIL = "ext-test@craftersmarket.org"


def _maker_jwt() -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(MAKER_SLUG, MAKER_EMAIL, role="maker", session_version=0)


@pytest_asyncio.fixture(autouse=True)
async def _isolate_db():
    from core import db
    for col in ("promotion_wallets", "wallet_transactions",
                "campaign_groups", "listing_allocations",
                "promote_pending_topups", "external_ad_campaigns",
                "integration_credentials"):
        await getattr(db, col).delete_many({})
    await db.makers.delete_one({"slug": MAKER_SLUG})
    await db.makers.insert_one({
        "slug": MAKER_SLUG, "email": MAKER_EMAIL,
        "name": "Ext Test", "created_at": "2026-01-01T00:00:00+00:00",
    })
    await db.products.delete_many({"maker_slug": MAKER_SLUG})
    # Two listings — one will get a high allocation (eligible for external),
    # the other will fall below the $35 floor.
    await db.products.insert_many([
        {
            "slug": f"{MAKER_SLUG}-big",
            "maker_slug": MAKER_SLUG, "title": "Big Listing",
            "price": 100, "in_stock": 10,
            "description": "A handsome handmade item that converts at 25%.",
            "status": "published", "deleted_at": None,
            "created_at": "2026-05-01T00:00:00+00:00",
            "metrics": {"views": 1000, "clicks": 100, "sold": 25},
        },
        {
            "slug": f"{MAKER_SLUG}-small",
            "maker_slug": MAKER_SLUG, "title": "Small Listing",
            "price": 12, "in_stock": 3,
            "description": "A cheaper item.",
            "status": "published", "deleted_at": None,
            "created_at": "2026-04-01T00:00:00+00:00",
            "metrics": {"views": 5, "clicks": 0, "sold": 0},
        },
    ])
    yield


# ── Gateway factory + stubs ────────────────────────────────────────────
def test_gateway_factory_dispatches_correctly():
    from services.ads_gateway import get_gateway
    from services.ads_gateway.microsoft import MicrosoftGateway
    from services.ads_gateway.google import GoogleGateway
    from services.ads_gateway.meta import MetaGateway
    assert isinstance(get_gateway("microsoft"), MicrosoftGateway)
    assert isinstance(get_gateway("google"), GoogleGateway)
    assert isinstance(get_gateway("meta"), MetaGateway)

    import pytest
    with pytest.raises(ValueError):
        get_gateway("tiktok")  # not registered


async def test_google_not_eligible_without_oauth():
    """iter335.7 — Google is now LIVE but degrades gracefully when no
    OAuth row is persisted. Returns eligible=False with a connect hint
    (not NotImplemented like the old stub)."""
    from services.ads_gateway import get_gateway
    gw = get_gateway("google")
    ok, reason = await gw.is_eligible(MAKER_SLUG)
    assert ok is False
    assert "connect google ads" in reason.lower()


async def test_meta_not_eligible_without_oauth():
    """iter335.7 — Meta is now LIVE but degrades gracefully when no
    OAuth row is persisted (matches Google behavior)."""
    from services.ads_gateway import get_gateway
    gw = get_gateway("meta")
    ok, reason = await gw.is_eligible(MAKER_SLUG)
    assert ok is False
    assert "connect meta ads" in reason.lower()


async def test_microsoft_not_eligible_without_oauth():
    """No `integration_credentials.microsoft_ads` row → eligible=False
    with a helpful reason. Importantly, doesn't crash trying to make a
    SOAP call."""
    from services.ads_gateway import get_gateway
    gw = get_gateway("microsoft")
    ok, reason = await gw.is_eligible(MAKER_SLUG)
    assert ok is False
    assert "connect" in reason.lower()


# ── API endpoints ──────────────────────────────────────────────────────
async def test_channels_endpoint_lists_all_three():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/promote/channels",
                         headers={"Authorization": f"Bearer {_maker_jwt()}"})
    assert r.status_code == 200
    chs = r.json()["channels"]
    assert {c["channel"] for c in chs} == {"microsoft", "google", "meta"}
    # All blocked initially (no OAuth + Google/Meta stubbed).
    assert all(c["eligible"] is False for c in chs)
    assert all(c["active_count"] == 0 for c in chs)


async def test_launch_external_requires_plan():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/promote/external/launch",
            headers={"Authorization": f"Bearer {_maker_jwt()}"},
            json={"channel": "microsoft", "listing_slug": f"{MAKER_SLUG}-big"},
        )
    assert r.status_code == 404
    assert "plan" in r.json()["detail"].lower()


async def test_launch_below_floor_rejected():
    """Small listing with low allocation must fail with a useful error."""
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {_maker_jwt()}"}
        # Tiny budget — both listings end up well below the $35 floor.
        await ac.post("/api/promote/campaign", headers=h, json={
            "budget_cents": 1000, "goal": "sales",
            "channels": ["internal", "google"], "auto_allocate": True,
        })
        r = await ac.post("/api/promote/external/launch", headers=h, json={
            "channel": "google", "listing_slug": f"{MAKER_SLUG}-small",
        })
    assert r.status_code == 400
    assert "floor" in r.json()["detail"].lower()


async def test_launch_google_returns_409_when_not_connected():
    """iter335.7 — Google adapter is now LIVE. Without OAuth +
    developer token, it returns 409 (NotEligible) with a connect
    hint — same shape as the Microsoft adapter."""
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {_maker_jwt()}"}
        # Big budget so the high-conv listing is allocated >> $35.
        await ac.post("/api/promote/campaign", headers=h, json={
            "budget_cents": 50000, "goal": "sales",
            "channels": ["internal", "google"], "auto_allocate": True,
        })
        r = await ac.post("/api/promote/external/launch", headers=h, json={
            "channel": "google", "listing_slug": f"{MAKER_SLUG}-big",
        })
    assert r.status_code == 409
    assert "connect google ads" in r.json()["detail"].lower()


async def test_launch_microsoft_blocked_when_oauth_missing():
    """Without an OAuth row, Microsoft must raise 409 (not 500). The
    `is_eligible` check fires before any SOAP call."""
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {_maker_jwt()}"}
        await ac.post("/api/promote/campaign", headers=h, json={
            "budget_cents": 50000, "goal": "sales",
            "channels": ["internal", "microsoft"], "auto_allocate": True,
        })
        r = await ac.post("/api/promote/external/launch", headers=h, json={
            "channel": "microsoft", "listing_slug": f"{MAKER_SLUG}-big",
        })
    assert r.status_code == 409
    assert "connect" in r.json()["detail"].lower()


async def test_launch_idempotent_when_microsoft_gateway_mocked(monkeypatch):
    """With the Microsoft gateway monkey-patched to return a fake
    handle, the first launch creates a row and the second returns the
    same row with `created=False`."""
    from server import app
    from services.ads_gateway import microsoft as ms_mod
    from services.ads_gateway.base import CampaignHandle

    async def fake_is_eligible(self, maker_slug):
        return (True, "")

    async def fake_create(self, spec):
        return CampaignHandle(
            channel="microsoft", external_id="fake-cid-123",
            status="paused", note="mocked",
        )

    monkeypatch.setattr(ms_mod.MicrosoftGateway, "is_eligible", fake_is_eligible)
    monkeypatch.setattr(ms_mod.MicrosoftGateway, "create_campaign", fake_create)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {_maker_jwt()}"}
        await ac.post("/api/promote/campaign", headers=h, json={
            "budget_cents": 50000, "goal": "sales",
            "channels": ["internal", "microsoft"], "auto_allocate": True,
        })
        r1 = await ac.post("/api/promote/external/launch", headers=h, json={
            "channel": "microsoft", "listing_slug": f"{MAKER_SLUG}-big",
        })
        r2 = await ac.post("/api/promote/external/launch", headers=h, json={
            "channel": "microsoft", "listing_slug": f"{MAKER_SLUG}-big",
        })
    assert r1.status_code == 200 and r1.json()["created"] is True
    assert r2.status_code == 200 and r2.json()["created"] is False
    assert r1.json()["campaign"]["external_id"] == "fake-cid-123"
    assert r2.json()["campaign"]["external_id"] == "fake-cid-123"


async def test_pause_resume_external_updates_row_and_calls_sdk(monkeypatch):
    from server import app
    from services.ads_gateway import microsoft as ms_mod
    from services.ads_gateway.base import CampaignHandle
    calls = []

    async def fake_is_eligible(self, ms): return (True, "")
    async def fake_create(self, spec):
        return CampaignHandle(channel="microsoft", external_id="cid-9",
                              status="paused", note="")
    async def fake_pause(self, ext_id): calls.append(("pause", ext_id))
    async def fake_resume(self, ext_id): calls.append(("resume", ext_id))

    monkeypatch.setattr(ms_mod.MicrosoftGateway, "is_eligible", fake_is_eligible)
    monkeypatch.setattr(ms_mod.MicrosoftGateway, "create_campaign", fake_create)
    monkeypatch.setattr(ms_mod.MicrosoftGateway, "pause_campaign", fake_pause)
    monkeypatch.setattr(ms_mod.MicrosoftGateway, "resume_campaign", fake_resume)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {_maker_jwt()}"}
        await ac.post("/api/promote/campaign", headers=h, json={
            "budget_cents": 50000, "goal": "sales",
            "channels": ["internal", "microsoft"], "auto_allocate": True,
        })
        await ac.post("/api/promote/external/launch", headers=h, json={
            "channel": "microsoft", "listing_slug": f"{MAKER_SLUG}-big",
        })
        # Resume → active
        r = await ac.post("/api/promote/external/microsoft/cid-9/resume", headers=h)
        assert r.status_code == 200 and r.json()["status"] == "active"
        # Pause → paused
        r = await ac.post("/api/promote/external/microsoft/cid-9/pause", headers=h)
        assert r.status_code == 200 and r.json()["status"] == "paused"

    assert calls == [("resume", "cid-9"), ("pause", "cid-9")]
