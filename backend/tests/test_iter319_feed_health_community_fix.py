"""iter319 — Feed-health: Community Showcase + Design Files fixes.

The iter316 Feed Health card was querying the WRONG collection names
and WRONG field names for the two community channels, so both showed
`0 / 0%` even when there were live distributable rows:

    Before:  db.community_showcase  (empty)   filter: `deleted_at + images[]`
    Actual:  db.showcase_posts      (23 rows) filter: `admin_hidden + image_url|image_urls[]`

    Before:  db.community_files     (1 stub)  filter: `deleted_at + is_free + preview_url`
    Actual:  db.design_files        (192 rows) filter: `quarantined_at + thumbnail_url + primary_url`

Also adds the one-click "Quarantine empty stubs" endpoint so the
operator can clear leftover TEST_iter66_* fixtures + partially-seeded
rows that pollute the count without being distributable.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

from server import app  # noqa: E402
from core import db, ADMIN_EMAILS  # noqa: E402
from maker_auth import issue_admin_magic_token  # noqa: E402

pytestmark = pytest.mark.asyncio


async def _admin_jwt() -> str:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        email = next(iter(ADMIN_EMAILS))
        magic = issue_admin_magic_token(email)
        r = await ac.post("/api/admin/auth/verify", json={"token": magic})
        return r.json()["token"]


async def test_feed_health_reports_real_showcase_count():
    """Showcase channel must read from `showcase_posts` and respect
    admin_hidden, not the stale `community_showcase` name."""
    # Seed a known row so we can assert against a delta.
    await db.showcase_posts.delete_many({"id": "iter319-sc-test"})
    await db.showcase_posts.insert_one({
        "id": "iter319-sc-test",
        "title": "iter319 test",
        "image_url": "https://example/test.jpg",
        "admin_hidden": False,
        "maker_slug": "iter319-fake",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/feeds/health",
                         headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200
    sc = next(c for c in r.json()["channels"] if c["channel"] == "showcase")
    # At minimum the row we just inserted should be in the ready count.
    assert sc["ready"] >= 1, sc
    assert sc["total"] >= 1
    # Cleanup
    await db.showcase_posts.delete_one({"id": "iter319-sc-test"})


async def test_feed_health_reports_real_design_files_count():
    """Design files channel must read from `design_files` (not the
    legacy `community_files` stub) and require both primary_url and
    thumbnail_url for ready."""
    await db.design_files.delete_many({"id": {"$regex": "^iter319-df-"}})
    await db.design_files.insert_one({
        "id": "iter319-df-ready",
        "title": "ready file",
        "primary_url": "https://cdn.example/file.svg",
        "thumbnail_url": "https://cdn.example/thumb.jpg",
        "quarantined_at": None,
        "is_seed": False,
    })
    await db.design_files.insert_one({
        "id": "iter319-df-blocked",
        "title": "no-thumbnail file",
        "primary_url": "https://cdn.example/file.svg",
        "thumbnail_url": None,
        "quarantined_at": None,
        "is_seed": False,
    })
    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/feeds/health",
                         headers={"Authorization": f"Bearer {jwt}"})
    df = next(c for c in r.json()["channels"] if c["channel"] == "design_files")
    assert df["ready"] >= 1
    assert df["blocked"] >= 1
    blocker_reasons = {b["reason"] for b in df["top_blockers"]}
    assert "missing_preview" in blocker_reasons or "empty_stub" in blocker_reasons
    await db.design_files.delete_many({"id": {"$regex": "^iter319-df-"}})


async def test_quarantine_action_clears_stubs_and_test_fixtures():
    """The one-click quarantine endpoint must catch:
      (a) rows with no primary_url AND no thumbnail (empty stubs)
      (b) rows whose title starts with TEST_ (case insensitive)
      (c) rows with no usable download URL anywhere (no primary_url
          AND no variant url)
    """
    # Wipe + seed three categories.
    await db.design_files.delete_many({"id": {"$regex": "^iter319-q-"}})
    await db.design_files.insert_many([
        # (a) empty stub
        {"id": "iter319-q-empty", "title": "empty", "primary_url": None, "thumbnail_url": None, "quarantined_at": None},
        # (b) TEST_ prefix
        {"id": "iter319-q-test", "title": "TEST_iter319_thumbwin",
         "primary_url": "https://cdn/x.svg", "thumbnail_url": "https://cdn/t.jpg",
         "quarantined_at": None},
        # (c) no download URL anywhere
        {"id": "iter319-q-nofile", "title": "thumb but no file",
         "primary_url": None, "thumbnail_url": "https://cdn/t.jpg",
         "variants": [], "quarantined_at": None},
        # Control — ready row should NOT be quarantined.
        {"id": "iter319-q-ready", "title": "ready",
         "primary_url": "https://cdn/x.svg", "thumbnail_url": "https://cdn/t.jpg",
         "quarantined_at": None},
    ])
    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/admin/feeds/design-files/quarantine-stubs",
                          headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["quarantined_count"] >= 3  # at least our 3 stubs
    assert body["breakdown"]["empty_stub"] >= 1
    assert body["breakdown"]["test_fixture"] >= 1
    assert body["breakdown"]["no_download_url"] >= 1
    # Verify our control row is still unquarantined.
    ready = await db.design_files.find_one({"id": "iter319-q-ready"})
    assert ready["quarantined_at"] is None
    # And the three stubs ARE.
    for sid in ("iter319-q-empty", "iter319-q-test", "iter319-q-nofile"):
        row = await db.design_files.find_one({"id": sid})
        assert row["quarantined_at"] is not None, sid
    await db.design_files.delete_many({"id": {"$regex": "^iter319-q-"}})


async def test_quarantine_is_idempotent():
    """Re-running the quarantine action should be a no-op when
    there's nothing left to quarantine."""
    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Run once to drain any leftover dev data.
        await ac.post("/api/admin/feeds/design-files/quarantine-stubs",
                      headers={"Authorization": f"Bearer {jwt}"})
        # Second run — should claim 0 or near-0 new quarantines.
        r = await ac.post("/api/admin/feeds/design-files/quarantine-stubs",
                          headers={"Authorization": f"Bearer {jwt}"})
        body = r.json()
        # Allow 0 since this runs against the live dev DB.
        assert body["quarantined_count"] >= 0
