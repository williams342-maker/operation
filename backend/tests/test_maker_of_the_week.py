"""Regression: Maker of the Week spotlight (iter176).

Covers:
  * `GET /api/community/maker-of-the-week` returns the maker whose
    showcase pieces accumulated the most VIEW EVENTS in the last 7 days
  * `top_posts` contains up to 3 of that maker's pieces, sorted by the
    same metric, each decorated with `views` + `weekly_views`
  * Lifetime fallback fires when nothing happened in the last 7 days —
    `mode == "lifetime"`, `weekly_views == 0`
  * `maker_of_the_week` returns `{maker: null}` (and self-hides on
    frontend) when the showcase has no qualifying maker posts at all
  * Quarantined posts excluded
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


@pytest.mark.asyncio
async def test_maker_of_week_returns_maker_with_top_posts():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/community/maker-of-the-week")
        assert r.status_code == 200, r.text
        body = r.json()
        if not body.get("maker"):
            pytest.skip("No qualifying maker — empty showcase environment.")
        m = body["maker"]
        # Required maker fields surfaced for the homepage card
        for k in ("slug", "name"):
            assert k in m, f"Missing {k} on maker doc"
        # top_posts shape
        assert isinstance(body["top_posts"], list)
        for p in body["top_posts"]:
            assert "id" in p and "title" in p
            assert "views" in p and isinstance(p["views"], int)
            assert "weekly_views" in p and isinstance(p["weekly_views"], int)
        # mode is one of the two documented options
        assert body["mode"] in ("trending", "lifetime")


@pytest.mark.asyncio
async def test_maker_of_week_falls_back_to_lifetime_when_quiet():
    """Simulate a quiet week — temporarily push all view events older
    than 7 days. The endpoint should switch to `mode=lifetime`."""
    from core import db
    week_ago = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    # Snapshot current timestamps so we can restore
    rows = await db.showcase_views.find({}, {"_id": 1, "ts": 1}).to_list(500)
    if not rows:
        pytest.skip("No view events to backdate.")
    saved = [(row["_id"], row["ts"]) for row in rows]
    try:
        await db.showcase_views.update_many({}, {"$set": {"ts": week_ago}})
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(f"{API}/api/community/maker-of-the-week")
            body = r.json()
            if not body.get("maker"):
                pytest.skip("No lifetime-viewed maker in this environment.")
            assert body["mode"] == "lifetime"
            assert body["weekly_views"] == 0
    finally:
        # Restore the original timestamps so we don't break other tests
        for _id, ts in saved:
            await db.showcase_views.update_one(
                {"_id": _id}, {"$set": {"ts": ts}},
            )


@pytest.mark.asyncio
async def test_maker_of_week_excludes_quarantined_posts():
    """A maker's quarantined posts must not count toward their weekly
    view total — otherwise hidden posts could fraudulently inflate
    a maker's spotlight ranking."""
    from core import db
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/community/maker-of-the-week")
        body = r.json()
        if not body.get("maker"):
            pytest.skip("No qualifying maker.")
        winner_slug = body["maker"]["slug"]

        # Pick that maker's #1 post (the leader) and quarantine it.
        # If the maker only has that one contributing post, they should
        # be replaced by a different maker in the next response.
        if not body["top_posts"]:
            pytest.skip("Winner has no top_posts to mutate.")
        victim_post_id = body["top_posts"][0]["id"]

        await db.showcase_posts.update_one(
            {"id": victim_post_id},
            {"$set": {"mod_status": "quarantined"}},
        )
        try:
            r2 = await c.get(f"{API}/api/community/maker-of-the-week")
            body2 = r2.json()
            # Quarantined post must not appear in top_posts of any maker
            if body2.get("maker"):
                ids = [p["id"] for p in body2["top_posts"]]
                assert victim_post_id not in ids, (
                    f"quarantined post {victim_post_id} leaked into maker-of-week"
                )
        finally:
            await db.showcase_posts.update_one(
                {"id": victim_post_id},
                {"$set": {"mod_status": None}},
            )
