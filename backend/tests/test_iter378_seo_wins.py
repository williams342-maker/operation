"""iter378 — Weekly "SEO wins" rollup (Monday ops email + admin card).

Covers:
  • GET /admin/seo-health/wins requires admin.
  • build_seo_wins: indexed-trend delta from seeded snapshots + clicks /
    impressions / top queries via a mocked search_analytics.
  • Graceful degradation when GSC isn't connected (search_analytics → None).
"""
import os
import sys

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


async def test_wins_requires_admin():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        r = await c.get("/api/admin/seo-health/wins")
    assert r.status_code == 401


async def test_build_seo_wins_with_mocked_gsc(monkeypatch):
    from datetime import datetime, timedelta, timezone
    import gsc_client
    from core import db
    from routers.seo_health import build_seo_wins

    today = datetime.now(timezone.utc).date()
    await db.gsc_indexed_snapshots.delete_many({"date": {"$in": [
        today.isoformat(), (today - timedelta(days=8)).isoformat()]}})
    await db.gsc_indexed_snapshots.insert_many([
        {"date": today.isoformat(), "ts": f"{today.isoformat()}T06:15:00+00:00",
         "indexed_count": 90, "indexed_pct": 80.0},
        {"date": (today - timedelta(days=8)).isoformat(),
         "ts": f"{(today - timedelta(days=8)).isoformat()}T06:15:00+00:00",
         "indexed_count": 75, "indexed_pct": 70.0},
    ])

    calls = []
    async def fake_sa(start, end, dimensions=None, row_limit=10):
        calls.append((start, end, dimensions))
        if dimensions == ["query"]:
            return [{"keys": ["custom metal signs"], "clicks": 12,
                     "impressions": 340, "position": 8.3},
                    {"keys": ["walnut flag"], "clicks": 7,
                     "impressions": 120, "position": 4.1}]
        if dimensions == ["page"]:
            return [{"keys": ["https://craftersmarket.org/shop"], "clicks": 15,
                     "impressions": 400}]
        # totals rows: newest window first call, previous second
        return [{"clicks": 42, "impressions": 1200}] if len(
            [c for c in calls if c[2] is None]) == 1 else [{"clicks": 30, "impressions": 900}]

    monkeypatch.setattr(gsc_client, "search_analytics", fake_sa)
    try:
        wins = await build_seo_wins()
        assert wins["gsc_connected"] is True
        assert wins["indexed"]["now"] == 90
        assert wins["indexed"]["delta"] == 15
        assert wins["totals"] == {"clicks": 42, "impressions": 1200}
        assert wins["prev_totals"] == {"clicks": 30, "impressions": 900}
        assert wins["top_queries"][0]["query"] == "custom metal signs"
        assert wins["top_queries"][0]["position"] == 8.3
        assert wins["top_pages"][0]["clicks"] == 15
    finally:
        await db.gsc_indexed_snapshots.delete_many({"date": {"$in": [
            today.isoformat(), (today - timedelta(days=8)).isoformat()]}})


async def test_build_seo_wins_degrades_without_gsc(monkeypatch):
    import gsc_client
    from routers.seo_health import build_seo_wins

    async def none_sa(*a, **kw):
        return None
    monkeypatch.setattr(gsc_client, "search_analytics", none_sa)
    wins = await build_seo_wins()
    assert wins["gsc_connected"] is False
    assert wins["totals"] == {"clicks": 0, "impressions": 0}
    assert wins["top_queries"] == []
