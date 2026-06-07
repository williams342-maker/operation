"""iter338 — Showcase auto-attach + design-file patch admin endpoints."""
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

ADMIN_EMAIL = "team@craftersmarket.org"
MAKER_WITH_HERO = "iter338-maker-a"
MAKER_NO_HERO = "iter338-maker-b"


def _admin_jwt() -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(ADMIN_EMAIL, ADMIN_EMAIL, role="admin",
                             session_version=0)


@pytest_asyncio.fixture(autouse=True)
async def _seed():
    from core import db
    for col in ("showcase_posts", "makers", "design_files"):
        await getattr(db, col).delete_many({"$or": [
            {"slug": {"$regex": "^iter338-"}},
            {"id": {"$regex": "^iter338-"}},
            {"maker_slug": {"$regex": "^iter338-"}},
        ]})
    await db.admin_users.update_one(
        {"email": ADMIN_EMAIL},
        {"$set": {"email": ADMIN_EMAIL, "is_active": True,
                  "capabilities": ["content", "marketplace"]}},
        upsert=True,
    )
    await db.makers.insert_many([
        {"slug": MAKER_WITH_HERO, "name": "Has Hero", "status": "approved",
         "hero_image_url": "https://example.com/hero-a.jpg"},
        {"slug": MAKER_NO_HERO, "name": "No Hero", "status": "approved"},
    ])
    yield


async def test_showcase_health_surfaces_blocked_examples():
    """Showcase row now returns up to 5 example blocked posts."""
    from core import db
    for i in range(7):
        await db.showcase_posts.insert_one({
            "id": f"iter338-blocked-{i}", "slug": f"iter338-blocked-{i}",
            "title": f"Imageless post {i}", "maker_slug": MAKER_WITH_HERO,
            "admin_hidden": False,
        })
    from server import app
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/feeds/health", headers=h)
    assert r.status_code == 200, r.text
    sh = next(c for c in r.json()["channels"] if c["channel"] == "showcase")
    assert sh["blocked"] >= 7
    assert len(sh["blocked_examples"]) == 5
    assert all("missing_image" in e["blockers"] for e in sh["blocked_examples"])


async def test_auto_attach_maker_image_copies_hero_url():
    from core import db
    await db.showcase_posts.insert_one({
        "id": "iter338-with-maker-hero", "slug": "iter338-with-maker-hero",
        "title": "P1", "maker_slug": MAKER_WITH_HERO, "admin_hidden": False,
    })
    from server import app
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/admin/feeds/showcase/auto-attach-maker-image",
                          headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["attached"] == 1
    doc = await db.showcase_posts.find_one({"id": "iter338-with-maker-hero"})
    assert doc["image_url"] == "https://example.com/hero-a.jpg"
    assert doc["image_auto_attached"] is True


async def test_auto_attach_skips_when_maker_has_no_hero():
    from core import db
    await db.showcase_posts.insert_one({
        "id": "iter338-no-hero", "slug": "iter338-no-hero",
        "title": "P2", "maker_slug": MAKER_NO_HERO, "admin_hidden": False,
    })
    from server import app
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/admin/feeds/showcase/auto-attach-maker-image",
                          headers=h)
    assert r.status_code == 200
    body = r.json()
    # Our seeded no-hero post should be in the skipped list with the
    # right reason (other unrelated test-db posts may also be skipped).
    our = [s for s in body["skipped_details"]
           if s.get("id") == "iter338-no-hero"]
    assert len(our) == 1
    assert our[0]["reason"] == "maker_has_no_hero"
    # And our doc was NOT mutated.
    doc = await db.showcase_posts.find_one({"id": "iter338-no-hero"})
    assert "image_url" not in doc or not doc["image_url"]


async def test_auto_attach_skips_posts_that_already_have_image():
    """Idempotency — posts with image_url are left alone on re-run."""
    from core import db
    await db.showcase_posts.insert_one({
        "id": "iter338-already-has-img", "slug": "iter338-already-has-img",
        "title": "P3", "maker_slug": MAKER_WITH_HERO,
        "image_url": "https://example.com/manual.jpg", "admin_hidden": False,
    })
    from server import app
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/admin/feeds/showcase/auto-attach-maker-image",
                          headers=h)
    assert r.status_code == 200
    # Verified post was not modified
    doc = await db.showcase_posts.find_one({"id": "iter338-already-has-img"})
    assert doc["image_url"] == "https://example.com/manual.jpg"
    assert doc.get("image_auto_attached") is not True


async def test_admin_hide_showcase_post():
    from core import db
    await db.showcase_posts.insert_one({
        "id": "iter338-to-hide", "slug": "iter338-to-hide",
        "title": "P4", "maker_slug": MAKER_NO_HERO, "admin_hidden": False,
    })
    from server import app
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/admin/feeds/showcase/iter338-to-hide/admin-hide",
                          headers=h)
    assert r.status_code == 200
    doc = await db.showcase_posts.find_one({"id": "iter338-to-hide"})
    assert doc["admin_hidden"] is True
    assert "admin_hidden_at" in doc


async def test_admin_hide_404_for_unknown_post():
    from server import app
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/admin/feeds/showcase/iter338-does-not-exist/admin-hide",
                          headers=h)
    assert r.status_code == 404


async def test_patch_design_file_allowed_fields():
    from core import db
    await db.design_files.insert_one({
        "id": "iter338-df-1", "slug": "iter338-df-1",
        "title": "Untitled", "quarantined_at": None,
    })
    from server import app
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.patch("/api/admin/feeds/design-files/iter338-df-1",
                           headers=h,
                           json={"thumbnail_url": "https://ex.com/t.png",
                                 "primary_url": "https://ex.com/f.svg",
                                 "title": "Better Title",
                                 "secret_field": "should be stripped"})
    assert r.status_code == 200, r.text
    assert set(r.json()["updated_fields"]) == {"thumbnail_url", "primary_url",
                                                "title", "admin_patched_at"}
    doc = await db.design_files.find_one({"id": "iter338-df-1"})
    assert doc["thumbnail_url"] == "https://ex.com/t.png"
    assert doc["title"] == "Better Title"
    assert "secret_field" not in doc


async def test_patch_design_file_rejects_no_allowed_fields():
    from core import db
    await db.design_files.insert_one({
        "id": "iter338-df-2", "slug": "iter338-df-2",
        "title": "X", "quarantined_at": None,
    })
    from server import app
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.patch("/api/admin/feeds/design-files/iter338-df-2",
                           headers=h, json={"random_field": 1})
    assert r.status_code == 400


async def test_patch_design_file_404():
    from server import app
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.patch("/api/admin/feeds/design-files/iter338-nope",
                           headers=h, json={"title": "x"})
    assert r.status_code == 404


async def test_endpoints_require_admin_auth():
    """All new endpoints reject when no admin JWT is provided."""
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post("/api/admin/feeds/showcase/auto-attach-maker-image")
        r2 = await ac.post("/api/admin/feeds/showcase/x/admin-hide")
        r3 = await ac.patch("/api/admin/feeds/design-files/x", json={"title": "x"})
    assert r1.status_code in (401, 403)
    assert r2.status_code in (401, 403)
    assert r3.status_code in (401, 403)
