"""iter335.7 — Google + Meta gateway eligibility tests.

Both adapters were promoted from stubs to LIVE in this iteration.
Because real API calls require live OAuth credentials + (Google) Basic
developer-token tier / (Meta) App Review approval, we focus on the
eligibility-gate logic which is what actually changes UX in the
short term — the create_campaign code paths are exercised at runtime
once the maker activates a campaign.

What we DO test here:
  • Google: missing OAuth → "Connect Google Ads in Admin first"
  • Google: missing env vars → reports the missing list
  • Meta: missing OAuth → "Connect Meta Ads in Admin first"
  • Meta: missing META_AD_ACCOUNT_ID env → "env var missing"
  • Meta: granted scope lacks ads_management → "pending App Review"
  • Meta: granted scope INCLUDES ads_management → eligible=True

What we DON'T test here (would require live external APIs):
  • Google: actual `validate_only=True` mutate roundtrip
  • Either: real create_campaign roundtrip
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

MAKER_SLUG = "live-adapter-test"


@pytest_asyncio.fixture(autouse=True)
async def _isolate_db():
    from core import db
    await db.integration_credentials.delete_many({})
    yield


# ── Google ─────────────────────────────────────────────────────────────
async def test_google_not_eligible_without_oauth():
    from services.ads_gateway import get_gateway
    gw = get_gateway("google")
    ok, reason = await gw.is_eligible(MAKER_SLUG)
    assert ok is False
    assert "connect google ads" in reason.lower()


async def test_google_not_eligible_without_env_vars(monkeypatch):
    """OAuth row exists but env vars are missing → list them in reason."""
    from core import db
    from services.ads_gateway import get_gateway
    await db.integration_credentials.insert_one({
        "_id": "google_ads", "refresh_token": "fake",
        "customer_id": "1234567890",
    })
    # Wipe required env vars.
    for k in ("GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID",
              "GOOGLE_ADS_CLIENT_SECRET"):
        monkeypatch.delenv(k, raising=False)
    gw = get_gateway("google")
    ok, reason = await gw.is_eligible(MAKER_SLUG)
    assert ok is False
    assert "missing google env vars" in reason.lower()
    assert "GOOGLE_ADS_DEVELOPER_TOKEN" in reason


async def test_google_create_campaign_raises_when_not_eligible():
    """create_campaign must surface a GatewayNotEligible without
    crashing into the SDK code path."""
    from services.ads_gateway import (
        get_gateway, GatewayNotEligible, CreateCampaignSpec,
    )
    gw = get_gateway("google")
    spec = CreateCampaignSpec(
        maker_slug=MAKER_SLUG, listing_slug="x", listing_title="x",
        listing_description="x", listing_url="https://x/",
        listing_image_url=None, daily_budget_cents=5000,
    )
    with pytest.raises(GatewayNotEligible):
        await gw.create_campaign(spec)


# ── Meta ───────────────────────────────────────────────────────────────
async def test_meta_not_eligible_without_oauth():
    from services.ads_gateway import get_gateway
    gw = get_gateway("meta")
    ok, reason = await gw.is_eligible(MAKER_SLUG)
    assert ok is False
    assert "connect meta ads" in reason.lower()


async def test_meta_not_eligible_without_ad_account(monkeypatch):
    from core import db
    from services.ads_gateway import get_gateway
    await db.integration_credentials.insert_one({
        "_id": "meta_ads", "access_token": "fake_token",
        "scope": "ads_read,ads_management",
    })
    monkeypatch.delenv("META_AD_ACCOUNT_ID", raising=False)
    gw = get_gateway("meta")
    ok, reason = await gw.is_eligible(MAKER_SLUG)
    assert ok is False
    assert "META_AD_ACCOUNT_ID" in reason


async def test_meta_not_eligible_without_management_scope(monkeypatch):
    """Token granted only `ads_read` (pre-App-Review state)."""
    from core import db
    from services.ads_gateway import get_gateway
    await db.integration_credentials.insert_one({
        "_id": "meta_ads", "access_token": "fake_token",
        "scope": "ads_read,public_profile",
    })
    monkeypatch.setenv("META_AD_ACCOUNT_ID", "act_1234567890")
    gw = get_gateway("meta")
    ok, reason = await gw.is_eligible(MAKER_SLUG)
    assert ok is False
    assert "ads_management" in reason.lower() or "app review" in reason.lower()


async def test_meta_eligible_when_scope_present(monkeypatch):
    """Post-App-Review state: token now includes `ads_management`."""
    from core import db
    from services.ads_gateway import get_gateway
    await db.integration_credentials.insert_one({
        "_id": "meta_ads", "access_token": "fake_token",
        "scope": "ads_read,ads_management,public_profile",
    })
    monkeypatch.setenv("META_AD_ACCOUNT_ID", "act_1234567890")
    gw = get_gateway("meta")
    ok, reason = await gw.is_eligible(MAKER_SLUG)
    assert ok is True, f"expected eligible, got reason={reason!r}"
    assert reason == ""


async def test_meta_eligible_with_space_separated_scopes(monkeypatch):
    """Some Meta tokens return scopes space-separated instead of
    comma-separated. The parser must handle both."""
    from core import db
    from services.ads_gateway import get_gateway
    await db.integration_credentials.insert_one({
        "_id": "meta_ads", "access_token": "fake_token",
        "scope": "ads_read ads_management public_profile",
    })
    monkeypatch.setenv("META_AD_ACCOUNT_ID", "act_1234567890")
    gw = get_gateway("meta")
    ok, _ = await gw.is_eligible(MAKER_SLUG)
    assert ok is True


async def test_meta_create_campaign_raises_when_not_eligible():
    from services.ads_gateway import (
        get_gateway, GatewayNotEligible, CreateCampaignSpec,
    )
    gw = get_gateway("meta")
    spec = CreateCampaignSpec(
        maker_slug=MAKER_SLUG, listing_slug="x", listing_title="x",
        listing_description="x", listing_url="https://x/",
        listing_image_url=None, daily_budget_cents=5000,
    )
    with pytest.raises(GatewayNotEligible):
        await gw.create_campaign(spec)


# ── Meta OAuth scope-list flag (router-side regression) ────────────────
def test_meta_scopes_includes_management_when_flag_set(monkeypatch):
    """The OAuth start endpoint must request `ads_management` when
    META_REQUEST_MANAGEMENT_SCOPE is enabled."""
    monkeypatch.setenv("META_REQUEST_MANAGEMENT_SCOPE", "true")
    # Re-import to pick up env. _meta_scopes() reads at call-time.
    from routers.meta_ads import _meta_scopes
    s = _meta_scopes()
    assert "ads_management" in s
    assert "ads_read" in s


def test_meta_scopes_excludes_management_when_flag_unset(monkeypatch):
    monkeypatch.delenv("META_REQUEST_MANAGEMENT_SCOPE", raising=False)
    from routers.meta_ads import _meta_scopes
    s = _meta_scopes()
    assert "ads_management" not in s
    assert "ads_read" in s
