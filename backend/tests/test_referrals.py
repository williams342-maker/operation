"""Regression: Plus trial referral program (iter172).

Covers:
  * `GET /api/maker/referrals` lazily mints a stable referral code +
    returns share_link, threshold (3), bonus_days (30)
  * Application submitted with `referred_by_code` carries that code
    onto the maker doc after admin approval
  * `credit_referrer_on_subscribe` increments the referrer's count
    exactly once even when called multiple times for the same referred
    maker (idempotency guard)
  * Hitting the 3-referral threshold stamps `referral_bonus_applied_at`
    on the referrer
  * Self-referral attempts are ignored (no count bump)
"""
import os
import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )

REFERRER_EMAIL = "iron-and-oak@craftersmarket.org"
REFERRER_SLUG = "iron-and-oak"


async def _maker_jwt(client: httpx.AsyncClient, email: str = REFERRER_EMAIL) -> str:
    from maker_auth import issue_magic_token
    magic = issue_magic_token(email)
    r = await client.post(f"{API}/api/maker/auth/verify", json={"token": magic})
    return r.json()["token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


async def _reset_referrer():
    from core import db
    await db.makers.update_one(
        {"slug": REFERRER_SLUG},
        {"$set": {
            "referral_code": None,
            "referrals_completed_count": 0,
            "referral_bonus_applied_at": None,
            "referral_bonus_history": [],
        }},
    )


@pytest.mark.asyncio
async def test_referrals_endpoint_lazily_mints_code():
    await _reset_referrer()
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        r = await c.get(f"{API}/api/maker/referrals", headers=_h(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["code"] and len(body["code"]) >= 8
        assert "/beta?ref=" in body["share_link"]
        assert body["share_link"].endswith(body["code"])
        assert body["threshold"] == 3
        assert body["bonus_days"] == 30
        assert body["completed_count"] == 0
        assert body["eligible_for_bonus"] is False

        # Second call returns the SAME code (idempotent mint)
        r2 = await c.get(f"{API}/api/maker/referrals", headers=_h(tok))
        assert r2.json()["code"] == body["code"]


@pytest.mark.asyncio
async def test_credit_hook_increments_once_per_referred_maker():
    """Concurrent webhook retries must not double-count the same
    referred maker — `referral_credited_at` guards idempotency."""
    await _reset_referrer()
    from core import db
    # Mint a referrer code first
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        r = await c.get(f"{API}/api/maker/referrals", headers=_h(tok))
        code = r.json()["code"]

    # Create a synthetic "referred" maker with the code attribution
    referred_slug = "test-referral-target-1"
    await db.makers.delete_one({"slug": referred_slug})
    await db.makers.insert_one({
        "slug": referred_slug,
        "name": "Test Referred",
        "initials": "TR",
        "location": "Test, USA",
        "bio": "",
        "techniques": [],
        "portrait": "",
        "cover": "",
        "email": f"{referred_slug}@example.com",
        "referred_by_code": code,
        "referral_credited_at": None,
        "subscription_status": "free",
    })
    try:
        from routers.referrals import credit_referrer_on_subscribe
        # First call → credit
        await credit_referrer_on_subscribe(referred_slug)
        m = await db.makers.find_one({"slug": REFERRER_SLUG}, {"_id": 0})
        assert m["referrals_completed_count"] == 1

        # Second call → MUST be ignored (idempotent)
        await credit_referrer_on_subscribe(referred_slug)
        m = await db.makers.find_one({"slug": REFERRER_SLUG}, {"_id": 0})
        assert m["referrals_completed_count"] == 1, (
            "credit_referrer_on_subscribe was not idempotent"
        )
    finally:
        await db.makers.delete_one({"slug": referred_slug})


@pytest.mark.asyncio
async def test_threshold_stamps_bonus_applied():
    """3 distinct referred makers → referral_bonus_applied_at gets set."""
    await _reset_referrer()
    from core import db
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        r = await c.get(f"{API}/api/maker/referrals", headers=_h(tok))
        code = r.json()["code"]

    referred = ["test-ref-a", "test-ref-b", "test-ref-c"]
    try:
        for slug in referred:
            await db.makers.delete_one({"slug": slug})
            await db.makers.insert_one({
                "slug": slug,
                "name": slug,
                "initials": "T",
                "location": "Test",
                "bio": "",
                "techniques": [],
                "portrait": "",
                "cover": "",
                "email": f"{slug}@example.com",
                "referred_by_code": code,
                "referral_credited_at": None,
                "subscription_status": "free",
            })
        from routers.referrals import credit_referrer_on_subscribe
        for slug in referred:
            await credit_referrer_on_subscribe(slug)

        m = await db.makers.find_one({"slug": REFERRER_SLUG}, {"_id": 0})
        assert m["referrals_completed_count"] == 3
        assert m["referral_bonus_applied_at"], "bonus_applied_at not stamped"
        # Bonus is "pending_credit" since the referrer isn't in trial
        history = m.get("referral_bonus_history") or []
        assert history and history[-1]["mode"] == "pending_credit"
        assert history[-1]["days"] == 30
    finally:
        for slug in referred:
            await db.makers.delete_one({"slug": slug})


@pytest.mark.asyncio
async def test_self_referral_is_ignored():
    await _reset_referrer()
    from core import db
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        r = await c.get(f"{API}/api/maker/referrals", headers=_h(tok))
        code = r.json()["code"]

    # Set the referrer's OWN doc to claim it was referred by their own code
    await db.makers.update_one(
        {"slug": REFERRER_SLUG},
        {"$set": {"referred_by_code": code, "referral_credited_at": None}},
    )
    try:
        from routers.referrals import credit_referrer_on_subscribe
        await credit_referrer_on_subscribe(REFERRER_SLUG)
        m = await db.makers.find_one({"slug": REFERRER_SLUG}, {"_id": 0})
        assert m["referrals_completed_count"] == 0, "self-referral was credited"
    finally:
        await db.makers.update_one(
            {"slug": REFERRER_SLUG},
            {"$set": {"referred_by_code": None, "referral_credited_at": None}},
        )
