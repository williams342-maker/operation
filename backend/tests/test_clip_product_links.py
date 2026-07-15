from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "craftersmarket_test")
os.environ.setdefault("MAKER_AUTH_SECRET", "test-maker-secret")
os.environ.setdefault("ADMIN_EMAILS", "admin@craftersmarket.local")
os.environ.setdefault("EMERGENT_LLM_KEY", "test")
os.environ.setdefault("SCHEDULER_ENABLED", "false")
os.environ.setdefault("SCHEDULER_STARTUP_SEO", "false")
os.environ.setdefault("SKIP_STARTUP_DB_BOOTSTRAP", "true")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from core import db, now_iso
from maker_auth import issue_session_jwt
from server import app
from routers.clips import ensure_clip_product_indexes

pytestmark = pytest.mark.asyncio
PFX = "cliplinktest"
M1 = f"{PFX}-maker-a"
M2 = f"{PFX}-maker-b"
AUTH1 = {"Authorization": f"Bearer {issue_session_jwt(M1, 'a@example.test', role='maker')}"}
AUTH2 = {"Authorization": f"Bearer {issue_session_jwt(M2, 'b@example.test', role='maker')}"}
ADMIN = {"Authorization": f"Bearer {issue_session_jwt('admin', 'admin@craftersmarket.local', role='admin')}"}


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def clean():
    await ensure_clip_product_indexes()
    await _wipe()
    await db.makers.insert_many([
        {"slug": M1, "name": "Maker A", "created_at": now_iso()},
        {"slug": M2, "name": "Maker B", "created_at": now_iso()},
    ])
    yield
    await _wipe()


async def _wipe():
    rx = {"$regex": f"^{PFX}-"}
    await db.clips.delete_many({"maker_slug": rx})
    await db.products.delete_many({"maker_slug": rx})
    await db.clip_products.delete_many({"clip_id": rx})
    await db.clip_edit_history.delete_many({"clip_id": rx})
    await db.store_events.delete_many({"maker_slug": rx})
    await db.makers.delete_many({"slug": rx})
    await db.admin_audit.delete_many({"kind": "clip_product_link_removed"})


async def _clip(maker=M1, **extra):
    cid = f"{PFX}-clip-{uuid.uuid4().hex[:8]}"
    doc = {
        "id": cid,
        "slug": cid,
        "maker_slug": maker,
        "maker_name": maker,
        "title": "Original clip",
        "description": "before",
        "category": "workshop",
        "tags": [],
        "source_type": "youtube",
        "source_id": uuid.uuid4().hex[:8],
        "video_url": "https://www.youtube.com/embed/test",
        "poster_url": None,
        "duration_seconds": 0,
        "product_slug": None,
        "views": 0,
        "likes": 0,
        "saves": 0,
        "shares": 0,
        "featured": False,
        "is_seed": False,
        "ai_generated": False,
        "ai_model": None,
        "quarantined_at": None,
        "visibility": "public",
        "comments_enabled": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        **extra,
    }
    await db.clips.insert_one(doc)
    return doc


async def _prod(maker=M1, slug=None, status="published", in_stock=5, **extra):
    slug = slug or f"{PFX}-prod-{uuid.uuid4().hex[:8]}"
    doc = {
        "id": uuid.uuid4().hex,
        "slug": slug,
        "title": f"Product {slug}",
        "price": 25.0,
        "images": ["https://example.test/p.jpg"],
        "maker_slug": maker,
        "maker_name": maker,
        "status": status,
        "deleted_at": None,
        "admin_hidden": False,
        "in_stock": in_stock,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        **extra,
    }
    await db.products.insert_one(doc)
    return doc


async def test_maker_can_edit_their_own_clip(client):
    clip = await _clip()
    r = await client.patch(f"/api/maker/clips/{clip['id']}", headers=AUTH1, json={
        "title": "Updated clip title",
        "description": "New description",
        "tags": ["Walnut", "#Shop"],
        "visibility": "unlisted",
        "comments_enabled": False,
    })
    assert r.status_code == 200, r.text
    body = r.json()["clip"]
    assert body["title"] == "Updated clip title"
    assert body["visibility"] == "unlisted"
    assert body["comments_enabled"] is False
    assert body["tags"] == ["walnut", "shop"]


async def test_maker_cannot_edit_another_makers_clip(client):
    clip = await _clip(maker=M2)
    r = await client.patch(f"/api/maker/clips/{clip['id']}", headers=AUTH1, json={"title": "Nope"})
    assert r.status_code == 404


async def test_maker_can_attach_own_active_product(client):
    clip = await _clip()
    p = await _prod()
    r = await client.put(f"/api/maker/clips/{clip['id']}/products", headers=AUTH1, json={
        "products": [{"product_id": p["slug"], "is_featured": True}],
    })
    assert r.status_code == 200, r.text
    assert r.json()["linked_products"][0]["slug"] == p["slug"]


async def test_maker_cannot_attach_another_makers_product(client):
    clip = await _clip()
    p = await _prod(maker=M2)
    r = await client.put(f"/api/maker/clips/{clip['id']}/products", headers=AUTH1, json={
        "products": [{"product_id": p["slug"]}],
    })
    assert r.status_code == 403


async def test_duplicate_products_are_rejected(client):
    clip = await _clip()
    p = await _prod()
    r = await client.put(f"/api/maker/clips/{clip['id']}/products", headers=AUTH1, json={
        "products": [{"product_id": p["slug"]}, {"product_id": p["slug"]}],
    })
    assert r.status_code == 422


async def test_more_than_ten_products_are_rejected(client):
    clip = await _clip()
    products = [await _prod() for _ in range(11)]
    r = await client.put(f"/api/maker/clips/{clip['id']}/products", headers=AUTH1, json={
        "products": [{"product_id": p["slug"]} for p in products],
    })
    assert r.status_code == 422


async def test_products_can_be_reordered(client):
    clip = await _clip()
    a = await _prod(slug=f"{PFX}-a")
    b = await _prod(slug=f"{PFX}-b")
    r = await client.put(f"/api/maker/clips/{clip['id']}/products", headers=AUTH1, json={
        "products": [{"product_id": b["slug"]}, {"product_id": a["slug"]}],
    })
    assert [p["slug"] for p in r.json()["linked_products"]] == [b["slug"], a["slug"]]


async def test_featured_product_can_be_changed(client):
    clip = await _clip()
    a = await _prod(slug=f"{PFX}-feature-a")
    b = await _prod(slug=f"{PFX}-feature-b")
    r = await client.put(f"/api/maker/clips/{clip['id']}/products", headers=AUTH1, json={
        "products": [{"product_id": a["slug"]}, {"product_id": b["slug"], "is_featured": True}],
    })
    featured = [p["slug"] for p in r.json()["linked_products"] if p["is_featured"]]
    assert featured == [b["slug"]]


async def test_deleted_or_inactive_products_do_not_break_public_clip_retrieval(client):
    clip = await _clip()
    p = await _prod(status="draft")
    await db.clip_products.insert_one({
        "id": uuid.uuid4().hex, "clip_id": clip["id"], "product_id": p["slug"],
        "sort_order": 0, "is_featured": True, "created_at": now_iso(), "updated_at": now_iso(),
    })
    r = await client.get(f"/api/clips/{clip['slug']}")
    assert r.status_code == 200, r.text
    assert r.json()["linked_products"] == []


async def test_existing_clips_without_products_still_work(client):
    clip = await _clip(product_slug=None)
    r = await client.get(f"/api/clips/{clip['slug']}")
    assert r.status_code == 200
    assert r.json()["linked_products"] == []


async def test_admin_can_remove_product_link(client):
    clip = await _clip()
    p = await _prod()
    await client.put(f"/api/maker/clips/{clip['id']}/products", headers=AUTH1, json={
        "products": [{"product_id": p["slug"], "is_featured": True}],
    })
    r = await client.delete(f"/api/admin/clips/{clip['id']}/products/{p['slug']}", headers=ADMIN)
    assert r.status_code == 200, r.text
    assert await db.clip_products.count_documents({"clip_id": clip["id"]}) == 0


async def test_clip_analytics_events_store_clip_and_product_ids(client):
    r = await client.post("/api/store-events", json={"events": [{
        "type": "clip_product_click",
        "maker_slug": M1,
        "clip_id": f"{PFX}-clip-analytics",
        "product_slug": f"{PFX}-prod-analytics",
        "source": "clip_drawer",
        "referrer": "http://test/clips/x",
    }]})
    assert r.status_code == 200 and r.json()["stored"] == 1
    row = await db.store_events.find_one({"maker_slug": M1, "type": "clip_product_click"}, {"_id": 0})
    assert row["clip_id"] == f"{PFX}-clip-analytics"
    assert row["product_slug"] == f"{PFX}-prod-analytics"
