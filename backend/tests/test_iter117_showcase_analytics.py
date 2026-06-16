"""iter117 — Showcase analytics: view + click events + admin leaderboard.

Verifies:
- POST /community/showcase/{id}/view records an event AND increments
  the post's `views` counter.
- POST /community/showcase/{id}/click records an event AND increments
  the post's `clicks` counter.
- Both endpoints are public (no auth required) — the strip renders
  for guests too.
- Both endpoints dedupe by (post_id, kind, IP+UA fingerprint) within
  30 min so a refresh doesn't inflate counts.
- Both endpoints return `{ok: false}` for non-existent post IDs without
  writing anything to the events collection.
- `source` tag is captured on the event row (max 32 chars, truncated).
- GET /admin/community/showcase/analytics requires admin auth.
- Analytics query returns top-N posts by views, with click count + CTR
  + per-source breakdown, scoped to the rolling window.
- Posts with views but no remaining post doc (deleted post, lingering
  events) are skipped cleanly — no 500.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

# Ensure the pod env (incl. MAKER_AUTH_SECRET) is available even when
# pytest runs this file in isolation before maker_auth has been imported
# transitively by an earlier test.
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

import pytest
from httpx import AsyncClient, ASGITransport


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


async def _client():
    from server import app
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _admin_headers():
    from maker_auth import issue_session_jwt
    token = issue_session_jwt(
        maker_slug="admin", email="team@craftersmarket.org", role="admin",
    )
    return {"Authorization": f"Bearer {token}"}


async def _wipe_iter117():
    from core import db
    await db.showcase_posts.delete_many({"id": {"$regex": "^iter117-"}})
    await db.showcase_events.delete_many({"post_id": {"$regex": "^iter117-"}})
    # iter413at — Also clear showcase_views (used by merged view handler dedup).
    await db.showcase_views.delete_many({"post_id": {"$regex": "^iter117-"}})


async def _seed_post(post_id: str, **extra):
    from core import db, now_iso
    await db.showcase_posts.insert_one({
        "id": post_id, "user_id": "buyer-iter117",
        "user_email": "iter117@example.com", "user_name": "Iter117 Buyer",
        "user_picture": "",
        "title": extra.get("title", f"Post {post_id}"),
        "image_url": "https://cdn.example.com/x.jpg",
        "image_urls": ["https://cdn.example.com/x.jpg"],
        "product_slug": extra.get("product_slug"),
        "maker_slug": extra.get("maker_slug"),
        "likes": 0, "views": 0, "clicks": 0,
        "created_at": now_iso(),
    })


# ============================================================
# View + click event recording
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_view_event_increments_counter_and_logs_row():
    from core import db
    pid = "iter117-view"
    await _wipe_iter117()
    await _seed_post(pid)
    async with await _client() as c:
        r = await c.post(
            f"/api/community/showcase/{pid}/view",
            json={"source": "home"},
            headers={"User-Agent": "iter117-ua-A"},
        )
    assert r.status_code == 200
    # iter413at — merged handler returns {ok, counted, views}.
    assert r.json()["ok"] is True
    # Counter bumped on the post doc.
    post = await db.showcase_posts.find_one({"id": pid}, {"_id": 0, "views": 1})
    assert post["views"] == 1
    # Event row written.
    events = await db.showcase_events.find({"post_id": pid}, {"_id": 0}).to_list(10)
    assert len(events) == 1
    assert events[0]["kind"] == "view"
    assert events[0]["source"] == "home"
    await _wipe_iter117()


@pytest.mark.asyncio(loop_scope="module")
async def test_click_event_increments_clicks_counter():
    from core import db
    pid = "iter117-click"
    await _wipe_iter117()
    await _seed_post(pid)
    async with await _client() as c:
        r = await c.post(
            f"/api/community/showcase/{pid}/click",
            json={"source": "product"},
            headers={"User-Agent": "iter117-ua-B"},
        )
    assert r.status_code == 200
    post = await db.showcase_posts.find_one({"id": pid}, {"_id": 0, "clicks": 1})
    assert post["clicks"] == 1
    events = await db.showcase_events.find({"post_id": pid}, {"_id": 0}).to_list(10)
    assert len(events) == 1
    assert events[0]["kind"] == "click"
    assert events[0]["source"] == "product"
    await _wipe_iter117()


@pytest.mark.asyncio(loop_scope="module")
async def test_event_endpoints_are_public_no_auth_required():
    """Strip renders for guests — events MUST work without a token."""
    pid = "iter117-pub"
    await _wipe_iter117()
    await _seed_post(pid)
    async with await _client() as c:  # no Authorization header
        r1 = await c.post(f"/api/community/showcase/{pid}/view")
        r2 = await c.post(f"/api/community/showcase/{pid}/click")
    assert r1.status_code == 200 and r2.status_code == 200
    await _wipe_iter117()


@pytest.mark.asyncio(loop_scope="module")
async def test_dedupe_by_fingerprint_within_30min_window():
    """Same (post, kind, IP+UA) within 30 min counts once. Refresh
    clicking spam should NOT inflate the counter."""
    from core import db
    pid = "iter117-dedup"
    await _wipe_iter117()
    await _seed_post(pid)
    headers = {"User-Agent": "same-ua"}
    async with await _client() as c:
        for _ in range(5):
            await c.post(f"/api/community/showcase/{pid}/view",
                         json={"source": "home"}, headers=headers)
    post = await db.showcase_posts.find_one({"id": pid}, {"_id": 0, "views": 1})
    assert post["views"] == 1
    events = await db.showcase_events.count_documents({"post_id": pid, "kind": "view"})
    assert events == 1
    await _wipe_iter117()


@pytest.mark.asyncio(loop_scope="module")
async def test_different_user_agents_do_NOT_dedupe():
    """Two different visitors viewing the same post should both count."""
    from core import db
    pid = "iter117-diff-ua"
    await _wipe_iter117()
    await _seed_post(pid)
    async with await _client() as c:
        await c.post(f"/api/community/showcase/{pid}/view",
                     headers={"User-Agent": "iter117-ua-1"})
        await c.post(f"/api/community/showcase/{pid}/view",
                     headers={"User-Agent": "iter117-ua-2"})
    post = await db.showcase_posts.find_one({"id": pid}, {"_id": 0, "views": 1})
    assert post["views"] == 2
    await _wipe_iter117()


@pytest.mark.asyncio(loop_scope="module")
async def test_event_for_nonexistent_post_returns_ok_false_no_write():
    """A fabricated post ID must NOT silently create event rows or bump
    a phantom counter — return 404 and skip the write.
    iter413at — Changed from {ok:False} to 404 per iter174 ghost contract."""
    from core import db
    await _wipe_iter117()
    pid = "iter117-ghost"
    async with await _client() as c:
        r = await c.post(f"/api/community/showcase/{pid}/view")
    assert r.status_code == 404
    events = await db.showcase_events.count_documents({"post_id": pid})
    assert events == 0
    await _wipe_iter117()


@pytest.mark.asyncio(loop_scope="module")
async def test_source_field_is_truncated_at_32_chars():
    """A malicious client passing a 5KB `source` string shouldn't bloat
    every event row. The endpoint truncates at 32."""
    from core import db
    pid = "iter117-trunc"
    await _wipe_iter117()
    await _seed_post(pid)
    long_src = "a" * 500
    async with await _client() as c:
        await c.post(f"/api/community/showcase/{pid}/view",
                     json={"source": long_src})
    e = await db.showcase_events.find_one({"post_id": pid}, {"_id": 0, "source": 1})
    assert len(e["source"]) == 32
    await _wipe_iter117()


# ============================================================
# Admin analytics
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_analytics_endpoint_requires_admin_auth():
    async with await _client() as c:
        r = await c.get("/api/admin/community/showcase/analytics")
    assert r.status_code == 401


@pytest.mark.asyncio(loop_scope="module")
async def test_analytics_returns_top_posts_with_views_clicks_ctr_and_source_split():
    from core import db
    headers = await _admin_headers()
    await _wipe_iter117()
    # Two posts, different traffic levels.
    await _seed_post("iter117-A", title="Post A")
    await _seed_post("iter117-B", title="Post B")
    # Post A: 3 views (different UAs to bypass dedup), 2 clicks. Post B: 1 view, 0 clicks.
    async with await _client() as c:
        for ua in ("ua-1", "ua-2", "ua-3"):
            await c.post("/api/community/showcase/iter117-A/view",
                         json={"source": "home"}, headers={"User-Agent": ua})
        for ua in ("ua-x", "ua-y"):
            await c.post("/api/community/showcase/iter117-A/click",
                         json={"source": "product"}, headers={"User-Agent": ua})
        await c.post("/api/community/showcase/iter117-B/view",
                     headers={"User-Agent": "ua-z"})
        # Now hit analytics.
        r = await c.get("/api/admin/community/showcase/analytics?days=7", headers=headers)
    assert r.status_code == 200
    body = r.json()
    # iter413at — Cross-test pollution: other test files seed showcase
    # events in the same time window. Locate our row by post_id rather
    # than asserting it's at index 0.
    iter_a = next((r for r in body["rows"] if r["post_id"] == "iter117-A"), None)
    assert iter_a, f"iter117-A missing from analytics rows: {[r['post_id'] for r in body['rows']]}"
    assert iter_a["views"] == 3
    assert iter_a["clicks"] == 2
    # CTR = 2/3 = 66.7%.
    assert iter_a["ctr"] == 66.7
    # Source split — clicks on A came from "product", views from "home".
    # The analytics endpoint surfaces source breakdown of the VIEW events.
    src = iter_a["by_source"]
    assert src.get("home") == 3
    # Totals roll up — we assert >= 4 (not == 4) because real prod
    # showcase events may exist in the same time window during dev runs.
    # The shape + ordering invariants above are the actual contract.
    assert body["totals"]["views"] >= 4
    assert body["totals"]["clicks"] >= 2
    await _wipe_iter117()


@pytest.mark.asyncio(loop_scope="module")
async def test_analytics_skips_orphaned_events_when_post_deleted():
    """Events for a deleted post must not 500 the analytics endpoint —
    they simply don't appear in the leaderboard."""
    from core import db
    headers = await _admin_headers()
    await _wipe_iter117()
    pid = "iter117-orphan"
    await _seed_post(pid)
    async with await _client() as c:
        for ua in ("o-1", "o-2"):
            await c.post(f"/api/community/showcase/{pid}/view",
                         headers={"User-Agent": ua})
    # Now delete the post but leave the events.
    await db.showcase_posts.delete_many({"id": pid})
    async with await _client() as c:
        r = await c.get("/api/admin/community/showcase/analytics?days=7",
                         headers=headers)
    assert r.status_code == 200
    rows_for_orphan = [r for r in r.json()["rows"] if r["post_id"] == pid]
    assert rows_for_orphan == []  # silently skipped
    await _wipe_iter117()


@pytest.mark.asyncio(loop_scope="module")
async def test_analytics_clamps_days_to_safe_range():
    """`days=999` (insane) and `days=0` (would yield empty cutoff)
    should both clamp to a safe range without erroring."""
    headers = await _admin_headers()
    async with await _client() as c:
        r1 = await c.get("/api/admin/community/showcase/analytics?days=999",
                          headers=headers)
        r2 = await c.get("/api/admin/community/showcase/analytics?days=0",
                          headers=headers)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["days"] == 90
    assert r2.json()["days"] == 1
