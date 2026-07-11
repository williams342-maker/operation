"""iter455 — Featured Maker Promotion Engine backend tests.

Covers:
  1. Auth guards on admin endpoints (candidates, list promotions, create)
  2. Candidates list shape (featured_score, revenue_30d, reasons, 'current')
  3. Existing iron-and-oak promotion (id 7fbbd532...) with R2 asset URLs
  4. PATCH promotion status transitions (posted → ready)
  5. Activate guards: (a) no-assets → 409, (b) different promo while live → 409,
     (c) ?replace=true succeeds
  6. Congrats email dedupe on re-activation (congrats_email_sent stays true)
  7. Public /api/featured-maker returns iron-and-oak with future ends_at
  8. Maker /api/maker/featured/status: featured:true for iron-and-oak w/ kit,
     featured:false for metalart-pro

DOES NOT call create/regenerate — Emergent LLM budget exhausted (per spec).
Ends with iron-and-oak promo re-activated (replace=true) so it stays live.
"""
import os
import sys

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

PROMO_ID = "7fbbd532-fe4f-450a-bfc3-7d2aaa8d02d9"
IRON = "iron-and-oak"
METAL = "metalart-pro"

# ── Fresh token minting via backend maker_auth (bypasses email flow) ──────────
sys.path.insert(0, "/app/backend")


@pytest.fixture(scope="session")
def admin_token():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token
    magic = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{API}/admin/auth/verify", json={"token": magic}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="session")
def maker_iron_token():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_magic_token
    magic = issue_magic_token(f"{IRON}@craftersmarket.org")
    r = requests.post(f"{API}/maker/auth/verify", json={"token": magic}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="session")
def maker_metal_token():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_magic_token
    magic = issue_magic_token(f"{METAL}@craftersmarket.org")
    r = requests.post(f"{API}/maker/auth/verify", json={"token": magic}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _admin_hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


# ── 1. Auth guards ────────────────────────────────────────────────────────────
class TestAuthGuards:
    def test_candidates_requires_admin(self):
        r = requests.get(f"{API}/admin/featured/candidates", timeout=10)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"

    def test_list_promotions_requires_admin(self):
        r = requests.get(f"{API}/admin/featured/promotions", timeout=10)
        assert r.status_code in (401, 403)

    def test_create_promotion_requires_admin(self):
        # Must reject before hitting paid LLM
        r = requests.post(f"{API}/admin/featured/promotions",
                          json={"maker_slug": IRON, "theme": "spotlight"},
                          timeout=10)
        assert r.status_code in (401, 403), f"create endpoint must reject unauth, got {r.status_code}"

    def test_maker_status_requires_maker(self):
        r = requests.get(f"{API}/maker/featured/status", timeout=10)
        assert r.status_code in (401, 403)


# ── 2. Candidates list shape ──────────────────────────────────────────────────
class TestCandidates:
    def test_candidates_shape(self, admin_token):
        r = requests.get(f"{API}/admin/featured/candidates",
                         headers=_admin_hdr(admin_token), timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "candidates" in data
        assert "current" in data
        cands = data["candidates"]
        assert isinstance(cands, list) and len(cands) > 0
        first = cands[0]
        for key in ("maker_slug", "featured_score", "revenue_30d", "reasons"):
            assert key in first, f"candidate missing {key}: {first}"
        assert isinstance(first["reasons"], list) and len(first["reasons"]) >= 1
        # current should point at iron-and-oak (live feature)
        cur = data["current"]
        assert cur is not None, "expected an active feature but 'current' is null"
        assert cur.get("maker_slug") == IRON
        assert cur.get("ends_at", "") > "2026-01-01"


# ── 3. Existing iron-and-oak promotion ───────────────────────────────────────
class TestExistingPromo:
    def test_iron_promo_exists_with_assets(self, admin_token):
        r = requests.get(f"{API}/admin/featured/promotions",
                         headers=_admin_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        promos = r.json().get("promotions") or []
        target = next((p for p in promos if p.get("id") == PROMO_ID), None)
        assert target is not None, f"promo {PROMO_ID} not in list"
        assert target.get("status") in ("ready", "posted"), f"unexpected status {target.get('status')}"
        assets = target.get("assets") or {}
        assert assets.get("square_url"), "square_url missing"
        assert assets.get("landscape_url"), "landscape_url missing"
        assert "cdn.craftersmarket.org" in assets["square_url"]
        assert "cdn.craftersmarket.org" in assets["landscape_url"]


# ── 4. PATCH promotion status transitions ────────────────────────────────────
class TestPromoPatch:
    def test_mark_posted_then_ready(self, admin_token):
        # PATCH → posted
        r = requests.patch(f"{API}/admin/featured/promotions/{PROMO_ID}",
                           headers=_admin_hdr(admin_token),
                           json={"status": "posted", "platforms": ["manual"]},
                           timeout=15)
        assert r.status_code == 200
        promo = r.json().get("promotion") or {}
        assert promo.get("status") == "posted"
        assert promo.get("posted_at"), "posted_at should be set on transition to posted"
        assert promo.get("platforms") == ["manual"]
        # PATCH back → ready
        r2 = requests.patch(f"{API}/admin/featured/promotions/{PROMO_ID}",
                            headers=_admin_hdr(admin_token),
                            json={"status": "ready"}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["promotion"]["status"] == "ready"


# ── 5. Activation guards ──────────────────────────────────────────────────────
class TestActivationGuards:
    @pytest.fixture(scope="class")
    def temp_no_assets_promo(self):
        """Insert a temp promo with no assets directly into Mongo, cleanup after."""
        import asyncio
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        from core import db, now_iso

        temp_id = "tst-noassets"
        doc = {
            "id": temp_id, "maker_slug": IRON, "maker_name": "Iron & Oak Studio",
            "product_slug": "mountain-range-silhouette", "product_title": "Test",
            "theme": "spotlight", "status": "draft",
            "assets": {"square_url": None, "landscape_url": None, "alt_text": None},
            "captions": {}, "score": 0, "reasons": [], "activated": False,
            "starts_at": None, "ends_at": None, "platforms": [],
            "performance": {}, "created_at": now_iso(),
        }

        async def _setup():
            await db.featured_promotions.insert_one({**doc})

        async def _teardown():
            await db.featured_promotions.delete_one({"id": temp_id})

        asyncio.run(_setup())
        yield temp_id
        asyncio.run(_teardown())

    def test_activate_no_assets_returns_409(self, admin_token, temp_no_assets_promo):
        r = requests.post(f"{API}/admin/featured/promotions/{temp_no_assets_promo}/activate",
                          headers=_admin_hdr(admin_token), timeout=15)
        assert r.status_code == 409
        detail = r.json().get("detail", "")
        assert "asset generation" in detail.lower() or "generation failed" in detail.lower(), \
            f"unexpected detail: {detail}"

    @pytest.fixture(scope="class")
    def temp_other_promo(self):
        """Insert a temp promo with fake asset URLs to test 'already featured' guard."""
        import asyncio
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        from core import db, now_iso

        temp_id = "tst-other-live"
        doc = {
            "id": temp_id, "maker_slug": METAL, "maker_name": "MetalArt Pro",
            "product_slug": None, "product_title": "Test",
            "theme": "spotlight", "status": "ready",
            "assets": {
                "square_url": "https://cdn.craftersmarket.org/featured-promos/test-sq.png",
                "landscape_url": "https://cdn.craftersmarket.org/featured-promos/test-ld.png",
                "alt_text": "test",
            },
            "captions": {}, "score": 0, "reasons": [], "activated": False,
            "starts_at": None, "ends_at": None, "platforms": [],
            "performance": {}, "created_at": now_iso(),
        }

        async def _setup():
            await db.featured_promotions.insert_one({**doc})

        async def _teardown():
            await db.featured_promotions.delete_one({"id": temp_id})

        asyncio.run(_setup())
        yield temp_id
        asyncio.run(_teardown())

    def test_activate_conflict_without_replace(self, admin_token, temp_other_promo):
        r = requests.post(f"{API}/admin/featured/promotions/{temp_other_promo}/activate",
                          headers=_admin_hdr(admin_token), timeout=15)
        assert r.status_code == 409
        detail = r.json().get("detail", "").lower()
        assert "replace" in detail, f"expected mention of replace=true, got: {detail}"


# ── 6. Congrats email dedupe on re-activation ────────────────────────────────
class TestDedupeAndRestore:
    def test_reactivate_iron_with_replace_no_duplicate_email(self, admin_token):
        """Re-activate the iron-and-oak promo with replace=true → 200, and
        congrats_email_sent must remain True (no duplicate send)."""
        r = requests.post(
            f"{API}/admin/featured/promotions/{PROMO_ID}/activate?replace=true",
            headers=_admin_hdr(admin_token), timeout=20)
        assert r.status_code == 200, f"replace-activate failed: {r.status_code} {r.text[:200]}"
        body = r.json()
        assert body.get("ok") is True
        assert body.get("ends_at", "") > "2026-01-01"

        # Verify congrats_email_sent flag is still True after re-activation
        import asyncio
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        from core import db

        async def _check():
            return await db.featured_promotions.find_one(
                {"id": PROMO_ID}, {"_id": 0, "congrats_email_sent": 1})

        promo = asyncio.run(_check())
        assert promo.get("congrats_email_sent") is True, \
            "congrats_email_sent flag must persist to prevent duplicate emails"


# ── 7. Public featured-maker endpoint (no auth) ──────────────────────────────
class TestPublicFeatured:
    def test_public_returns_iron(self):
        r = requests.get(f"{API}/featured-maker", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("featured") is not None, "no active featured maker"
        f = data["featured"]
        maker = f.get("maker") or {}
        assert maker.get("slug") == IRON
        assert f.get("ends_at", "") > "2026-01-01"
        assert f.get("banner_url"), "banner_url should point to R2 landscape asset"
        assert "cdn.craftersmarket.org" in f["banner_url"] or f["banner_url"].startswith("http")
        assert isinstance(f.get("products"), list)


# ── 8. Maker /maker/featured/status ──────────────────────────────────────────
class TestMakerStatus:
    def test_iron_sees_featured_true_with_kit(self, maker_iron_token):
        r = requests.get(f"{API}/maker/featured/status",
                         headers=_admin_hdr(maker_iron_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("featured") is True
        kit = d.get("kit") or {}
        assets = kit.get("assets") or {}
        assert assets.get("square_url"), "kit.assets.square_url missing"
        assert assets.get("landscape_url"), "kit.assets.landscape_url missing"
        # captions may be default/empty (LLM budget exhausted) — just verify key exists
        assert "captions" in kit
        stats = d.get("stats") or {}
        for k in ("store_views_today", "store_views_total", "product_views", "add_to_cart"):
            assert k in stats

    def test_metal_sees_featured_false(self, maker_metal_token):
        r = requests.get(f"{API}/maker/featured/status",
                         headers=_admin_hdr(maker_metal_token), timeout=15)
        assert r.status_code == 200
        assert r.json().get("featured") is False
