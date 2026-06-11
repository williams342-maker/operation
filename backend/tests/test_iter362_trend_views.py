"""iter362 — /products/trending must attach `trend_views` (the window
view count) to each returned product so the homepage strip can render
its view-count badge."""
import os
import sys
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


async def test_trending_includes_trend_views():
    from core import db
    from server import app

    slug = f"iter362-{uuid.uuid4().hex[:8]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.products.insert_one({
        "id": str(uuid.uuid4()), "slug": slug, "title": "Trend Views Test",
        "price": 25.0, "maker_slug": "test-maker", "images": ["http://x/i.jpg"],
        "status": "published", "deleted_at": None, "created_at": now_iso,
    })
    await db.events.insert_many([
        {"type": "product_view", "product_slug": slug,
         "source": "mosaic", "created_at": now_iso}
        for _ in range(3)
    ])
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get("/api/products/trending",
                            params={"hours": 1, "limit": 24, "source": "mosaic"})
            assert r.status_code == 200
            row = next((p for p in r.json() if p["slug"] == slug), None)
            assert row is not None, "freshly-viewed product missing from trending"
            assert row["trend_views"] == 3
    finally:
        await db.products.delete_one({"slug": slug})
        await db.events.delete_many({"product_slug": slug})
