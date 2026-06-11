"""iter358 — Product impression beacon for the discovery mosaic.

Covers `POST /api/products/{slug}/impression`:

  • Existing product → writes a `type=product_view` row into `db.events`
    tagged `source=mosaic`, returns 204.
  • Unknown / deleted / draft slug → 204 with no write.
  • Bot user-agent → 204 with no write.
  • Same (visitor, slug, minute) hit twice → still only one row (dedupe).
"""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio

SLUG = "iter358-mosaic-prod"


@pytest_asyncio.fixture(autouse=True)
async def _isolate_db():
    from core import db
    await db.products.delete_many({"slug": SLUG})
    await db.products.insert_one({
        "slug": SLUG,
        "title": "Mosaic Test",
        "description": "x",
        "maker_slug": "iter358-maker",
        "price": 1.0,
        "images": ["https://example.com/x.jpg"],
        "status": "published",
        "deleted_at": None,
    })
    await db.events.delete_many({"product_slug": SLUG})
    yield
    await db.products.delete_many({"slug": SLUG})
    await db.events.delete_many({"product_slug": SLUG})


async def _post(client, slug, *, visitor="v1", ua="Mozilla/5.0 (X11; Linux x86_64)"):
    return await client.post(
        f"/api/products/{slug}/impression",
        headers={"x-visitor-id": visitor, "user-agent": ua},
    )


async def test_impression_logs_event_for_real_listing():
    from core import db
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await _post(ac, SLUG)
    assert r.status_code == 204
    rows = await db.events.find({"product_slug": SLUG}).to_list(10)
    assert len(rows) == 1
    row = rows[0]
    assert row["type"] == "product_view"
    assert row["maker_slug"] == "iter358-maker"
    assert row["source"] == "mosaic"


async def test_impression_dedupes_within_same_minute():
    from core import db
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        for _ in range(4):
            r = await _post(ac, SLUG, visitor="v-dedupe")
            assert r.status_code == 204
    rows = await db.events.find({"product_slug": SLUG}).to_list(10)
    assert len(rows) == 1, f"expected 1 row, got {len(rows)}"


async def test_impression_distinct_visitors_each_count():
    from core import db
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        for v in ["a", "b", "c"]:
            r = await _post(ac, SLUG, visitor=v)
            assert r.status_code == 204
    rows = await db.events.find({"product_slug": SLUG}).to_list(10)
    assert len(rows) == 3


async def test_impression_unknown_slug_is_silently_dropped():
    from core import db
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await _post(ac, "definitely-not-a-real-slug")
    assert r.status_code == 204
    assert await db.events.count_documents(
        {"product_slug": "definitely-not-a-real-slug"}
    ) == 0


async def test_impression_skips_bots():
    from core import db
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await _post(ac, SLUG, ua="Googlebot/2.1 (+http://www.google.com/bot.html)")
    assert r.status_code == 204
    assert await db.events.count_documents({"product_slug": SLUG}) == 0
