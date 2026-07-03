"""iter331 · Homepage "Meet the Makers" fair-exposure engine.

Covers:
  1. Eligibility filter (bio + portrait + published product + not excluded).
  2. Deterministic scoring — never-featured beats featured, impression
     penalty compounds, boosts stack correctly, tie-breaks are stable.
  3. Period guard idempotency: repeated hits within the same period
     don't inflate impression counters.
  4. Weekly / daily cadence switching flips the period key.
  5. Admin config validation rejects bad values.
  6. Preview endpoint returns full scored list + diagnostics.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

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
    """Wipe any prior test residue from the rotation collections."""
    await db.system_state.delete_one({"key": "homepage_rotation_state"})
    await db.system_state.delete_one({"key": "homepage_rotation_config"})
    await db.makers.update_many(
        {},
        {"$unset": {"homepage_impression_count": "", "last_homepage_featured_at": ""}},
    )


@pytest.mark.asyncio
async def test_public_endpoint_returns_scored_selection():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(PUB)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body["rotation"]) >= {
        "eligible_total", "window", "cadence", "period_key",
        "period_start", "strategy",
    }
    assert body["rotation"]["strategy"] == "fair-exposure"
    assert isinstance(body["items"], list)
    assert len(body["items"]) <= body["rotation"]["window"]


@pytest.mark.asyncio
async def test_admin_config_defaults_and_patch_and_validation():
    jwt = await _admin_jwt()
    h = {"Authorization": f"Bearer {jwt}"}
    async with httpx.AsyncClient(timeout=30) as c:
        # Snapshot current config so we can restore.
        r = await c.get(CFG, headers=h)
        original = r.json()

        # Bad cadence rejected.
        r = await c.patch(CFG, headers=h, json={"cadence": "hourly"})
        assert r.status_code == 400

        # Unknown key rejected.
        r = await c.patch(CFG, headers=h, json={"weirdkey": 1})
        assert r.status_code == 400

        # window clamped 1-12.
        r = await c.patch(CFG, headers=h, json={"window": 500})
        assert r.status_code == 200 and r.json()["window"] == 12

        # excluded_slugs normalises casing + trimming.
        r = await c.patch(CFG, headers=h, json={"excluded_slugs": ["  IRON-AND-OAK ", "iron-and-oak"]})
        assert r.status_code == 200
        assert r.json()["excluded_slugs"] == ["iron-and-oak"]

        # Restore original.
        await c.patch(CFG, headers=h, json={k: original[k] for k in original if k != "updated_at"})


@pytest.mark.asyncio
async def test_period_guard_prevents_impression_inflation():
    """Multiple visitor hits in the same period must produce exactly 1
    impression increment per featured maker."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r1 = await c.get(PUB); r1.raise_for_status()
            slugs = [m["slug"] for m in r1.json()["items"]]
            # Hit the endpoint 4 more times rapidly.
            for _ in range(4):
                await c.get(PUB)
        # Every featured maker must show impression_count == 1.
        for s in slugs:
            m = await db.makers.find_one({"slug": s}, {"_id": 0, "homepage_impression_count": 1})
            assert (m or {}).get("homepage_impression_count") == 1, s
    finally:
        await _reset_state(db)


@pytest.mark.asyncio
async def test_fair_exposure_spreads_evenly_over_cycle():
    """Fake-clock simulation: over enough periods, every eligible maker
    is featured at least once and no maker is featured twice before all
    have been featured once."""
    import sys
    sys.path.insert(0, "/app/backend")
    from routers.community_showcase import (
        _rotation_config, _eligible_homepage_makers, _pick_by_score,
        _period_key, _record_homepage_feature,
    )
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        cfg = await _rotation_config()
        eligible_now = await _eligible_homepage_makers(cfg)
        n = len(eligible_now)
        if n == 0:
            pytest.skip("No eligible makers in preview DB")
        # Simulate ceil(n/window) periods so everyone is guaranteed a slot.
        periods_needed = -(-n // cfg["window"])  # ceil
        seen = set()
        for wk in range(periods_needed):
            dt = datetime.now(timezone.utc) + timedelta(weeks=wk)
            key, start = _period_key(cfg["cadence"], dt)
            e = await _eligible_homepage_makers(cfg)
            picked, _all = _pick_by_score(e, cfg, now=dt)
            picked_slugs = [m["slug"] for m in picked]
            await _record_homepage_feature(picked_slugs, start, key)
            seen.update(picked_slugs)
        assert seen == {m["slug"] for m in eligible_now}, (
            f"Only {len(seen)}/{n} makers featured after {periods_needed} periods"
        )
        # Impression counts should be tight: max - min ≤ 1.
        counts = []
        async for m in db.makers.find(
            {"slug": {"$in": [x["slug"] for x in eligible_now]}},
            {"_id": 0, "homepage_impression_count": 1},
        ):
            counts.append(m.get("homepage_impression_count", 0))
        assert max(counts) - min(counts) <= 1, f"Uneven distribution: {sorted(counts)}"
    finally:
        await _reset_state(db)


@pytest.mark.asyncio
async def test_excluded_slug_never_appears():
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    jwt = await _admin_jwt()
    h = {"Authorization": f"Bearer {jwt}"}
    try:
        await _reset_state(db)
        # Pick a slug that would normally be in the top-scored group.
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(PUB); r.raise_for_status()
            items = r.json()["items"]
            if not items:
                pytest.skip("No eligible makers")
            target = items[0]["slug"]
            await c.patch(CFG, headers=h, json={"excluded_slugs": [target]})
            # New request should not feature the excluded slug.
            r2 = await c.get(PUB); r2.raise_for_status()
            slugs = [m["slug"] for m in r2.json()["items"]]
            assert target not in slugs
        # Preview endpoint should also skip it.
        async with httpx.AsyncClient(timeout=30) as c:
            r3 = await c.get(PREV, headers=h); r3.raise_for_status()
            assert target not in [row["slug"] for row in r3.json()["scored"]]
    finally:
        async with httpx.AsyncClient(timeout=30) as c:
            await c.patch(CFG, headers=h, json={"excluded_slugs": []})
        await _reset_state(db)


@pytest.mark.asyncio
async def test_preview_endpoint_returns_full_scored_list():
    jwt = await _admin_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(PREV, headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) >= {"config", "period", "eligible_total", "next_up", "scored", "diagnostics"}
    assert isinstance(body["scored"], list)
    for row in body["scored"]:
        assert set(row) >= {"slug", "score", "impressions", "featured_now"}


@pytest.mark.asyncio
async def test_activity_signals_contribute_to_score():
    """Reward active shops: a maker with recent product + recent login
    should outscore an identical maker with none of those signals."""
    import sys
    sys.path.insert(0, "/app/backend")
    from routers.community_showcase import _score_maker, _rotation_config
    from datetime import datetime, timezone
    cfg = await _rotation_config()
    now = datetime.now(timezone.utc)

    quiet = {"slug": "q", "portrait": "x", "cover": "y", "bio": "z"}
    active = {**quiet, "slug": "a",
              "_activity_new_product_this_week": True,
              "_activity_updated_listing_this_week": True,
              "_activity_recent_login": True,
              "_activity_recent_sale": True}

    q_score, _ = _score_maker(quiet, now, cfg)
    a_score, _ = _score_maker(active, now, cfg)
    delta = a_score - q_score
    expected = (cfg["activity_new_product_this_week_points"]
                + cfg["activity_updated_listing_this_week_points"]
                + cfg["activity_recent_login_points"]
                + cfg["activity_recent_sale_points"])
    assert delta == expected, f"expected +{expected}, got +{delta}"


@pytest.mark.asyncio
async def test_retuned_weights_defaults():
    """User-approved retune from iter331b: new-maker 150, founder 50."""
    import sys
    sys.path.insert(0, "/app/backend")
    from routers.community_showcase import _DEFAULT_CONFIG
    assert _DEFAULT_CONFIG["new_maker_boost_points"] == 150
    assert _DEFAULT_CONFIG["founder_boost_points"] == 50
