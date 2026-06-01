"""
iter315 — Per-listing marketing budgets regression test.

Covers:
- Maker can upsert + read + delete a per-listing budget
- Owner-gating (can't set budget on someone else's listing)
- Draft listings rejected
- Auto-renew tick: rolls month, decrements headroom, accrues charge,
  bumps promoted_until, increments spent_cents
- Budget cap respected: tick does NOT renew when headroom < $5
- 24h-window guard: tick skips listings still promoted > 24h out
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import requests

sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


def _mint_maker(slug: str) -> str:
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_session_jwt
    return issue_session_jwt(slug, f"{slug}@test.local", role="maker")


async def _ensure_maker_with_published(slug: str, product_slug: str) -> None:
    from core import db, now_iso
    await db.makers.update_one(
        {"slug": slug},
        {"$setOnInsert": {
            "slug": slug, "name": f"Test {slug}",
            "email": f"{slug}@test.local",
            "created_at": now_iso(),
            "deleted_at": None,
        }},
        upsert=True,
    )
    await db.products.update_one(
        {"slug": product_slug},
        {"$setOnInsert": {
            "slug": product_slug,
            "maker_slug": slug,
            "title": f"Test product {product_slug}",
            "status": "published",
            "price_cents": 5000,
            "deleted_at": None,
            "created_at": now_iso(),
        }},
        upsert=True,
    )


async def _cleanup(slug: str, product_slug: str) -> None:
    from core import db
    await db.maker_listing_budgets.delete_many({"maker_slug": slug})
    await db.products.delete_one({"slug": product_slug})
    await db.makers.delete_one({"slug": slug})


def _setup_fixture():
    slug = f"iter315-{uuid4().hex[:8]}"
    prod = f"iter315-prod-{uuid4().hex[:6]}"
    asyncio.get_event_loop().run_until_complete(_ensure_maker_with_published(slug, prod))
    return slug, prod


def _teardown_fixture(slug: str, prod: str):
    asyncio.get_event_loop().run_until_complete(_cleanup(slug, prod))


def test_maker_upsert_read_delete_budget():
    slug, prod = _setup_fixture()
    jwt = _mint_maker(slug)
    H = {"Authorization": f"Bearer {jwt}"}
    try:
        # PUT — create
        r = requests.put(
            f"{API}/maker/listing-budgets/{prod}",
            json={"monthly_cap_cents": 2000, "auto_renew": True},
            headers=H, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["monthly_cap_cents"] == 2000
        assert body["auto_renew"] is True
        assert body["spent_cents"] == 0

        # GET — list returns it, with decorated fields
        r = requests.get(f"{API}/maker/listing-budgets", headers=H, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["budgets"]) == 1
        row = body["budgets"][0]
        assert row["product_slug"] == prod
        assert row["product_title"]      # decorated
        assert "impressions_mtd" in row  # decorated
        assert "conversions_mtd" in row

        # PUT — update (cap raised, auto_renew off)
        r = requests.put(
            f"{API}/maker/listing-budgets/{prod}",
            json={"monthly_cap_cents": 5000, "auto_renew": False},
            headers=H, timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["monthly_cap_cents"] == 5000
        assert r.json()["auto_renew"] is False

        # DELETE
        r = requests.delete(f"{API}/maker/listing-budgets/{prod}",
                            headers=H, timeout=15)
        assert r.status_code == 200
        assert r.json()["deleted"] == 1
    finally:
        _teardown_fixture(slug, prod)


def test_owner_gating_rejects_other_makers_product():
    slug, prod = _setup_fixture()
    other_slug = f"iter315-other-{uuid4().hex[:8]}"
    jwt = _mint_maker(other_slug)
    try:
        r = requests.put(
            f"{API}/maker/listing-budgets/{prod}",
            json={"monthly_cap_cents": 1000, "auto_renew": True},
            headers={"Authorization": f"Bearer {jwt}"}, timeout=15,
        )
        assert r.status_code == 404, r.text
    finally:
        _teardown_fixture(slug, prod)


def test_draft_listing_rejected():
    slug, prod = _setup_fixture()
    asyncio.get_event_loop().run_until_complete(
        _set_status(prod, "draft")
    )
    jwt = _mint_maker(slug)
    try:
        r = requests.put(
            f"{API}/maker/listing-budgets/{prod}",
            json={"monthly_cap_cents": 1000, "auto_renew": True},
            headers={"Authorization": f"Bearer {jwt}"}, timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "published" in r.text.lower()
    finally:
        _teardown_fixture(slug, prod)


async def _set_status(slug: str, status: str):
    from core import db
    await db.products.update_one({"slug": slug}, {"$set": {"status": status}})


def test_renew_tick_charges_and_increments_spent():
    """Direct call of the renew_listing_budgets_tick — verify it
    accrues a $5 charge and increments spent_cents when budget allows
    and listing isn't actively boosted."""
    from routers.listing_budgets import renew_listing_budgets_tick

    slug, prod = _setup_fixture()
    loop = asyncio.get_event_loop()
    try:
        # Seed a budget with $20 cap, auto_renew=true, $0 spent.
        from core import db, now_iso
        loop.run_until_complete(db.maker_listing_budgets.insert_one({
            "maker_slug": slug,
            "product_slug": prod,
            "monthly_cap_cents": 2000,
            "auto_renew": True,
            "spent_cents": 0,
            "period_start": datetime.now(timezone.utc).strftime("%Y-%m-01"),
            "last_renewed_at": None,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }))

        result = loop.run_until_complete(renew_listing_budgets_tick())
        assert result["renewed"] >= 1, result

        # Budget row should have $5 spent and last_renewed_at set
        row = loop.run_until_complete(
            db.maker_listing_budgets.find_one(
                {"maker_slug": slug, "product_slug": prod}, {"_id": 0}
            )
        )
        assert row["spent_cents"] == 500
        assert row["last_renewed_at"] is not None
        # Product should be promoted now
        p = loop.run_until_complete(
            db.products.find_one({"slug": prod}, {"_id": 0, "promoted_until": 1})
        )
        assert p["promoted_until"] is not None
        assert p["promoted_until"] > datetime.now(timezone.utc).isoformat()
    finally:
        _teardown_fixture(slug, prod)


def test_renew_tick_respects_cap():
    """Listings already at their cap must NOT be renewed."""
    from routers.listing_budgets import renew_listing_budgets_tick
    slug, prod = _setup_fixture()
    loop = asyncio.get_event_loop()
    try:
        from core import db, now_iso
        loop.run_until_complete(db.maker_listing_budgets.insert_one({
            "maker_slug": slug,
            "product_slug": prod,
            "monthly_cap_cents": 500,           # only $5
            "auto_renew": True,
            "spent_cents": 500,                  # already maxed
            "period_start": datetime.now(timezone.utc).strftime("%Y-%m-01"),
            "last_renewed_at": now_iso(),
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }))
        result = loop.run_until_complete(renew_listing_budgets_tick())
        assert result["skipped_capped"] >= 1
        # Row unchanged
        row = loop.run_until_complete(
            db.maker_listing_budgets.find_one(
                {"maker_slug": slug, "product_slug": prod}, {"_id": 0}
            )
        )
        assert row["spent_cents"] == 500
    finally:
        _teardown_fixture(slug, prod)


def test_renew_tick_skips_listings_still_boosted_over_24h():
    """If a listing's promoted_until is more than 24h out, the tick
    skips it. This is what keeps us at ≤1 charge/wk per listing
    regardless of cron frequency."""
    from routers.listing_budgets import renew_listing_budgets_tick
    slug, prod = _setup_fixture()
    loop = asyncio.get_event_loop()
    try:
        from core import db, now_iso
        future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
        loop.run_until_complete(db.products.update_one(
            {"slug": prod}, {"$set": {"promoted_until": future}}
        ))
        loop.run_until_complete(db.maker_listing_budgets.insert_one({
            "maker_slug": slug,
            "product_slug": prod,
            "monthly_cap_cents": 2000,
            "auto_renew": True,
            "spent_cents": 500,
            "period_start": datetime.now(timezone.utc).strftime("%Y-%m-01"),
            "last_renewed_at": now_iso(),
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }))
        result = loop.run_until_complete(renew_listing_budgets_tick())
        assert result["skipped_active"] >= 1
        # Row unchanged (spent_cents still 500)
        row = loop.run_until_complete(
            db.maker_listing_budgets.find_one(
                {"maker_slug": slug, "product_slug": prod}, {"_id": 0}
            )
        )
        assert row["spent_cents"] == 500
    finally:
        _teardown_fixture(slug, prod)
