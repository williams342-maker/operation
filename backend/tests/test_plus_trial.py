"""Regression: Crafters Plus 3-month free trial (iter170 / Founder Tier Phase 4 #1).

Covers:
  * Stripe webhook `customer.subscription.created` with status=trialing →
    persists is_in_trial=True, trial_end_at, and locks plus_trial_used=True
  * Status flip from trialing → active syncs is_in_trial=False but keeps
    plus_trial_used=True (no second trial after conversion)
  * GET /api/maker/subscription returns trial_eligible=False for the
    locked maker, exposes trial_days_remaining as a clamped integer
  * Brand-new maker with no Plus history reports trial_eligible=True
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )

TEST_MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
TEST_MAKER_SLUG = "iron-and-oak"


async def _maker_jwt(client: httpx.AsyncClient) -> str:
    from maker_auth import issue_magic_token
    magic = issue_magic_token(TEST_MAKER_EMAIL)
    r = await client.post(f"{API}/api/maker/auth/verify", json={"token": magic})
    return r.json()["token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


async def _reset_trial_state():
    """Strip Plus/trial fields so the test starts from a known free state."""
    from core import db
    await db.makers.update_one(
        {"slug": TEST_MAKER_SLUG},
        {"$set": {
            "subscription_status": "free",
            "stripe_subscription_id": None,
            "is_in_trial": False,
            "trial_start_at": None,
            "trial_end_at": None,
            "plus_trial_used": False,
        }},
    )


@pytest.mark.asyncio
async def test_trial_eligible_before_first_subscribe():
    await _reset_trial_state()
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        r = await c.get(f"{API}/api/maker/subscription", headers=_h(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["trial_eligible"] is True
        assert body["trial_days"] == 90
        assert body["is_in_trial"] is False
        assert body["status"] == "free"


@pytest.mark.asyncio
async def test_trialing_status_sets_is_in_trial_and_locks_trial_used():
    await _reset_trial_state()
    from routers.subscriptions import _sync_sub_to_maker
    now = int(datetime.now(tz=timezone.utc).timestamp())
    trial_end = now + 90 * 86400
    await _sync_sub_to_maker({
        "id": "sub_test_trial_1",
        "status": "trialing",
        "current_period_start": now,
        "current_period_end": trial_end,
        "trial_start": now,
        "trial_end": trial_end,
        "metadata": {"maker_slug": TEST_MAKER_SLUG},
    })
    from core import db
    m = await db.makers.find_one({"slug": TEST_MAKER_SLUG}, {"_id": 0})
    assert m["is_in_trial"] is True
    assert m["plus_trial_used"] is True
    assert m["subscription_status"] == "active"  # trialing maps to active
    assert m["trial_end_at"] is not None

    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        r = await c.get(f"{API}/api/maker/subscription", headers=_h(tok))
        body = r.json()
        assert body["is_in_trial"] is True
        assert body["trial_eligible"] is False  # locked
        assert isinstance(body["trial_days_remaining"], int)
        assert 88 <= body["trial_days_remaining"] <= 90


@pytest.mark.asyncio
async def test_active_after_trial_keeps_trial_used_locked():
    """After Stripe flips status from trialing → active, the trial flag
    flips off but `plus_trial_used` must STAY True so a future cancel+
    re-subscribe doesn't grant a second free trial."""
    await _reset_trial_state()
    from routers.subscriptions import _sync_sub_to_maker
    now = int(datetime.now(tz=timezone.utc).timestamp())
    # Step 1: trial active
    await _sync_sub_to_maker({
        "id": "sub_test_trial_2",
        "status": "trialing",
        "current_period_end": now + 90 * 86400,
        "trial_start": now,
        "trial_end": now + 90 * 86400,
        "metadata": {"maker_slug": TEST_MAKER_SLUG},
    })
    # Step 2: 90 days later, trial converts to active. trial_end is still
    # populated on the Stripe object (it points at the past).
    await _sync_sub_to_maker({
        "id": "sub_test_trial_2",
        "status": "active",
        "current_period_start": now + 90 * 86400,
        "current_period_end": now + 120 * 86400,
        "trial_start": now,
        "trial_end": now + 90 * 86400,
        "metadata": {"maker_slug": TEST_MAKER_SLUG},
    })
    from core import db
    m = await db.makers.find_one({"slug": TEST_MAKER_SLUG}, {"_id": 0})
    assert m["is_in_trial"] is False
    assert m["plus_trial_used"] is True  # locked, can't re-trial
    assert m["subscription_status"] == "active"


@pytest.mark.asyncio
async def test_get_subscription_exposes_trial_days_remaining_clamped():
    """`trial_days_remaining` must never go negative (Stripe sometimes
    fires the trial_will_end event a few seconds after trial_end)."""
    await _reset_trial_state()
    from routers.subscriptions import _sync_sub_to_maker
    now = int(datetime.now(tz=timezone.utc).timestamp())
    # Trial that ended 1 hour ago but Stripe still reports trialing
    await _sync_sub_to_maker({
        "id": "sub_test_trial_3",
        "status": "trialing",
        "current_period_end": now - 3600,
        "trial_start": now - 91 * 86400,
        "trial_end": now - 3600,
        "metadata": {"maker_slug": TEST_MAKER_SLUG},
    })
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        r = await c.get(f"{API}/api/maker/subscription", headers=_h(tok))
        body = r.json()
        assert body["trial_days_remaining"] == 0  # clamped
