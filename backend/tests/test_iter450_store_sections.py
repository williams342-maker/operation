"""iter450 — Store Sections Phase 1 backend tests."""
import os
import uuid

import pytest
import pytest_asyncio

from httpx import ASGITransport, AsyncClient
from server import app
from core import db, now_iso
from maker_auth import issue_session_jwt

PFX = "sectest"
M1 = f"{PFX}-forge"
M2 = f"{PFX}-loom"


def _auth(slug):
    return {"Authorization": f"Bearer {issue_session_jwt(slug, f'{slug}@t.co', role='maker')}"}


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def _clean():
    async def wipe():
        await db.store_sections.delete_many({"maker_slug": {"$regex": f"^{PFX}-"}})
        await db.products.delete_many({"maker_slug": {"$regex": f"^{PFX}-"}})
        await db.makers.delete_many({"slug": {"$regex": f"^{PFX}-"}})
    await wipe()
    for m in (M1, M2):
        await db.makers.insert_one({"slug": m, "name": m, "created_at": now_iso()})
    yield
    await wipe()


async def _product(maker, title="Widget", status="published", sections=None):
    slug = f"{PFX}-{uuid.uuid4().hex[:8]}"
    doc = {"id": uuid.uuid4().hex, "slug": slug, "title": title, "price": 10.0,
           "maker_slug": maker, "status": status, "created_at": now_iso()}
    if sections is not None:
        doc["section_slugs"] = sections
    await db.products.insert_one(doc)
    return slug


async def _mk(client, name, maker=M1, **kw):
    r = await client.post("/api/maker/sections", json={"name": name, **kw},
                          headers=_auth(maker))
    assert r.status_code == 201, r.text
    return r.json()


# ── CRUD + slugs ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_and_list(client):
    s = await _mk(client, "Berry Plants", description="All berries")
    assert s["slug"] == "berry-plants" and s["visible"] is True and s["position"] == 0
    r = await client.get("/api/maker/sections", headers=_auth(M1))
    d = r.json()
    assert [x["name"] for x in d["sections"]] == ["Berry Plants"]
    assert d["sections"][0]["count"] == 0


@pytest.mark.asyncio
async def test_reserved_and_duplicate_slugs(client):
    s = await _mk(client, "Books")
    assert s["slug"] == "books"
    r = await client.post("/api/maker/sections", json={"name": "Books"}, headers=_auth(M1))
    assert r.status_code == 400  # duplicate name
    for reserved in ("Orders", "Admin", "Reviews", "API"):
        s = await _mk(client, reserved)
        assert s["slug"] not in ("orders", "admin", "reviews", "api")
        assert s["slug"].startswith(reserved.lower())
        assert s["name"] == reserved  # display name preserved


@pytest.mark.asyncio
async def test_rename_preserves_slug_and_regenerate_records_redirect(client):
    s = await _mk(client, "Fruit Trees")
    r = await client.patch(f"/api/maker/sections/{s['id']}",
                           json={"name": "Fruit & Nut Trees"}, headers=_auth(M1))
    d = r.json()
    assert d["name"] == "Fruit & Nut Trees" and d["slug"] == "fruit-trees"
    p = await _product(M1, sections=["fruit-trees"])
    r = await client.patch(f"/api/maker/sections/{s['id']}",
                           json={"regenerate_slug": True}, headers=_auth(M1))
    d = r.json()
    assert d["slug"] == "fruit-nut-trees"
    assert "fruit-trees" in d["previous_slugs"]
    prod = await db.products.find_one({"slug": p}, {"_id": 0})
    assert prod["section_slugs"] == ["fruit-nut-trees"]  # references migrated
    pub = (await client.get(f"/api/makers/{M1}/sections")).json()
    assert pub["redirects"] == {"fruit-trees": "fruit-nut-trees"}


@pytest.mark.asyncio
async def test_reorder_and_delete(client):
    a = await _mk(client, "Seeds")
    b = await _mk(client, "Ferns")
    r = await client.post("/api/maker/sections/reorder",
                          json={"order": [b["id"], a["id"]]}, headers=_auth(M1))
    assert r.status_code == 200
    d = (await client.get("/api/maker/sections", headers=_auth(M1))).json()
    assert [x["name"] for x in d["sections"]] == ["Ferns", "Seeds"]
    p = await _product(M1, sections=["seeds"])
    r = await client.delete(f"/api/maker/sections/{a['id']}", headers=_auth(M1))
    assert r.status_code == 200
    prod = await db.products.find_one({"slug": p}, {"_id": 0})
    assert prod["section_slugs"] == []  # detached, product untouched
    assert prod["status"] == "published"


# ── Membership + assignment ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_membership_and_assign(client):
    s = await _mk(client, "Houseplants")
    p1 = await _product(M1)
    p2 = await _product(M1)
    other = await _product(M2)
    r = await client.put(f"/api/maker/sections/{s['id']}/products",
                         json={"product_slugs": [p1, p2, other]}, headers=_auth(M1))
    assert r.json()["count"] == 2  # foreign product silently ignored
    assert (await db.products.find_one({"slug": other})).get("section_slugs") is None
    # assign endpoint sets full list per product, filtering unknown slugs
    r = await client.post("/api/maker/sections/assign",
                          json={"product_slug": p1,
                                "section_slugs": ["houseplants", "not-real"]},
                          headers=_auth(M1))
    assert r.json()["section_slugs"] == ["houseplants"]
    d = (await client.get("/api/maker/sections", headers=_auth(M1))).json()
    assert d["sections"][0]["count"] == 2


# ── Permissions ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_permissions(client):
    s = await _mk(client, "Steel Art", maker=M1)
    p1 = await _product(M1)
    # unauthenticated
    assert (await client.get("/api/maker/sections")).status_code in (401, 403)
    assert (await client.post("/api/maker/sections", json={"name": "X"})).status_code in (401, 403)
    # another maker cannot touch M1's sections or listings
    for resp in (
        await client.patch(f"/api/maker/sections/{s['id']}", json={"name": "Hack"},
                           headers=_auth(M2)),
        await client.delete(f"/api/maker/sections/{s['id']}", headers=_auth(M2)),
        await client.put(f"/api/maker/sections/{s['id']}/products",
                         json={"product_slugs": []}, headers=_auth(M2)),
        await client.post("/api/maker/sections/assign",
                          json={"product_slug": p1, "section_slugs": []},
                          headers=_auth(M2)),
    ):
        assert resp.status_code == 403, resp.text


# ── Public endpoint + backwards compat ───────────────────────────────────────

@pytest.mark.asyncio
async def test_public_sections_visibility_and_counts(client):
    vis = await _mk(client, "Berry Plants")
    hid = await _mk(client, "Secret Stock")
    await client.patch(f"/api/maker/sections/{hid['id']}",
                       json={"visible": False}, headers=_auth(M1))
    await _product(M1, sections=["berry-plants"])
    await _product(M1, sections=["berry-plants", "secret-stock"])
    await _product(M1, status="draft", sections=["berry-plants"])  # drafts don't count
    await _product(M1)  # no sections — All Products only
    d = (await client.get(f"/api/makers/{M1}/sections")).json()
    assert [s["slug"] for s in d["sections"]] == ["berry-plants"]  # hidden excluded
    assert d["sections"][0]["count"] == 2
    assert d["all_count"] == 3
    _ = vis


@pytest.mark.asyncio
async def test_no_sections_backwards_compatible(client):
    await _product(M2)
    d = (await client.get(f"/api/makers/{M2}/sections")).json()
    assert d["sections"] == [] and d["all_count"] == 1 and d["redirects"] == {}


@pytest.mark.asyncio
async def test_sitemap_includes_only_public_nonempty_sections(client):
    a = await _mk(client, "Berry Plants")
    b = await _mk(client, "Empty Corner")
    hid = await _mk(client, "Hidden Full")
    await client.patch(f"/api/maker/sections/{hid['id']}",
                       json={"visible": False}, headers=_auth(M1))
    await _product(M1, sections=["berry-plants"])
    await _product(M1, sections=["hidden-full"])
    xml = (await client.get("/api/sitemap.xml")).text
    assert f"/makers/{M1}/berry-plants" in xml
    assert f"/makers/{M1}/empty-corner" not in xml
    assert f"/makers/{M1}/hidden-full" not in xml
    _ = a, b
