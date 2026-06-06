"""iter335.6 — Promote first-time setup wizard tests.

The wizard is a pure frontend feature (no backend changes), but we
test the `shouldShowWizard` trigger predicate indirectly via the
backend state combinations: wallet + campaign responses that the
predicate evaluates. This ensures the API contract the wizard depends
on stays stable.
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

MAKER_SLUG = "wizard-test"
MAKER_EMAIL = "wizard-test@craftersmarket.org"


def _maker_jwt() -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(MAKER_SLUG, MAKER_EMAIL, role="maker", session_version=0)


@pytest_asyncio.fixture(autouse=True)
async def _isolate_db():
    from core import db
    for col in ("promotion_wallets", "wallet_transactions", "campaign_groups"):
        await getattr(db, col).delete_many({})
    await db.makers.delete_one({"slug": MAKER_SLUG})
    await db.makers.insert_one({
        "slug": MAKER_SLUG, "email": MAKER_EMAIL,
        "name": "Wizard Test", "created_at": "2026-06-01T00:00:00+00:00",
    })
    yield


async def test_fresh_maker_returns_wizard_eligible_state():
    """A brand-new maker must hit the API and get back the exact shape
    the wizard's `shouldShowWizard()` predicate expects:
      • wallet.balance_cents === 0
      • wallet.lifetime_funded_cents === 0
      • campaign === null
    """
    from server import app
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        w = (await ac.get("/api/promote/wallet", headers=h)).json()
        c = (await ac.get("/api/promote/campaign", headers=h)).json()

    assert w["balance_cents"] == 0
    assert w["lifetime_funded_cents"] == 0
    assert c["campaign"] is None  # the trigger condition


async def test_funded_wallet_does_not_trigger_wizard():
    """Once a maker has EVER funded the wallet, the wizard predicate
    must return false even after they spend down to 0.

    Concretely: lifetime_funded_cents > 0 → predicate returns false.
    Tests via API contract — `shouldShowWizard(wallet, campaign)` in
    JS reads `lifetime_funded_cents`, so the API just needs to expose
    it accurately."""
    from server import app
    from services.promote_wallet import credit
    await credit(MAKER_SLUG, 5000, kind="topup", ref="test")

    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        w = (await ac.get("/api/promote/wallet", headers=h)).json()
    assert w["lifetime_funded_cents"] == 5000
    # Predicate would now return false: lifetime > 0 short-circuits.


async def test_campaign_exists_does_not_trigger_wizard():
    """If a campaign already exists, the wizard predicate returns false
    even with an empty wallet."""
    from server import app
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post("/api/promote/campaign", headers=h, json={
            "budget_cents": 5000, "goal": "sales",
            "channels": ["internal"], "auto_allocate": True,
        })
        c = (await ac.get("/api/promote/campaign", headers=h)).json()
    assert c["campaign"] is not None
    # Predicate: campaign is truthy → returns false.


async def test_wizard_save_endpoint_creates_campaign():
    """Step 2 → Continue calls upsert with the wizard's choices.
    Validate the goal validator + the saved shape."""
    from server import app
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/promote/campaign", headers=h, json={
            "budget_cents": 7500, "goal": "traffic",
            "channels": ["internal"], "auto_allocate": True,
        })
    assert r.status_code == 200
    c = r.json()["campaign"]
    assert c["budget_cents"] == 7500
    assert c["goal"] == "traffic"
    assert c["status"] == "active"
