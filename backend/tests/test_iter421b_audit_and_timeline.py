"""iter421b — Downgrade audit snapshot enrichment + Founder Timeline."""
from __future__ import annotations

import os, sys, uuid, pytest

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from httpx import ASGITransport, AsyncClient  # noqa: E402
from server import app  # noqa: E402
from core import db  # noqa: E402
from maker_auth import issue_admin_magic_token  # noqa: E402


pytestmark = pytest.mark.asyncio


async def _jwt(c):
    magic = issue_admin_magic_token(os.environ.get("OPS_EMAIL"))
    r = await c.post("/api/admin/auth/verify", json={"token": magic})
    return r.json()["token"]


async def _c():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_downgrade_writes_health_snapshot_to_audit():
    async with await _c() as c:
        jwt = await _jwt(c)
        slug = "iter421b-audit-test-founder"
        # Seed a Founder with some substance so the snapshot has values.
        await db.makers.delete_one({"slug": slug})
        await db.makers.insert_one({
            "slug": slug,
            "name": "iter421b test",
            "email": f"{slug}@example.com",
            "tier": "founder",
            "founder_status": "regular",
            "founder_number": 99998,
            "founder_started_at": "2026-01-01T00:00:00Z",
            "shop_title": "Signal Studio",
            "bio": "A" * 50,
            "cover": "https://cdn/x.jpg",
            "portrait": "https://cdn/p.jpg",
            "techniques": ["ROUTER"],
            "location": "Austin, TX",
        })
        try:
            r = await c.post(
                f"/api/admin/founders/{slug}/downgrade",
                headers={"Authorization": f"Bearer {jwt}"},
                json={"reason": "pytest snapshot check"},
            )
            assert r.status_code == 200

            audit = await db.activity_events.find_one({
                "action": "founder_downgrade", "target_slug": slug,
            })
            assert audit is not None
            snap = audit.get("snapshot") or {}
            # Full snapshot fields.
            assert "health_score" in snap
            assert "health_verdict" in snap
            assert "health_breakdown" in snap
            assert "completeness_pct" in snap
            assert "signals" in snap
            assert "published_products" in snap
            assert "sales_30d" in snap
            assert "views_7d" in snap
            # Sanity: this seeded maker has bio + shop_title + cover + portrait,
            # so completeness_pct must be > 0.
            assert snap["completeness_pct"] > 0
            # Actor + reason preserved.
            assert audit.get("actor")
            assert audit.get("reason") == "pytest snapshot check"
        finally:
            await db.makers.delete_one({"slug": slug})
            await db.activity_events.delete_many({"target_slug": slug})


async def test_timeline_endpoint_shape():
    async with await _c() as c:
        jwt = await _jwt(c)
        # Pick any existing founder from the roster
        m = await db.makers.find_one({"tier": "founder"})
        if not m:
            pytest.skip("no founders in preview to test against")
        slug = m["slug"]
        r = await c.get(
            f"/api/admin/founders/{slug}/timeline",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["slug"] == slug
        assert isinstance(j["events"], list)
        # Every event must have the required keys.
        for e in j["events"]:
            assert "ts" in e and "kind" in e and "label" in e


async def test_timeline_composes_end_to_end():
    """Seed application + maker + product + order + audit, verify all
    six event kinds surface in chronological order."""
    async with await _c() as c:
        jwt = await _jwt(c)
        slug = "iter421b-timeline-test"
        email = f"{slug}@example.com"
        await db.makers.delete_one({"slug": slug})
        await db.beta_applications.delete_many({"email": email})
        await db.products.delete_many({"maker_slug": slug})
        await db.orders.delete_many({"maker_slug": slug})
        await db.activity_events.delete_many({"target_slug": slug})

        try:
            await db.beta_applications.insert_one({
                "id": str(uuid.uuid4()),
                "email": email,
                "studio_name": "TL Studio",
                "name": "T L",
                "created_at": "2026-01-01T00:00:00Z",
                "verified": True,
                "verified_at": "2026-01-02T00:00:00Z",
            })
            await db.makers.insert_one({
                "slug": slug, "name": "TL", "email": email,
                "tier": "founder", "founder_status": "regular",
                "founder_number": 99997,
                "approved_at": "2026-01-05T00:00:00Z",
                "published_at": "2026-01-07T00:00:00Z",
            })
            await db.products.insert_one({
                "id": str(uuid.uuid4()),
                "slug": f"{slug}-p1",
                "maker_slug": slug, "title": "First!", "status": "published",
                "created_at": "2026-01-10T00:00:00Z",
            })
            await db.orders.insert_one({
                "id": str(uuid.uuid4()),
                "maker_slug": slug, "status": "paid", "total": 42.0,
                "created_at": "2026-01-15T00:00:00Z",
            })

            r = await c.get(
                f"/api/admin/founders/{slug}/timeline",
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 200
            kinds = [e["kind"] for e in r.json()["events"]]
            for expected in ("applied", "verified", "approved", "shop_published",
                             "first_product", "first_sale"):
                assert expected in kinds, f"missing {expected}: {kinds}"
            # Chronological ordering.
            ts = [e["ts"] for e in r.json()["events"]]
            assert ts == sorted(ts)
        finally:
            await db.makers.delete_one({"slug": slug})
            await db.beta_applications.delete_many({"email": email})
            await db.products.delete_many({"maker_slug": slug})
            await db.orders.delete_many({"maker_slug": slug})
            await db.activity_events.delete_many({"target_slug": slug})


async def test_timeline_requires_auth():
    async with await _c() as c:
        r = await c.get("/api/admin/founders/anything/timeline")
        assert r.status_code in (401, 403)


async def test_timeline_404_for_unknown_slug():
    async with await _c() as c:
        jwt = await _jwt(c)
        r = await c.get(
            "/api/admin/founders/definitely-not-a-real-slug/timeline",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 404
