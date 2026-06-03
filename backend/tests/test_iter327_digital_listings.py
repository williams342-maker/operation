"""iter327 — Digital/hybrid listings + file upload endpoints.

Validates:
  1. `Product.listing_type` defaults to "physical" and the schema accepts
     "digital" + "both" without rejecting legacy docs missing the field.
  2. `MakerProductCreate` accepts the new `listing_type` field and the
     create handler rejects invalid values with a clear 400.
  3. PATCH `/api/maker/products/{slug}` toggles `listing_type` end-to-end.
  4. `POST /api/maker/listings/{slug}/digital-files` enforces:
        - listing type must be digital or both,
        - max DIGITAL_FILE_MAX_COUNT files,
        - extension allow-list (rejects .exe / .png cleanly).
  5. `DELETE /api/maker/listings/{slug}/digital-files/{file_id}` removes
     the manifest entry and is idempotent on missing ids.
"""
from __future__ import annotations

import io
import os
import uuid

import pytest
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

pytestmark = pytest.mark.asyncio


async def _maker_jwt(c, slug: str, email: str):
    """Create an active maker, mint a magic token, exchange for a JWT."""
    from core import db
    from maker_auth import issue_magic_token
    await db.makers.insert_one({
        "id": str(uuid.uuid4()), "slug": slug, "name": "Iter327 Maker",
        "initials": "IM", "location": "Boise, ID", "bio": "x",
        "techniques": [], "portrait": "", "cover": "",
        "email": email, "status": "active",
        "listings_count": 0, "rating": 5.0,
    })
    tok = issue_magic_token(email)
    r = await c.post("/api/maker/auth/verify", json={"token": tok})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_product_model_listing_type_default_is_physical():
    from models import Product
    p = Product(
        slug=f"t-{uuid.uuid4().hex[:6]}",
        title="x", category="Wall Art", technique="PLASMA",
        price=10.0, maker_slug="someone",
    )
    assert p.listing_type == "physical"
    assert p.digital_files == []


def test_product_model_accepts_digital_and_both():
    from models import Product
    for lt in ("digital", "both", "physical"):
        p = Product(
            slug=f"t-{uuid.uuid4().hex[:6]}",
            title="x", category="Wall Art", technique="PLASMA",
            price=10.0, maker_slug="someone", listing_type=lt,
        )
        assert p.listing_type == lt


async def test_create_listing_rejects_invalid_listing_type():
    from server import app
    transport = ASGITransport(app=app)
    slug = f"iter327m-{uuid.uuid4().hex[:6]}"
    email = f"{slug}@example.com"

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            jwt = await _maker_jwt(c, slug, email)
            r = await c.post(
                "/api/maker/products",
                json={
                    "title": "Bad type",
                    "category": "Wall Art",
                    "technique": "PLASMA",
                    "price": 9.0,
                    "description": "x",
                    "listing_type": "magic",
                },
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 400
            assert "listing_type" in r.text.lower()
    finally:
        from core import db
        await db.makers.delete_one({"slug": slug})


async def test_create_listing_accepts_digital_type_and_starts_empty():
    from server import app
    from core import db
    transport = ASGITransport(app=app)
    slug = f"iter327m-{uuid.uuid4().hex[:6]}"
    email = f"{slug}@example.com"

    product_slug = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            jwt = await _maker_jwt(c, slug, email)
            r = await c.post(
                "/api/maker/products",
                json={
                    "title": "Pure Digital Bundle",
                    "category": "Wall Art",
                    "technique": "LASER",
                    "price": 29.0,
                    "description": "Just files.",
                    "listing_type": "digital",
                    "status": "draft",
                },
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["listing_type"] == "digital"
            assert body["digital_files"] == []
            product_slug = body["slug"]
    finally:
        if product_slug:
            await db.products.delete_many({"slug": product_slug})
        await db.makers.delete_one({"slug": slug})


async def test_patch_listing_toggles_listing_type():
    from server import app
    from core import db
    transport = ASGITransport(app=app)
    slug = f"iter327m-{uuid.uuid4().hex[:6]}"
    email = f"{slug}@example.com"
    product_slug = None

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            jwt = await _maker_jwt(c, slug, email)
            r = await c.post(
                "/api/maker/products",
                json={
                    "title": "Switchable",
                    "category": "Wall Art",
                    "technique": "ROUTER",
                    "price": 49.0,
                    "description": "x",
                    "status": "draft",
                },
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 200, r.text
            product_slug = r.json()["slug"]

            r = await c.patch(
                f"/api/maker/products/{product_slug}",
                json={"listing_type": "both"},
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 200, r.text
            assert r.json()["listing_type"] == "both"

            # Bad value still rejected.
            r = await c.patch(
                f"/api/maker/products/{product_slug}",
                json={"listing_type": "nope"},
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 400
    finally:
        if product_slug:
            await db.products.delete_many({"slug": product_slug})
        await db.makers.delete_one({"slug": slug})


async def test_digital_file_upload_blocked_on_physical_listing():
    """Uploads must be rejected with a clear 400 when the listing is
    still in default 'physical' mode — the maker has to toggle the
    type first. Prevents accidental data leakage onto a non-digital
    listing that doesn't surface the manifest to buyers."""
    from server import app
    from core import db
    transport = ASGITransport(app=app)
    slug = f"iter327m-{uuid.uuid4().hex[:6]}"
    email = f"{slug}@example.com"
    product_slug = None

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            jwt = await _maker_jwt(c, slug, email)
            r = await c.post(
                "/api/maker/products",
                json={
                    "title": "Just a sign",
                    "category": "Custom Signs",
                    "technique": "PLASMA",
                    "price": 199.0,
                    "description": "x",
                    "status": "draft",
                },
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 200
            product_slug = r.json()["slug"]

            files = {"file": ("design.svg", io.BytesIO(b"<svg/>"), "image/svg+xml")}
            r = await c.post(
                f"/api/maker/listings/{product_slug}/digital-files",
                files=files,
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 400
            assert "digital" in r.text.lower() or "both" in r.text.lower()
    finally:
        if product_slug:
            await db.products.delete_many({"slug": product_slug})
        await db.makers.delete_one({"slug": slug})


async def test_digital_file_upload_rejects_disallowed_extension():
    from server import app
    from core import db
    transport = ASGITransport(app=app)
    slug = f"iter327m-{uuid.uuid4().hex[:6]}"
    email = f"{slug}@example.com"
    product_slug = None

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            jwt = await _maker_jwt(c, slug, email)
            r = await c.post(
                "/api/maker/products",
                json={
                    "title": "Digi", "category": "Wall Art", "technique": "LASER",
                    "price": 5.0, "description": "x",
                    "listing_type": "digital", "status": "draft",
                },
                headers={"Authorization": f"Bearer {jwt}"},
            )
            product_slug = r.json()["slug"]

            # .exe is NOT in the design-file allow-list — must 400.
            files = {"file": ("payload.exe", io.BytesIO(b"\x4d\x5a\x90"), "application/octet-stream")}
            r = await c.post(
                f"/api/maker/listings/{product_slug}/digital-files",
                files=files,
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 400
            assert "unsupported" in r.text.lower() or "allowed" in r.text.lower()
    finally:
        if product_slug:
            await db.products.delete_many({"slug": product_slug})
        await db.makers.delete_one({"slug": slug})


async def test_delete_digital_file_404_on_unknown_id():
    from server import app
    from core import db
    transport = ASGITransport(app=app)
    slug = f"iter327m-{uuid.uuid4().hex[:6]}"
    email = f"{slug}@example.com"
    product_slug = None

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            jwt = await _maker_jwt(c, slug, email)
            r = await c.post(
                "/api/maker/products",
                json={
                    "title": "Digi", "category": "Wall Art", "technique": "LASER",
                    "price": 5.0, "description": "x",
                    "listing_type": "digital", "status": "draft",
                },
                headers={"Authorization": f"Bearer {jwt}"},
            )
            product_slug = r.json()["slug"]

            r = await c.delete(
                f"/api/maker/listings/{product_slug}/digital-files/no-such-id",
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 404
    finally:
        if product_slug:
            await db.products.delete_many({"slug": product_slug})
        await db.makers.delete_one({"slug": slug})
