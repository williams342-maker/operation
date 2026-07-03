"""iter331d — 9-slot Meet-Our-Makers (1 hero + 2 featured + 6 grid).

Focus of this file:
  1. Public GET returns rotation.hero_count=1, featured_count=2,
     grid_count=6, window=9 by default. items[] ordered hero → featured → grid.
  2. PATCH admin config with {hero_count, featured_count, grid_count}
     persists and reshapes the next GET.
  3. PATCH validation: negatives rejected, oversized clamped
     (hero_count>3 → 3, featured_count>6 → 6, grid_count>24 → 24).
  4. Ledger rows include the positions {hero, featured, grid} dict
     alongside the flat featured_slugs list.
  5. Refill preserves the tier: when the hero maker closes their shop
     mid-period, the vacated slot must be filled with the next-best
     eligible maker who INHERITS position='hero' (not grid).
"""
from __future__ import annotations

import os
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
    await db.homepage_rotation_ledger.delete_many({})
    await db.makers.update_many(
        {},
        {"$unset": {
            "homepage_impression_count": "",
            "last_homepage_featured_at": "",
            "homepage_position_counts": "",
            "shop_closed": "",
        }},
    )


@pytest.mark.asyncio
async def test_default_1_2_6_layout():
    """Default config yields 1 hero + 2 featured + 6 grid = window 9."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(PUB); r.raise_for_status()
            body = r.json()
        rot = body["rotation"]
        assert rot["hero_count"] == 1
        assert rot["featured_count"] == 2
        assert rot["grid_count"] == 6
        assert rot["window"] == 9
        positions = [m.get("position") for m in body["items"]]
        # Ordering must be hero(s) first, then featured, then grid.
        expected_order = (
            ["hero"] * positions.count("hero")
            + ["featured"] * positions.count("featured")
            + ["grid"] * positions.count("grid")
        )
        assert positions == expected_order, f"positions out of tier order: {positions}"
    finally:
        await _reset_state(db)


@pytest.mark.asyncio
async def test_patch_reshapes_to_2_3_4():
    """PATCH {hero_count:2, featured_count:3, grid_count:4} → window=9
    with 2+3+4 layout on the next GET. Restore defaults after."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    jwt = await _admin_jwt()
    h = {"Authorization": f"Bearer {jwt}"}
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.patch(CFG, headers=h, json={
                "hero_count": 2, "featured_count": 3, "grid_count": 4,
            })
            assert r.status_code == 200, r.text
            cfg = r.json()
            assert cfg["hero_count"] == 2
            assert cfg["featured_count"] == 3
            assert cfg["grid_count"] == 4
            assert cfg["window"] == 9

            r2 = await c.get(PUB); r2.raise_for_status()
            body = r2.json()
            assert body["rotation"]["window"] == 9
            positions = [m.get("position") for m in body["items"]]
            elig = body["rotation"]["eligible_total"]
            assert positions.count("hero") == min(2, elig)
            assert positions.count("featured") == min(3, max(0, elig - 2))
            assert positions.count("grid") == min(4, max(0, elig - 5))
    finally:
        async with httpx.AsyncClient(timeout=30) as c:
            await c.patch(CFG, headers=h, json={
                "hero_count": 1, "featured_count": 2, "grid_count": 6,
            })
        await _reset_state(db)


@pytest.mark.asyncio
async def test_patch_validation_negative_rejected_and_extreme_clamped():
    """Negatives → 400. Oversized values → clamped to per-tier caps."""
    jwt = await _admin_jwt()
    h = {"Authorization": f"Bearer {jwt}"}
    async with httpx.AsyncClient(timeout=30) as c:
        # Snapshot to restore after.
        original = (await c.get(CFG, headers=h)).json()

        # Negative rejected on each tier.
        for key in ("hero_count", "featured_count", "grid_count"):
            r = await c.patch(CFG, headers=h, json={key: -1})
            assert r.status_code == 400, (
                f"{key}=-1 should be rejected but got {r.status_code}: {r.text}"
            )

        # Oversized clamped. Spec: hero>3→3, featured>6→6, grid>24→24.
        r = await c.patch(CFG, headers=h, json={"hero_count": 99})
        assert r.status_code == 200 and r.json()["hero_count"] == 3, r.text
        r = await c.patch(CFG, headers=h, json={"featured_count": 99})
        assert r.status_code == 200 and r.json()["featured_count"] == 6, r.text
        r = await c.patch(CFG, headers=h, json={"grid_count": 999})
        assert r.status_code == 200 and r.json()["grid_count"] == 24, r.text

        # Restore.
        await c.patch(CFG, headers=h, json={
            "hero_count": original.get("hero_count", 1),
            "featured_count": original.get("featured_count", 2),
            "grid_count": original.get("grid_count", 6),
        })


@pytest.mark.asyncio
async def test_ledger_records_positions_dict():
    """Ledger row must include positions: {hero:[…], featured:[…], grid:[…]}
    alongside the flat featured_slugs list."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(PUB); r.raise_for_status()
            items = r.json()["items"]
        rows = await db.homepage_rotation_ledger.find({}, {"_id": 0}).to_list(5)
        assert len(rows) == 1
        row = rows[0]
        assert "positions" in row, f"ledger row missing 'positions': keys={list(row)}"
        pos = row["positions"]
        assert set(pos) >= {"hero", "featured", "grid"}
        # Ledger positions must match the returned items exactly.
        want_hero = [m["slug"] for m in items if m.get("position") == "hero"]
        want_feat = [m["slug"] for m in items if m.get("position") == "featured"]
        want_grid = [m["slug"] for m in items if m.get("position") == "grid"]
        assert pos["hero"] == want_hero
        assert pos["featured"] == want_feat
        assert pos["grid"] == want_grid
        # Flat list still present.
        assert row["featured_slugs"] == [m["slug"] for m in items]
    finally:
        await _reset_state(db)


@pytest.mark.asyncio
async def test_refill_preserves_hero_tier():
    """Close the hero maker mid-period; vacated slot must refill and
    the replacement must inherit position='hero' — never cascade to grid.
    Featured + grid slots keep their original occupants."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r1 = await c.get(PUB); r1.raise_for_status()
            first = r1.json()["items"]
            if len(first) < r1.json()["rotation"]["window"]:
                pytest.skip("Not enough eligible makers for refill test")
            hero1 = next(m for m in first if m["position"] == "hero")
            featured_slugs = [m["slug"] for m in first if m["position"] == "featured"]
            grid_slugs = [m["slug"] for m in first if m["position"] == "grid"]

            # Take the hero offline.
            await db.makers.update_one({"slug": hero1["slug"]}, {"$set": {"shop_closed": True}})

            r2 = await c.get(PUB); r2.raise_for_status()
            second = r2.json()["items"]
            hero_slugs_after = [m["slug"] for m in second if m["position"] == "hero"]
            featured_slugs_after = [m["slug"] for m in second if m["position"] == "featured"]
            grid_slugs_after = [m["slug"] for m in second if m["position"] == "grid"]

        # (a) Closed maker gone.
        assert hero1["slug"] not in [m["slug"] for m in second]
        # (b) Refill sits in hero slot (not grid).
        assert len(hero_slugs_after) == 1, (
            f"hero tier vacated instead of refilled: {hero_slugs_after}"
        )
        assert hero_slugs_after[0] != hero1["slug"]
        # (c) Featured + grid untouched.
        assert featured_slugs_after == featured_slugs, (
            f"featured tier shifted: {featured_slugs} → {featured_slugs_after}"
        )
        assert grid_slugs_after == grid_slugs, (
            f"grid tier shifted: {grid_slugs} → {grid_slugs_after}"
        )
    finally:
        await db.makers.update_many({}, {"$unset": {"shop_closed": ""}})
        await _reset_state(db)


@pytest.mark.asyncio
async def test_position_impression_counters_all_tiers():
    """After a fresh period selection, homepage_position_counts must be
    incremented per tier: hero=1 on the hero, featured=1 on each of the
    2 featured, grid=1 on each of the 6 grid. homepage_impression_count
    aggregate also +1 on every featured maker."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(PUB); r.raise_for_status()
            items = r.json()["items"]
        for m in items:
            doc = await db.makers.find_one(
                {"slug": m["slug"]},
                {"_id": 0, "homepage_position_counts": 1, "homepage_impression_count": 1},
            )
            assert doc is not None
            counts = doc.get("homepage_position_counts") or {}
            pos = m["position"]
            assert counts.get(pos) == 1, (
                f"{m['slug']} tier={pos} → counts={counts}"
            )
            # Other tiers should be 0/absent.
            for other in {"hero", "featured", "grid"} - {pos}:
                assert counts.get(other, 0) == 0, (
                    f"{m['slug']} unexpectedly counted in {other}: {counts}"
                )
            assert doc.get("homepage_impression_count") == 1
    finally:
        await _reset_state(db)
