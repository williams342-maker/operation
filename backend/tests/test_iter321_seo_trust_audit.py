"""iter321 — SEO/Trust audit verifications.

Validates the three deliverables shipped in this iter:
  1. 5 new SEO landing slugs registered in SEO_LANDING_SLUGS.
  2. Each new slug has a content entry in og_static_prerender so a
     crawler never lands on a 404 prerender.
  3. Maker model accepts the new proof-signal fields (workshop_photos
     + response_time_hours) and the PATCH endpoint clamps response
     time + caps workshop photos at 6 / dedupes URLs.
"""
from __future__ import annotations

import os
import uuid

import pytest
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

NEW_SLUGS = (
    "plasma-cut-wall-art",
    "cnc-wood-signs",
    "laser-engraved-gifts",
    "custom-address-signs",
    "engraved-cutting-boards",
)


def test_new_slugs_in_backend_registry():
    from routers.seo import SEO_LANDING_SLUGS
    for s in NEW_SLUGS:
        assert s in SEO_LANDING_SLUGS, f"{s} missing from SEO_LANDING_SLUGS"


def test_new_slugs_have_prerender_content():
    from routers.og_static_prerender import _LANDING_CONTENT
    for s in NEW_SLUGS:
        assert s in _LANDING_CONTENT, f"{s} missing from prerender content map"
        entry = _LANDING_CONTENT[s]
        assert entry["h1"], f"{s} prerender has no h1"
        assert entry["title"], f"{s} prerender has no title"
        assert entry["desc"], f"{s} prerender has no desc"
        assert len(entry["desc"]) >= 50, f"{s} desc too short for SEO"
        assert entry["paragraphs"] and len(entry["paragraphs"]) >= 2


@pytest.mark.asyncio
async def test_prerender_endpoint_serves_new_slugs():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        for s in NEW_SLUGS:
            r = await c.get(f"/api/og/landing/{s}")
            assert r.status_code == 200, f"{s} returned {r.status_code}"
            body = r.text
            assert "og-prerender" in body or "og:title" in body, \
                f"{s} body missing prerender markers"


@pytest.mark.asyncio
async def test_sitemap_includes_new_landing_paths():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get("/api/sitemap.xml")
        assert r.status_code == 200
        for s in NEW_SLUGS:
            assert f"/{s}</loc>" in r.text or f"/{s}" in r.text, \
                f"{s} missing from sitemap.xml"


def test_maker_model_accepts_proof_fields():
    from models import Maker
    m = Maker(
        slug="t1", name="Test", initials="T",
        location="Austin, TX", bio="b",
        portrait="", cover="",
        workshop_photos=["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
        response_time_hours=8,
    )
    assert m.workshop_photos == ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"]
    assert m.response_time_hours == 8


def test_maker_model_defaults_proof_fields_safely():
    from models import Maker
    m = Maker(slug="t2", name="Test", initials="T", location="x", bio="b",
              portrait="", cover="")
    assert m.workshop_photos == []
    assert m.response_time_hours is None


@pytest.mark.asyncio
async def test_patch_profile_clamps_response_time_and_dedupes_photos():
    from server import app
    from core import db
    from maker_auth import issue_magic_token

    transport = ASGITransport(app=app)
    slug = f"itest-{uuid.uuid4().hex[:8]}"
    email = f"{slug}@craftersmarket.org"

    # Seed an active maker so the auth + PATCH round-trip works end-to-end.
    await db.makers.insert_one({
        "id": str(uuid.uuid4()), "slug": slug, "name": "Iter321 Maker",
        "initials": "IM", "location": "Boise, ID", "bio": "x",
        "techniques": [], "portrait": "", "cover": "",
        "email": email, "status": "active",
        "listings_count": 0, "rating": 5.0,
    })

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            tok = issue_magic_token(email)
            v = await c.post("/api/maker/auth/verify", json={"token": tok})
            assert v.status_code == 200, v.text
            jwt = v.json()["token"]

            # Send 8 photos + 1 dupe + 1 bad URL; expect cap at 6 + bad filtered.
            payload = {
                "workshop_photos": [
                    "https://cdn.example/1.jpg",
                    "https://cdn.example/2.jpg",
                    "https://cdn.example/1.jpg",  # dupe
                    "https://cdn.example/3.jpg",
                    "https://cdn.example/4.jpg",
                    "https://cdn.example/5.jpg",
                    "https://cdn.example/6.jpg",
                    "https://cdn.example/7.jpg",  # over cap (should drop)
                    "not-a-url",                   # bad → dropped
                ],
                "response_time_hours": 999,  # → clamped to 168
            }
            r = await c.patch(
                "/api/maker/profile",
                json=payload,
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert len(body["workshop_photos"]) == 6
            # First 6 distinct URLs preserved in order.
            assert body["workshop_photos"][0] == "https://cdn.example/1.jpg"
            assert "not-a-url" not in body["workshop_photos"]
            assert body["response_time_hours"] == 168

            # Clamp the low end too.
            r2 = await c.patch(
                "/api/maker/profile",
                json={"response_time_hours": 0},
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r2.status_code == 200
            assert r2.json()["response_time_hours"] == 1
    finally:
        await db.makers.delete_one({"slug": slug})
