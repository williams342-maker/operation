"""iter356 — Maker-facing SEO indexation trend endpoint.

Covers `/api/maker/seo/indexation-trend` which mirrors the admin
per-maker rollup but scopes the response to the requesting maker's
slug (derived from their bearer JWT).

  • Unauthenticated → 401
  • With maker JWT  → returns series shape identical to the admin
    endpoint (date, indexed_count, indexed_pct, total_published) for
    the maker's own slug.
  • Days clamped to 7..90.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


MAKER_SLUG = "iter356-trend-maker"


@pytest_asyncio.fixture(autouse=True)
async def _isolate_db():
    from core import db
    # iter356 — Purge ALL snapshots in the test window so the live
    # daily-cron-seeded rows don't contaminate the count. We restore
    # nothing on teardown; the cron will re-populate tomorrow.
    today = datetime.now(timezone.utc).date()
    cutoff = (today - timedelta(days=95)).isoformat()
    await db.gsc_indexed_snapshots.delete_many({"ts": {"$gte": cutoff}})
    snapshots = []
    for offset, pct in [(2, 80.0), (1, 88.0), (0, 92.0)]:
        d = (today - timedelta(days=offset)).isoformat()
        snapshots.append({
            "_id": f"iter356_{d}",
            "date": d,
            "ts": f"{d}T00:00:00+00:00",
            "indexed_count": 80,
            "indexed_pct": pct,
            "total_published": 100,
            "per_maker": {
                MAKER_SLUG: {"indexed": int(pct), "indexed_pct": pct, "total": 100},
                "some-other-maker": {"indexed": 50, "indexed_pct": 50.0, "total": 100},
            },
        })
    await db.gsc_indexed_snapshots.insert_many(snapshots)
    yield
    # Teardown — drop our seeded rows so the next prod cron run starts clean.
    await db.gsc_indexed_snapshots.delete_many({"_id": {"$regex": "^iter356_"}})


def _maker_token() -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(MAKER_SLUG, f"{MAKER_SLUG}@x.org",
                             role="maker", session_version=0)


async def test_maker_seo_trend_requires_auth():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/maker/seo/indexation-trend")
    assert r.status_code == 401


async def test_maker_seo_trend_returns_own_slug_series():
    from server import app
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_maker_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/maker/seo/indexation-trend?days=30",
                         headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["maker_slug"] == MAKER_SLUG
    assert body["days_requested"] == 30
    assert body["snapshot_count"] == 3
    assert body["latest_indexed_pct"] == 92.0
    # Last 3 entries in the series must carry our seeded data.
    populated = [s for s in body["series"] if s["indexed_pct"] is not None]
    assert len(populated) == 3
    # No data leak from other makers.
    for s in populated:
        assert s["total_published"] == 100
        assert s["indexed_pct"] in (80.0, 88.0, 92.0)


async def test_maker_seo_trend_clamps_days():
    from server import app
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_maker_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.get("/api/maker/seo/indexation-trend?days=1",
                          headers=headers)
        r2 = await ac.get("/api/maker/seo/indexation-trend?days=500",
                          headers=headers)
    assert r1.status_code == 200
    assert r1.json()["days_requested"] == 7
    assert r2.status_code == 200
    assert r2.json()["days_requested"] == 90
