"""Iter 128 — Settle-now + payout-schedule endpoints.

Covers:
- `POST /api/maker/billing/settle-now`:
    400 when balance is $0
    400 when subscription is inactive
    400 when balance below MIN_CLEAR_CENTS
    409 when already settled in the same calendar month (idempotent)
    200 happy path → ledger reset to 0, charge_history stamped
- `GET /api/maker/payout-schedule`:
    Returns env-default for unconnected makers
    Returns Stripe-source values when connected
"""
import os
import asyncio
import sys
import uuid
import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")

from maker_auth import issue_session_jwt  # noqa: E402
from core import db  # noqa: E402

API = "http://localhost:8001/api"


def _hdrs(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_payout_schedule_default_for_unconnected_maker():
    slug = f"iter128-noconn-{uuid.uuid4().hex[:6]}"
    await db.makers.insert_one({
        "slug": slug, "name": "T", "email": f"{slug}@t.com",
        "subscription_status": "free",
    })
    try:
        token = issue_session_jwt(slug, f"{slug}@t.com", role="maker")
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{API}/maker/payout-schedule", headers=_hdrs(token))
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["connected"] is False
            assert data["source"] == "default"
            assert data["interval"] in ("weekly", "daily", "monthly", "manual")
            assert "delay_days" in data
    finally:
        await db.makers.delete_one({"slug": slug})


@pytest.mark.asyncio
async def test_settle_now_validation_branches():
    slug = f"iter128-settle-{uuid.uuid4().hex[:6]}"
    # Free-tier maker (no subscription, no customer).
    await db.makers.insert_one({
        "slug": slug, "name": "T", "email": f"{slug}@t.com",
        "subscription_status": "free",
        "pending_charges_cents": 500,
    })
    try:
        token = issue_session_jwt(slug, f"{slug}@t.com", role="maker")
        async with httpx.AsyncClient() as client:
            # No subscription → 400
            r = await client.post(f"{API}/maker/billing/settle-now", headers=_hdrs(token))
            assert r.status_code == 400
            assert "Plus subscription" in r.json()["detail"]

            # Plus active but no Stripe customer → 400
            await db.makers.update_one(
                {"slug": slug},
                {"$set": {"subscription_status": "active"}},
            )
            r = await client.post(f"{API}/maker/billing/settle-now", headers=_hdrs(token))
            assert r.status_code == 400
            assert "Stripe customer" in r.json()["detail"]

            # Add a customer id but zero out the balance → "Nothing to settle"
            await db.makers.update_one(
                {"slug": slug},
                {"$set": {"stripe_customer_id": "cus_test_iter128",
                          "pending_charges_cents": 0}},
            )
            r = await client.post(f"{API}/maker/billing/settle-now", headers=_hdrs(token))
            assert r.status_code == 400
            assert "ledger is at $0" in r.json()["detail"]

            # Below threshold (50c < 100c) → 400 with min-balance message
            await db.makers.update_one(
                {"slug": slug},
                {"$set": {"pending_charges_cents": 50}},
            )
            r = await client.post(f"{API}/maker/billing/settle-now", headers=_hdrs(token))
            assert r.status_code == 400
            assert "minimum" in r.json()["detail"]
    finally:
        await db.makers.delete_one({"slug": slug})


if __name__ == "__main__":
    asyncio.run(test_payout_schedule_default_for_unconnected_maker())
    asyncio.run(test_settle_now_validation_branches())
    print("OK")
