"""iter331 · extra coverage requested by review.

Complements test_iter331_homepage_rotation.py:

  1. Admin auth gate — 401/403 on all three admin endpoints without JWT.
  2. Cadence switch — cadence=daily flips period_key prefix from 'week:'
     to 'day:YYYY-MM-DD'.
  3. Never-featured bonus dominates already-featured makers on score.
  4. Founder-boost toggle: with boost off two identical rows tie; with
     it on the founder scores strictly higher.
  5. Impression idempotency at HTTP layer — 5 back-to-back GETs on
     /api/community/homepage-makers produce impression_count == 1.
  6. Public endpoint has no auth requirement.

Every test cleans up any state it writes.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )

PUB = f"{API}/api/community/homepage-makers"
CFG = f"{API}/api/admin/homepage-rotation/config"
PREV = f"{API}/api/admin/homepage-rotation/preview"


async def _admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token(os.environ["OPS_EMAIL"])
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{API}/api/admin/auth/verify", json={"token": tok})
    r.raise_for_status()
    return r.json()["token"]


async def _reset_state(db):
    await db.system_state.delete_one({"key": "homepage_rotation_state"})
    await db.system_state.delete_one({"key": "homepage_rotation_config"})
    await db.makers.update_many(
        {},
        {"$unset": {"homepage_impression_count": "", "last_homepage_featured_at": ""}},
    )


# ── 1. Admin auth gate ─────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_admin_endpoints_require_admin_jwt():
    async with httpx.AsyncClient(timeout=30) as c:
        r1 = await c.get(CFG)
        r2 = await c.patch(CFG, json={"window": 3})
        r3 = await c.get(PREV)
    assert r1.status_code in (401, 403), r1.status_code
    assert r2.status_code in (401, 403), r2.status_code
    assert r3.status_code in (401, 403), r3.status_code


# ── 2. Public endpoint requires no auth ────────────────────────────────
@pytest.mark.asyncio
async def test_public_endpoint_no_auth_required():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(PUB)  # no auth header
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and "rotation" in body


# ── 3. Cadence switch flips period_key prefix ──────────────────────────
@pytest.mark.asyncio
async def test_cadence_switch_daily_flips_period_key():
    jwt = await _admin_jwt()
    h = {"Authorization": f"Bearer {jwt}"}
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            # Set daily
            r = await c.patch(CFG, headers=h, json={"cadence": "daily"})
            assert r.status_code == 200 and r.json()["cadence"] == "daily"
            r2 = await c.get(PUB)
            assert r2.status_code == 200
            pk = r2.json()["rotation"]["period_key"]
            assert pk.startswith("day:"), f"period_key should start with 'day:' got {pk!r}"
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            assert today in pk, f"expected today's date in period_key: {pk!r}"
            # Reset to weekly
            r3 = await c.patch(CFG, headers=h, json={"cadence": "weekly"})
            assert r3.status_code == 200 and r3.json()["cadence"] == "weekly"
            r4 = await c.get(PUB)
            assert r4.json()["rotation"]["period_key"].startswith("week:")
    finally:
        async with httpx.AsyncClient(timeout=30) as c:
            await c.patch(CFG, headers=h, json={"cadence": "weekly", "excluded_slugs": []})
        await _reset_state(db)


# ── 4. Impression idempotency at HTTP layer ────────────────────────────
@pytest.mark.asyncio
async def test_impression_idempotency_http_5_hits():
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r1 = await c.get(PUB)
            r1.raise_for_status()
            slugs = [m["slug"] for m in r1.json()["items"]]
            for _ in range(4):
                await c.get(PUB)
        for s in slugs:
            doc = await db.makers.find_one({"slug": s},
                                           {"_id": 0, "homepage_impression_count": 1})
            assert (doc or {}).get("homepage_impression_count") == 1, s
    finally:
        await _reset_state(db)


# ── 5. Never-featured bonus + Founder boost via pure scoring engine ────
@pytest.mark.asyncio
async def test_never_featured_bonus_and_founder_boost_scoring():
    """Use the pure scoring function directly with synthetic docs so we
    don't need to mutate real maker rows. This exercises the same code
    path production uses to rank."""
    import sys
    sys.path.insert(0, "/app/backend")
    from routers.community_showcase import _score_maker

    now = datetime.now(timezone.utc)

    base = {
        "slug": "test-a",
        "tier": "standard",
        "created_at": (now.replace(year=now.year - 2)).isoformat(),
        "last_homepage_featured_at": None,
        "homepage_impression_count": 0,
    }
    featured = {
        **base,
        "slug": "test-b",
        "last_homepage_featured_at": now.isoformat(),  # just featured
        "homepage_impression_count": 5,
    }

    cfg_no_boost = {
        "window": 4, "cadence": "weekly",
        "founder_boost_enabled": False, "founder_boost_points": 100,
        "new_maker_boost_days": 30, "new_maker_boost_points": 500,
        "impression_penalty_per_feature": 5,
        "never_featured_bonus": 10_000,
        "excluded_slugs": [],
    }

    # 5a. never-featured maker scores much higher than a recently-featured one
    s_never, _ = _score_maker(base, now, cfg_no_boost)
    s_feat, _ = _score_maker(featured, now, cfg_no_boost)
    assert s_never > s_feat, f"never-featured ({s_never}) should beat featured ({s_feat})"
    assert (s_never - s_feat) > 9_000, "never_featured_bonus should dominate score"

    # 5b. founder_boost toggle
    founder = {**base, "slug": "test-c", "tier": "founder"}
    standard = {**base, "slug": "test-d", "tier": "standard"}

    s_f_off, _ = _score_maker(founder, now, cfg_no_boost)
    s_s_off, _ = _score_maker(standard, now, cfg_no_boost)
    assert s_f_off == s_s_off, f"With boost OFF scores must tie: {s_f_off} vs {s_s_off}"

    cfg_boost = {**cfg_no_boost, "founder_boost_enabled": True}
    s_f_on, _ = _score_maker(founder, now, cfg_boost)
    s_s_on, _ = _score_maker(standard, now, cfg_boost)
    assert s_f_on > s_s_on, f"With boost ON founder must score higher: {s_f_on} vs {s_s_on}"
    assert (s_f_on - s_s_on) == cfg_boost["founder_boost_points"]


# ── 6. Eligibility filter: seed → visible → invalidate → hidden ────────
@pytest.mark.asyncio
async def test_eligibility_bio_removal_hides_maker():
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    jwt = await _admin_jwt()
    h = {"Authorization": f"Bearer {jwt}"}

    seed_slug = f"test-elig-seed-x"  # matches the test/beta noise regex, so we'll pick a valid slug
    # NOTE: the eligibility regex excludes ^(test-|iter\d+-|beta-|TEST_). So use a
    # non-blocked slug to actually appear.
    seed_slug = "elig-probe-maker-iter331"

    seed_maker = {
        "id": "elig-probe-iter331-id",
        "slug": seed_slug,
        "name": "Eligibility Probe Maker",
        "initials": "EP",
        "bio": "Bio for eligibility test — please ignore.",
        "portrait": "https://example.com/portrait.png",
        "cover": "https://example.com/cover.png",
        "location": "Testville",
        "tier": "standard",
        "techniques": ["CUSTOM"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    }
    seed_product = {
        "id": "elig-probe-product-iter331-id",
        "maker_slug": seed_slug,
        "status": "published",
        "title": "Eligibility Probe Product",
        "deleted_at": None,
    }

    try:
        await _reset_state(db)
        await db.makers.insert_one(dict(seed_maker))
        await db.products.insert_one(dict(seed_product))

        # First call — force excluded_slugs=[] so seeded row survives
        async with httpx.AsyncClient(timeout=30) as c:
            await c.patch(CFG, headers=h, json={"excluded_slugs": []})
            r1 = await c.get(PREV, headers=h)
            assert r1.status_code == 200
            slugs_in_scored = [x["slug"] for x in r1.json()["scored"]]
            assert seed_slug in slugs_in_scored, "seeded maker must appear in scored preview"

        # Now null out bio → maker should disappear
        await db.makers.update_one({"slug": seed_slug}, {"$set": {"bio": ""}})
        async with httpx.AsyncClient(timeout=30) as c:
            r2 = await c.get(PREV, headers=h)
            assert r2.status_code == 200
            slugs_in_scored = [x["slug"] for x in r2.json()["scored"]]
            assert seed_slug not in slugs_in_scored, "maker with empty bio should be excluded"

    finally:
        # Full cleanup
        await db.makers.delete_one({"slug": seed_slug})
        await db.products.delete_one({"maker_slug": seed_slug})
        await _reset_state(db)
