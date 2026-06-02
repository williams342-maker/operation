"""iter317 — Admin distribution-status + zombie-cleanup quick tests.

Isolated module-level tests for the new readiness probe endpoint and
the existing zombie-cleanup APIs that the new admin UI cards consume.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

from server import app  # noqa: E402
from core import db, ADMIN_EMAILS  # noqa: E402
from maker_auth import issue_admin_magic_token  # noqa: E402

pytestmark = pytest.mark.asyncio


async def _admin_jwt() -> str:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        email = next(iter(ADMIN_EMAILS))
        magic = issue_admin_magic_token(email)
        r = await ac.post("/api/admin/auth/verify", json={"token": magic})
        assert r.status_code == 200, r.text
        return r.json()["token"]


# ────────────────────────────────────────────────────────────────────
# Distribution status — Cloudflare + Meta probes
# ────────────────────────────────────────────────────────────────────

async def test_distribution_status_shape(monkeypatch):
    """Patch the outbound HTTP probes so the test is fully offline.
    Verifies the response shape (verdicts, probe rows, runbook URL)."""
    async def _fake_cf():
        return {
            "verdict": "not_deployed",
            "probes": [
                {"url": "https://craftersmarket.org/shop", "status": 200,
                 "has_prerender_marker": False, "is_spa_shell": True, "bytes": 5000},
            ],
            "deploy_runbook_url": "https://example/runbook",
            "worker_script_path": "/app/cloudflare/prerender-router.worker.js",
            "readme_path": "/app/cloudflare/README.md",
        }

    async def _fake_meta():
        return {
            "verdict": "live",
            "status": 200,
            "feed_url": "https://craftersmarket.org/api/meta/feed.csv",
            "row_count": 42,
            "bytes": 50000,
            "next_step": "next step",
            "meta_dashboard_url": "https://business.facebook.com/commerce/catalogs",
        }

    monkeypatch.setattr(
        "routers.admin_distribution_status._probe_cloudflare_worker", _fake_cf,
    )
    monkeypatch.setattr(
        "routers.admin_distribution_status._probe_meta_feed", _fake_meta,
    )

    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/distribution/status",
                         headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "as_of" in body
    cf = body["cloudflare_worker"]
    assert cf["verdict"] == "not_deployed"
    assert isinstance(cf["probes"], list) and len(cf["probes"]) >= 1
    meta = body["meta_commerce"]
    assert meta["verdict"] == "live"
    assert meta["row_count"] == 42
    assert "meta_dashboard_url" in meta


# ────────────────────────────────────────────────────────────────────
# Zombie cleanup — existing endpoints, smoke + soft-delete round-trip
# ────────────────────────────────────────────────────────────────────

async def test_incomplete_products_smoke():
    """Just confirms `/api/admin/products/incomplete` returns the expected
    shape — `items` list + `count`. Don't assert on specific zombies
    because the dev DB shifts."""
    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/products/incomplete",
                         headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body and isinstance(body["items"], list)
    assert "count" in body and isinstance(body["count"], int)


async def test_soft_delete_and_restore_roundtrip():
    """Seed a deliberately-zombie product, soft-delete it, confirm it
    drops out of the incomplete list (it's no longer "live"), restore
    it, confirm it comes back."""
    slug = "iter317-test-zombie"
    # Wipe any prior leftover from a previous run.
    await db.products.delete_many({"slug": slug})
    await db.products.insert_one({
        "slug": slug,
        "title": "",                  # no title  → zombie
        "description": "",            # no desc   → zombie
        "price": 0,                   # zero price → zombie
        "images": [],
        "image_url": "",
        "status": "published",
        "maker_slug": "iter317-fake-maker",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    })
    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Confirm it appears in /incomplete with all 4 issues.
        r = await ac.get("/api/admin/products/incomplete",
                         headers={"Authorization": f"Bearer {jwt}"})
        assert r.status_code == 200
        items = r.json()["items"]
        ours = next((i for i in items if i["slug"] == slug), None)
        assert ours is not None
        assert set(ours["issues"]) >= {"no_title", "no_description", "zero_price", "no_images"}

        # 2. Soft-delete.
        r = await ac.post(
            f"/api/admin/products/{slug}/soft-delete",
            json={"reason": "iter317-test"},
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200, r.text

        # 3. Should no longer appear in /incomplete (excluded by deleted_at).
        r = await ac.get("/api/admin/products/incomplete",
                         headers={"Authorization": f"Bearer {jwt}"})
        slugs_now = {i["slug"] for i in r.json()["items"]}
        assert slug not in slugs_now

        # 4. Restore.
        r = await ac.post(f"/api/admin/products/{slug}/restore",
                          headers={"Authorization": f"Bearer {jwt}"})
        assert r.status_code == 200, r.text
        row = await db.products.find_one({"slug": slug})
        assert row["status"] == "draft"
        assert row["deleted_at"] in (None, "")

    # Cleanup
    await db.products.delete_one({"slug": slug})
