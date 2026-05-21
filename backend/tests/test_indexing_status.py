"""Regression: per-listing sitemap-indexing status endpoint (iter165).

Covers:
  • Endpoint shape: returns dict keyed by slug with tier/in_sitemap/days
  • Draft listing → not_in_sitemap
  • Recently published listing → submitted (≤7 days old)
  • Old published listing → established (>7 days old)
  • Test/seed slug → not_in_sitemap even when status=published
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

TEST_MAKER_EMAIL = "iron-and-oak@craftersmarket.org"


async def _maker_jwt(client: httpx.AsyncClient) -> str:
    from maker_auth import issue_magic_token
    magic = issue_magic_token(TEST_MAKER_EMAIL)
    r = await client.post(f"{API}/api/maker/auth/verify", json={"token": magic})
    return r.json()["token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.mark.asyncio
async def test_indexing_status_endpoint_shape():
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        r = await c.get(f"{API}/api/maker/products/indexing-status", headers=_h(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, dict)
        for slug, st in body.items():
            assert st["tier"] in ("established", "submitted", "not_in_sitemap")
            assert isinstance(st["in_sitemap"], bool)
            # days_in_sitemap is int when in_sitemap, else None
            if st["in_sitemap"]:
                assert isinstance(st["days_in_sitemap"], int)
            else:
                assert st["days_in_sitemap"] is None


@pytest.mark.asyncio
async def test_tier_logic_against_seeded_listings():
    from core import db
    now = datetime.now(timezone.utc)
    draft_slug = f"_idx-draft-{int(now.timestamp())}"
    recent_slug = f"_idx-recent-{int(now.timestamp())}"
    old_slug = f"_idx-old-{int(now.timestamp())}"
    # Use a test-pattern slug that _is_test_slug will catch: iter\d
    test_pattern_slug = f"iter999-{int(now.timestamp())}-test-pattern"

    docs = [
        {  # draft → not_in_sitemap
            "id": f"id-{draft_slug}", "slug": draft_slug, "title": "Draft",
            "category": "Wall Art", "technique": "PLASMA", "price": 1, "description": "x",
            "images": [], "maker_slug": "iron-and-oak", "in_stock": 1,
            "status": "draft", "deleted_at": None,
            "created_at": now.isoformat(),
        },
        {  # published 3d ago → submitted
            "id": f"id-{recent_slug}", "slug": recent_slug, "title": "Recent",
            "category": "Wall Art", "technique": "PLASMA", "price": 1, "description": "x",
            "images": [], "maker_slug": "iron-and-oak", "in_stock": 1,
            "status": "published", "deleted_at": None,
            "created_at": (now - timedelta(days=3)).isoformat(),
        },
        {  # published 14d ago → established
            "id": f"id-{old_slug}", "slug": old_slug, "title": "Established",
            "category": "Wall Art", "technique": "PLASMA", "price": 1, "description": "x",
            "images": [], "maker_slug": "iron-and-oak", "in_stock": 1,
            "status": "published", "deleted_at": None,
            "created_at": (now - timedelta(days=14)).isoformat(),
        },
        {  # test-pattern slug → not_in_sitemap even when published
            "id": f"id-{test_pattern_slug}", "slug": test_pattern_slug, "title": "Iter test",
            "category": "Wall Art", "technique": "PLASMA", "price": 1, "description": "x",
            "images": [], "maker_slug": "iron-and-oak", "in_stock": 1,
            "status": "published", "deleted_at": None,
            "created_at": (now - timedelta(days=14)).isoformat(),
        },
    ]
    await db.products.insert_many([dict(d) for d in docs])
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            tok = await _maker_jwt(c)
            r = await c.get(f"{API}/api/maker/products/indexing-status", headers=_h(tok))
            assert r.status_code == 200
            body = r.json()
            assert body[draft_slug]["tier"] == "not_in_sitemap"
            assert body[recent_slug]["tier"] == "submitted"
            assert body[recent_slug]["in_sitemap"] is True
            assert body[recent_slug]["days_in_sitemap"] == 3
            assert body[old_slug]["tier"] == "established"
            assert body[old_slug]["days_in_sitemap"] == 14
            assert body[test_pattern_slug]["tier"] == "not_in_sitemap"
    finally:
        await db.products.delete_many({"slug": {"$in": [
            draft_slug, recent_slug, old_slug, test_pattern_slug,
        ]}})
