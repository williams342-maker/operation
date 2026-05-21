"""Smoke test: Recovery Queue "Publish now" flow (iter166).

Verifies that the existing `/maker/products/{slug}/publish` endpoint correctly
flips a draft → published, sets expiry, and (most importantly for the new
recovery flow) increments the listing's sitemap visibility — i.e. once
published, `/maker/products/indexing-status` reports `tier != not_in_sitemap`
for that slug.
"""
import os
from datetime import datetime, timezone

import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


async def _maker_jwt(client: httpx.AsyncClient) -> str:
    from maker_auth import issue_magic_token
    magic = issue_magic_token("iron-and-oak@craftersmarket.org")
    r = await client.post(f"{API}/api/maker/auth/verify", json={"token": magic})
    return r.json()["token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.mark.asyncio
async def test_publish_draft_flips_indexing_tier():
    from core import db
    slug = f"_rec-publish-{int(datetime.now().timestamp())}"
    await db.products.insert_one({
        "id": f"id-{slug}", "slug": slug,
        "title": "Recovery queue test",
        "category": "Wall Art", "technique": "PLASMA", "price": 5, "description": "x",
        "images": ["https://example.com/x.jpg"],
        "maker_slug": "iron-and-oak", "in_stock": 1,
        "status": "draft", "deleted_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            tok = await _maker_jwt(c)
            # Indexing status pre-publish → not_in_sitemap
            r = await c.get(f"{API}/api/maker/products/indexing-status", headers=_h(tok))
            assert r.json()[slug]["tier"] == "not_in_sitemap"
            # Publish via the same endpoint the Recovery Queue button calls
            r = await c.post(f"{API}/api/maker/products/{slug}/publish", headers=_h(tok))
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "published"
            assert r.json()["expires_at"] is not None
            # Indexing status post-publish → submitted (recently published)
            r = await c.get(f"{API}/api/maker/products/indexing-status", headers=_h(tok))
            tier = r.json()[slug]["tier"]
            assert tier in ("submitted", "established"), f"unexpected tier: {tier}"
            assert r.json()[slug]["in_sitemap"] is True
    finally:
        await db.products.delete_one({"slug": slug})
