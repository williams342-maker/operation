"""Regression: iter328 · Founder × Product-Feed audit endpoint.

Verifies the diagnostic admin endpoint
`GET /api/admin/integrations/enrichlabs/founder-feed-audit`
correctly classifies every `tier: "founder"` maker as in-feed or
excluded, with a plain-English reason.

The audit is meant to explain to admins why the Founders Wall count
(all `tier: "founder"`) can exceed the product-feed maker count (only
those with published, in-stock, image-bearing, non-opt-out products).
"""
from __future__ import annotations

import os
import uuid

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )

AUDIT_URL = f"{API}/api/admin/integrations/enrichlabs/founder-feed-audit"


async def _admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token
    email = os.environ.get("OPS_EMAIL", "team@craftersmarket.org")
    tok = issue_admin_magic_token(email)
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{API}/api/admin/auth/verify", json={"token": tok})
    r.raise_for_status()
    data = r.json()
    return data.get("token") or data.get("jwt") or data["access_token"]


@pytest.mark.asyncio
async def test_requires_admin_auth():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(AUDIT_URL)
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_audit_classifies_every_founder_state():
    """Seed 4 founder makers exercising every branch of the audit
    classifier, hit the endpoint, and confirm each is classified with
    the correct reason string."""
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    run = uuid.uuid4().hex[:8]
    slug_ok = f"audit-{run}-ok"
    slug_optout = f"audit-{run}-optout"
    slug_noprod = f"audit-{run}-noprod"
    slug_draft = f"audit-{run}-draftonly"

    # a) In-feed: published, in-stock, imaged, not opted out.
    await db.makers.insert_one({
        "slug": slug_ok, "name": "Audit OK", "tier": "founder",
        "founder_number": 99001, "founder_status": "inaugural",
    })
    await db.products.insert_one({
        "maker_slug": slug_ok, "slug": f"{slug_ok}-p1", "title": "Widget",
        "status": "published", "in_stock": 5, "image_url": "/img/x.jpg",
    })

    # b) Excluded: opted out.
    await db.makers.insert_one({
        "slug": slug_optout, "name": "Audit OptOut", "tier": "founder",
        "founder_number": 99002, "founder_status": "inaugural",
        "external_ads_opt_out": True,
    })
    await db.products.insert_one({
        "maker_slug": slug_optout, "slug": f"{slug_optout}-p1", "title": "Widget",
        "status": "published", "in_stock": 5, "image_url": "/img/x.jpg",
    })

    # c) Excluded: no products at all.
    await db.makers.insert_one({
        "slug": slug_noprod, "name": "Audit NoProd", "tier": "founder",
        "founder_number": 99003, "founder_status": "inaugural",
    })

    # d) Excluded: only draft products.
    await db.makers.insert_one({
        "slug": slug_draft, "name": "Audit DraftOnly", "tier": "founder",
        "founder_number": 99004, "founder_status": "inaugural",
    })
    await db.products.insert_one({
        "maker_slug": slug_draft, "slug": f"{slug_draft}-p1", "title": "Widget",
        "status": "draft", "in_stock": 5, "image_url": "/img/x.jpg",
    })

    try:
        jwt = await _admin_jwt()
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(AUDIT_URL, headers={"Authorization": f"Bearer {jwt}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert {"summary", "founders", "generated_at"} <= set(body)

        rows = {f["slug"]: f for f in body["founders"]}
        assert slug_ok in rows and rows[slug_ok]["in_feed"] is True
        assert rows[slug_ok]["reason_excluded"] is None

        assert slug_optout in rows and rows[slug_optout]["in_feed"] is False
        assert "external_ads_opt_out" in rows[slug_optout]["reason_excluded"]

        assert slug_noprod in rows and rows[slug_noprod]["in_feed"] is False
        assert "No products" in rows[slug_noprod]["reason_excluded"]

        assert slug_draft in rows and rows[slug_draft]["in_feed"] is False
        assert "published" in rows[slug_draft]["reason_excluded"]

        # Summary must be internally consistent.
        s = body["summary"]
        assert s["founders_total"] == s["founders_in_feed"] + s["founders_excluded"]
    finally:
        await db.makers.delete_many({"slug": {"$in": [slug_ok, slug_optout, slug_noprod, slug_draft]}})
        await db.products.delete_many({"maker_slug": {"$in": [slug_ok, slug_optout, slug_noprod, slug_draft]}})
