"""iter451 — Store Search (section-aware, store-scoped) tests."""
import uuid

import pytest
import pytest_asyncio

from httpx import ASGITransport, AsyncClient
from server import app
from core import db, now_iso
from maker_auth import issue_session_jwt

PFX = "srchtest"
M1 = f"{PFX}-grove"
M2 = f"{PFX}-other"
AUTH = {"Authorization": f"Bearer {issue_session_jwt(M1, f'{M1}@t.co', role='maker')}"}


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
        await db.store_search_logs.delete_many({"maker_slug": {"$regex": f"^{PFX}-"}})
    await wipe()
    for m in (M1, M2):
        await db.makers.insert_one({"slug": m, "name": m, "created_at": now_iso()})
    yield
    await wipe()


async def _prod(maker, title, tags=None, description="", sections=None, status="published"):
    slug = f"{PFX}-{uuid.uuid4().hex[:8]}"
    await db.products.insert_one({
        "id": uuid.uuid4().hex, "slug": slug, "title": title, "price": 12.0,
        "maker_slug": maker, "status": status, "tags": tags or [],
        "description": description, "section_slugs": sections or [],
        "created_at": now_iso()})
    return slug


async def _section(client, name, description=""):
    r = await client.post("/api/maker/sections",
                          json={"name": name, "description": description}, headers=AUTH)
    assert r.status_code == 201
    return r.json()


@pytest.mark.asyncio
async def test_priority_title_over_tags_over_description(client):
    exact = await _prod(M1, "apple")
    contains = await _prod(M1, "Apple Tree Sapling")
    tagged = await _prod(M1, "Orchard Mix", tags=["apple", "pear"])
    desc = await _prod(M1, "Fruit Basket", description="great with apple pie")
    await _prod(M1, "Unrelated Fern")
    d = (await client.get(f"/api/makers/{M1}/search", params={"q": "apple"})).json()
    order = [p["slug"] for p in d["products"]]
    assert order == [exact, contains, tagged, desc]
    assert [p["matched_on"] for p in d["products"]] == ["title", "title", "tags", "description"]
    assert d["total"] == 4


@pytest.mark.asyncio
async def test_section_name_match_surfaces_section(client):
    await _section(client, "Berry Plants", description="Everything berry")
    await _prod(M1, "Blueberry Bush", sections=["berry-plants"])
    await _prod(M1, "Raspberry Cane", sections=["berry-plants"])
    d = (await client.get(f"/api/makers/{M1}/search", params={"q": "berry"})).json()
    assert d["sections"] and d["sections"][0]["slug"] == "berry-plants"
    assert d["sections"][0]["count"] == 2
    assert d["sections"][0]["matched_on"] == "name"
    # section description match too
    d = (await client.get(f"/api/makers/{M1}/search", params={"q": "everything"})).json()
    assert d["sections"][0]["matched_on"] == "description"


@pytest.mark.asyncio
async def test_by_section_distribution(client):
    await _section(client, "Berry Plants")
    await _section(client, "Fruit Trees")
    await _prod(M1, "Apple Berry Mix", sections=["berry-plants"])
    await _prod(M1, "Apple Tree", sections=["fruit-trees"])
    await _prod(M1, "Crab Apple Tree", sections=["fruit-trees"])
    d = (await client.get(f"/api/makers/{M1}/search", params={"q": "apple"})).json()
    dist = {s["slug"]: s["count"] for s in d["by_section"]}
    assert dist == {"fruit-trees": 2, "berry-plants": 1}
    assert d["by_section"][0]["slug"] == "fruit-trees"  # sorted desc


@pytest.mark.asyncio
async def test_scoped_to_single_maker_and_published_only(client):
    mine = await _prod(M1, "Cedar Birdhouse")
    await _prod(M2, "Cedar Birdhouse Deluxe")
    await _prod(M1, "Cedar Planter", status="draft")
    d = (await client.get(f"/api/makers/{M1}/search", params={"q": "cedar"})).json()
    assert [p["slug"] for p in d["products"]] == [mine]


@pytest.mark.asyncio
async def test_zero_results_suggest_sections_and_meta_popular(client):
    await _section(client, "Fruit Trees")
    await _prod(M1, "Apple Tree", sections=["fruit-trees"])
    d = (await client.get(f"/api/makers/{M1}/search", params={"q": "zzzqqq"})).json()
    assert d["products"] == [] and d["sections"] == []
    assert d["suggestions"][0]["slug"] == "fruit-trees"
    # popular: only queries with results count
    await client.get(f"/api/makers/{M1}/search", params={"q": "apple"})
    await client.get(f"/api/makers/{M1}/search", params={"q": "apple"})
    meta = (await client.get(f"/api/makers/{M1}/search/meta")).json()
    assert meta["popular"] == ["apple"]


@pytest.mark.asyncio
async def test_regex_injection_safe_and_empty_query(client):
    await _prod(M1, "Plain Item")
    r = await client.get(f"/api/makers/{M1}/search", params={"q": ".*"})
    assert r.status_code == 200 and r.json()["products"] == []
    r = await client.get(f"/api/makers/{M1}/search", params={"q": ""})
    assert r.json() == {"q": "", "sections": [], "products": [], "by_section": [], "suggestions": []}
