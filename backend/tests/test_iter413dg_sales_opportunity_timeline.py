"""iter413dg — Sales Opportunity indicator + Progress Timeline + Roll-up.

Locks the three Phase-C backend additions:
  • `sales_opportunity` (qualitative 5★ indicator) on every coaching response
  • Progress Timeline endpoint with per-snapshot deltas
  • Maker listings roll-up endpoint (worst-first prioritization)
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

from quality.engine import evaluate
from quality.impact import prioritize, _sales_opportunity

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://active-project-4.preview.emergentagent.com"
).rstrip("/")


# ── Sales opportunity calibration ─────────────────────────────────────
@pytest.mark.parametrize("gap,expected_level,expected_stars", [
    (60, "high", 5),
    (45, "high", 5),
    (30, "high", 4),
    (15, "moderate", 3),
    (7, "low", 2),
    (1, "saturated", 1),
    (0, "saturated", 1),
])
def test_sales_opportunity_calibration(gap, expected_level, expected_stars):
    op = _sales_opportunity(percent=50.0, gap=gap)
    assert op["level"] == expected_level, (gap, op)
    assert op["stars"] == expected_stars, (gap, op)
    assert op["label"]   # always present, non-empty


def test_coaching_payload_includes_sales_opportunity():
    card = evaluate("listing_quality", "v1", {})  # empty listing → huge gap
    plan = prioritize(card, identifier="x")
    assert "sales_opportunity" in plan
    op = plan["sales_opportunity"]
    assert op["level"] == "high"
    assert op["stars"] == 5
    # The opportunity must drop as the gap shrinks.
    near_perfect = {
        "image": "x", "images": ["a","b","c","d","e"],
        "description": "a" * 320,
        "listing_video": {"url": "u"},
        "shipping_profile_id": "p",
        "title": "Hand-Forged Brass Pour Spout",
        "slug": "near-perfect",
        "meta_description": "Sturdy hand-forged brass spout. " * 4,
        "materials": ["brass", "leather", "linseed"],
    }
    card2 = evaluate("listing_quality", "v1", near_perfect)
    plan2 = prioritize(card2, identifier="np")
    assert plan2["sales_opportunity"]["stars"] <= 2


# ── HTTP fixtures ─────────────────────────────────────────────────────
def _make_jwt(email: str) -> str:
    from maker_auth import issue_magic_token
    tok = issue_magic_token(email)
    r = requests.post(f"{BASE_URL}/api/maker/auth/verify",
                      json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture()
def maker_with_listings():
    """Seed a maker + 3 listings of varying quality so the roll-up
    + timeline can be exercised."""
    from motor.motor_asyncio import AsyncIOMotorClient
    maker_slug = f"dg-{uuid.uuid4().hex[:6]}"
    email = f"{maker_slug}@test.com"
    slugs = [f"dg-{uuid.uuid4().hex[:8]}" for _ in range(3)]

    async def _seed():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.makers.insert_one({
            "id": str(uuid.uuid4()), "slug": maker_slug, "email": email,
            "name": "DG Test", "shop_name": "DG Test", "initials": "DG",
            "status": "approved", "tier": "standard",
            "subscription_status": "free", "session_version": 0,
        })
        # Poor listing
        await db.products.insert_one({
            "id": str(uuid.uuid4()), "slug": slugs[0], "maker_slug": maker_slug,
            "title": "x", "description": "y", "image": None, "images": [],
            "meta_description": "", "materials": [], "deleted_at": None,
            "status": "active",
        })
        # Middling
        await db.products.insert_one({
            "id": str(uuid.uuid4()), "slug": slugs[1], "maker_slug": maker_slug,
            "title": "Brass Pour Spout — handmade",
            "description": "Hand-forged brass spout. " * 8,
            "image": "x", "images": ["a","b","c"],
            "meta_description": "Hand-forged brass spout from Vermont. " * 2,
            "materials": ["brass"], "deleted_at": None,
            "status": "active",
        })
        # Strong
        await db.products.insert_one({
            "id": str(uuid.uuid4()), "slug": slugs[2], "maker_slug": maker_slug,
            "title": "Hand-Forged Brass Pour Spout",
            "description": "a" * 320,
            "image": "x", "images": ["a","b","c","d","e"],
            "listing_video": {"url": "u"}, "shipping_profile_id": "p",
            "meta_description": "Sturdy hand-forged brass spout. " * 4,
            "materials": ["brass","leather","linseed"], "deleted_at": None,
            "status": "active",
        })
        c.close()
    asyncio.run(_seed())
    jwt = _make_jwt(email)
    yield maker_slug, slugs, jwt

    async def _wipe():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.makers.delete_one({"slug": maker_slug})
        await db.products.delete_many({"slug": {"$in": slugs}})
        await db.quality_score_snapshots.delete_many({"listing_slug": {"$in": slugs}})
        c.close()
    asyncio.run(_wipe())


# ── Roll-up endpoint ──────────────────────────────────────────────────
def test_rollup_orders_listings_worst_first(maker_with_listings):
    _, slugs, jwt = maker_with_listings
    r = requests.get(
        f"{BASE_URL}/api/maker/listings-coaching/rollup",
        headers={"Authorization": f"Bearer {jwt}"}, timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 3
    # Worst-first: percent must be non-decreasing across the array.
    percents = [row["percent"] for row in body["rows"]]
    assert percents == sorted(percents), percents
    # First (worst) row has the highest sales opportunity stars.
    first = body["rows"][0]
    last = body["rows"][-1]
    assert first["sales_opportunity"]["stars"] >= last["sales_opportunity"]["stars"]
    # Each row carries the next-action preview.
    for row in body["rows"]:
        if row["percent"] < 100:
            assert row["next_action_label"]
            assert row["next_action_points"] > 0


# ── Progress Timeline ────────────────────────────────────────────────
def test_timeline_captures_score_progression(maker_with_listings):
    """Read coaching twice on the poor listing → improve it directly
    in mongo → read coaching again → timeline must surface the delta."""
    maker_slug, slugs, jwt = maker_with_listings
    poor_slug = slugs[0]
    H = {"Authorization": f"Bearer {jwt}"}

    # Hit #1
    r1 = requests.get(
        f"{BASE_URL}/api/maker/listings/{poor_slug}/coaching",
        headers=H, timeout=20,
    )
    assert r1.status_code == 200
    score_before = r1.json()["score"]

    # Improve the listing — add a cover photo + materials.
    async def _improve():
        from motor.motor_asyncio import AsyncIOMotorClient
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        await c[os.environ["DB_NAME"]].products.update_one(
            {"slug": poor_slug},
            {"$set": {
                "image": "https://cdn/x.jpg",
                "images": ["a", "b", "c"],
                "materials": ["brass", "leather", "linseed"],
            }},
        )
        c.close()
    asyncio.run(_improve())

    # Hit #2 — should snapshot the improved score.
    r2 = requests.get(
        f"{BASE_URL}/api/maker/listings/{poor_slug}/coaching",
        headers=H, timeout=20,
    )
    assert r2.status_code == 200
    score_after = r2.json()["score"]
    assert score_after > score_before, (score_before, score_after)

    # Timeline endpoint
    t = requests.get(
        f"{BASE_URL}/api/maker/listings/{poor_slug}/coaching/timeline",
        headers=H, timeout=20,
    )
    assert t.status_code == 200, t.text
    timeline = t.json()
    assert timeline["listing_slug"] == poor_slug
    assert len(timeline["entries"]) >= 2
    # Newest entry first — its delta must show the gain.
    newest = timeline["entries"][0]
    assert newest["score"] == score_after
    assert newest["score_delta"] > 0
    # Deltas array must mention at least one rule that moved.
    moved_rules = {d["rule_id"] for d in newest["deltas"]}
    # We added cover_photo, photo_count, materials — at least one
    # must appear in the deltas.
    assert moved_rules & {"cover_photo", "photo_count", "materials"}, newest["deltas"]


def test_timeline_dedupes_identical_snapshots(maker_with_listings):
    """Two consecutive coaching reads with no changes must result in
    a SINGLE snapshot row, not two — keeps the timeline meaningful."""
    _, slugs, jwt = maker_with_listings
    H = {"Authorization": f"Bearer {jwt}"}
    slug = slugs[1]
    # Three hits with no listing changes between.
    for _ in range(3):
        r = requests.get(
            f"{BASE_URL}/api/maker/listings/{slug}/coaching",
            headers=H, timeout=20,
        )
        assert r.status_code == 200

    # Inspect raw snapshot count for this listing.
    async def _count():
        from motor.motor_asyncio import AsyncIOMotorClient
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        n = await c[os.environ["DB_NAME"]].quality_score_snapshots.count_documents(
            {"listing_slug": slug},
        )
        c.close()
        return n
    n = asyncio.run(_count())
    assert n == 1, f"expected exactly 1 dedup snapshot, got {n}"


def test_timeline_owner_gated(maker_with_listings):
    _, slugs, _ = maker_with_listings
    from maker_auth import issue_magic_token
    from motor.motor_asyncio import AsyncIOMotorClient
    other = f"otherdg-{uuid.uuid4().hex[:6]}"
    email = f"{other}@test.com"

    async def _seed_other():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        await c[os.environ["DB_NAME"]].makers.insert_one({
            "id": str(uuid.uuid4()), "slug": other, "email": email,
            "name": "X", "shop_name": "X", "initials": "X",
            "status": "approved", "tier": "standard",
            "subscription_status": "free", "session_version": 0,
        })
        c.close()
    asyncio.run(_seed_other())
    try:
        tok = issue_magic_token(email)
        other_jwt = requests.post(
            f"{BASE_URL}/api/maker/auth/verify", json={"token": tok}, timeout=15,
        ).json()["token"]
        r = requests.get(
            f"{BASE_URL}/api/maker/listings/{slugs[0]}/coaching/timeline",
            headers={"Authorization": f"Bearer {other_jwt}"}, timeout=20,
        )
        assert r.status_code == 403
    finally:
        async def _wipe():
            c = AsyncIOMotorClient(os.environ["MONGO_URL"])
            await c[os.environ["DB_NAME"]].makers.delete_one({"slug": other})
            c.close()
        asyncio.run(_wipe())
