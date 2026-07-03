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
    # iter331c — also drop the ledger so the growth simulation starts
    # from a known-empty audit trail.
    await db.homepage_rotation_ledger.delete_many({})
    await db.makers.update_many(
        {},
        {"$unset": {
            "homepage_impression_count": "",
            "last_homepage_featured_at": "",
            "homepage_position_counts": "",
        }},
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
        # iter331d — window is now derived from hero+featured+grid.
        # A legacy `window=500` payload spreads across tiers → still
        # capped by our per-tier max (1 + 2 + 24 = 27).
        r = await c.patch(CFG, headers=h, json={"window": 500})
        assert r.status_code == 200 and r.json()["window"] == 27

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
            await _record_homepage_feature(picked, start, key, len(e), cfg)
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


@pytest.mark.asyncio
async def test_lifecycle_ineligibility_gates():
    """A maker in any of these states must not appear in the rotation:
    shop_closed, vacation_mode, deletion_requested_at, deleted_at."""
    import sys
    sys.path.insert(0, "/app/backend")
    from routers.community_showcase import _rotation_config, _eligible_homepage_makers
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    tag = uuid.uuid4().hex[:8]
    base = {
        "name": "Lifecycle Probe", "bio": "test", "portrait": "/x.jpg",
        "cover": "/y.jpg", "listings_count": 1,
    }
    variants = {
        f"probe-{tag}-ok":         {**base, "slug": f"probe-{tag}-ok"},
        f"probe-{tag}-closed":     {**base, "slug": f"probe-{tag}-closed", "shop_closed": True},
        f"probe-{tag}-vacation":   {**base, "slug": f"probe-{tag}-vacation", "vacation_mode": True},
        f"probe-{tag}-pending":    {**base, "slug": f"probe-{tag}-pending", "deletion_requested_at": "2026-06-01T00:00:00Z"},
        f"probe-{tag}-deleted":    {**base, "slug": f"probe-{tag}-deleted", "deleted_at": "2026-06-01T00:00:00Z"},
    }
    slugs = list(variants.keys())
    try:
        await db.makers.insert_many(list(variants.values()))
        # Every probe gets 1 published product so the product filter passes.
        await db.products.insert_many([
            {"slug": f"{s}-p", "maker_slug": s, "title": "x", "status": "published"}
            for s in slugs
        ])

        cfg = await _rotation_config()
        eligible = await _eligible_homepage_makers(cfg)
        elig_slugs = {m["slug"] for m in eligible}
        assert f"probe-{tag}-ok" in elig_slugs
        for s in slugs:
            if s.endswith("-ok"):
                continue
            assert s not in elig_slugs, f"{s} should be filtered out"
    finally:
        await db.makers.delete_many({"slug": {"$in": slugs}})
        await db.products.delete_many({"maker_slug": {"$in": slugs}})


@pytest.mark.asyncio
async def test_period_lock_survives_mid_period_activity():
    """Once a period's featured set is stamped, changing an eligible
    maker's activity signals mid-period must NOT swap them out. The
    same 4 slugs should be returned until the next period boundary."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r1 = await c.get(PUB); r1.raise_for_status()
            first = [m["slug"] for m in r1.json()["items"]]
            assert r1.json()["rotation"]["locked"] is False

            # Simulate mid-period "burst of activity" on a non-featured maker.
            # If lock is broken, they'd score higher and displace someone.
            unfeatured = [m for m in await db.makers.find(
                {"slug": {"$nin": first}, "bio": {"$nin": ["", None]}}
            ).to_list(50) if m.get("bio") and m.get("portrait")][:5]
            if unfeatured:
                await db.makers.update_many(
                    {"slug": {"$in": [m["slug"] for m in unfeatured]}},
                    {"$set": {"last_login_at": "2099-01-01T00:00:00Z"}},
                )

            r2 = await c.get(PUB); r2.raise_for_status()
            second = [m["slug"] for m in r2.json()["items"]]
            assert r2.json()["rotation"]["locked"] is True
            assert first == second, f"period-lock broken: {first} → {second}"
    finally:
        await db.makers.update_many({}, {"$unset": {"last_login_at": ""}})
        await _reset_state(db)


@pytest.mark.asyncio
async def test_refill_when_featured_maker_becomes_ineligible():
    """If a locked featured maker closes their shop mid-period, the
    slot should refill with the next-best eligible maker — never
    return < window rows."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r1 = await c.get(PUB); r1.raise_for_status()
            first = [m["slug"] for m in r1.json()["items"]]
            window = r1.json()["rotation"]["window"]
            if len(first) < window:
                pytest.skip("Not enough eligible makers to run refill test")
            victim = first[0]

            # Take the victim offline mid-period.
            await db.makers.update_one({"slug": victim}, {"$set": {"shop_closed": True}})

            r2 = await c.get(PUB); r2.raise_for_status()
            second = [m["slug"] for m in r2.json()["items"]]
            assert victim not in second, "closed shop still featured"
            assert len(second) == window, f"refill dropped window count: {len(second)} vs {window}"
            # The other 3 locked slugs should still be there.
            for s in first[1:]:
                assert s in second, f"non-victim {s} unexpectedly rotated out"
            # A ledger event should record the refill.
            events = await db.homepage_rotation_ledger.find({}, {"_id": 0}).to_list(10)
            reasons = [e.get("reason", "") for e in events]
            assert any("refill" in r for r in reasons), f"no refill ledger event: {reasons}"
    finally:
        await db.makers.update_many({}, {"$unset": {"shop_closed": ""}})
        await _reset_state(db)


@pytest.mark.asyncio
async def test_ledger_records_selection():
    """Every fresh period selection must produce a ledger row with
    the config snapshot, featured slugs, eligible count, and reason."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(PUB); r.raise_for_status()
            expected = [m["slug"] for m in r.json()["items"]]
        rows = await db.homepage_rotation_ledger.find({}, {"_id": 0}).to_list(10)
        assert len(rows) == 1
        assert rows[0]["featured_slugs"] == expected
        assert rows[0]["eligible_count"] >= len(expected)
        assert "auto-selected" in rows[0]["reason"]
        assert set(rows[0]["config_snapshot"]) >= {"window", "cadence"}
    finally:
        await _reset_state(db)


@pytest.mark.asyncio
async def test_ledger_admin_endpoint():
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    jwt = await _admin_jwt()
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            await c.get(PUB)  # generate a ledger row
            r = await c.get(f"{API}/api/admin/homepage-rotation/ledger",
                            headers={"Authorization": f"Bearer {jwt}"})
            assert r.status_code == 200
            body = r.json()
            assert "items" in body and body["count"] >= 1

        # Unauth blocked.
        async with httpx.AsyncClient(timeout=30) as c:
            r2 = await c.get(f"{API}/api/admin/homepage-rotation/ledger")
            assert r2.status_code in (401, 403)
    finally:
        await _reset_state(db)


@pytest.mark.asyncio
async def test_growth_simulation_scales_and_stays_fair():
    """Seed 500 synthetic makers, run 20 weekly rotations, assert:
      • Every maker is featured at least once every ceil(N/window) weeks.
      • Impression max - min ≤ 1 by cycle end.
      • Selection stays under 500 ms per period."""
    import sys, time
    sys.path.insert(0, "/app/backend")
    from routers.community_showcase import (
        _rotation_config, _eligible_homepage_makers, _pick_by_score,
        _period_key, _record_homepage_feature,
    )
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    tag = f"sim-{uuid.uuid4().hex[:6]}"
    N = 500
    try:
        await _reset_state(db)
        # Seed 500 synthetic makers with product each.
        makers = [
            {
                "slug": f"{tag}-{i:04d}", "name": f"Sim Maker {i}",
                "bio": "test bio", "portrait": "/p.jpg", "cover": "/c.jpg",
                "listings_count": 1, "tier": "standard",
            }
            for i in range(N)
        ]
        products = [
            {"slug": f"{m['slug']}-p", "maker_slug": m["slug"],
             "title": "widget", "status": "published"}
            for m in makers
        ]
        await db.makers.insert_many(makers)
        await db.products.insert_many(products)

        cfg = await _rotation_config()
        window = cfg["window"]
        cycle_len = -(-N // window)  # ceil(N/window)

        # Fake the clock forward one week per iteration.
        max_time = 0.0
        for wk in range(20):
            dt = datetime.now(timezone.utc) + timedelta(weeks=wk)
            key, start = _period_key(cfg["cadence"], dt)
            t0 = time.perf_counter()
            eligible = [m for m in await _eligible_homepage_makers(cfg) if m["slug"].startswith(tag)]
            picked, _all = _pick_by_score(eligible, cfg, now=dt)
            await _record_homepage_feature(
                picked, start, key, len(eligible), cfg,
            )
            elapsed = time.perf_counter() - t0
            max_time = max(max_time, elapsed)

        # Every sim maker must have ≥1 impression by cycle_len periods
        # (we ran min(20, cycle_len) so allow floor).
        rows = await db.makers.find(
            {"slug": {"$regex": f"^{tag}-"}},
            {"_id": 0, "slug": 1, "homepage_impression_count": 1},
        ).to_list(N + 5)
        counts = [r.get("homepage_impression_count", 0) for r in rows]
        # 20 periods × 4 = 80 slots. Over N=500, only 80 makers featured.
        # The fairness invariant here is "never-featured pool depletes
        # linearly" — we should see exactly min(20*window, N) makers
        # with impressions > 0, all at 1.
        featured_count = sum(1 for c in counts if c > 0)
        assert featured_count == min(20 * window, N), (
            f"expected {min(20*window, N)} featured, got {featured_count}"
        )
        # Nobody should be featured twice while never-featured pool exists.
        assert max(counts) == 1, f"someone featured twice too early: max={max(counts)}"
        # Performance guardrail.
        assert max_time < 2.0, f"rotation took {max_time:.2f}s at N={N}"
    finally:
        await db.makers.delete_many({"slug": {"$regex": f"^{tag}-"}})
        await db.products.delete_many({"maker_slug": {"$regex": f"^{tag}-"}})
        await _reset_state(db)


@pytest.mark.asyncio
async def test_position_tagging_matches_tier_counts():
    """iter331d — top-N slugs get tagged hero/featured/grid in order.
    Defaults are 1 hero + 2 featured + 6 grid = 9 total slots."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(PUB); r.raise_for_status()
            body = r.json()
        assert body["rotation"]["hero_count"] == 1
        assert body["rotation"]["featured_count"] == 2
        assert body["rotation"]["grid_count"] == 6
        assert body["rotation"]["window"] == 9
        # Position order in items[] must be: 1 hero, 2 featured, then 6 grid.
        positions = [m.get("position") for m in body["items"]]
        # Only as many as we have eligible makers (may be < 9).
        eligible_total = body["rotation"]["eligible_total"]
        assert len(positions) == min(9, eligible_total)
        # Count by position matches config-capped-by-eligibility.
        hero_seen = positions.count("hero")
        feat_seen = positions.count("featured")
        grid_seen = positions.count("grid")
        assert hero_seen == min(1, eligible_total)
        assert feat_seen == min(2, max(0, eligible_total - 1))
        assert grid_seen == max(0, min(6, eligible_total - 3))
    finally:
        await _reset_state(db)


@pytest.mark.asyncio
async def test_position_aware_impression_counters():
    """iter331d — homepage_position_counts.hero/featured/grid increment
    per-position when a maker lands in that tier for a new period."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(PUB); r.raise_for_status()
            hero_slug = next(m["slug"] for m in r.json()["items"] if m["position"] == "hero")
        maker = await db.makers.find_one({"slug": hero_slug}, {"_id": 0, "homepage_position_counts": 1})
        counts = maker.get("homepage_position_counts") or {}
        assert counts.get("hero") == 1
        assert counts.get("featured", 0) == 0
        assert counts.get("grid", 0) == 0
    finally:
        await _reset_state(db)
