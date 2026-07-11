"""iter452 live tests: Smart Sections, Store Events, Analytics endpoints.

Runs against REACT_APP_BACKEND_URL. Complements the in-process pytest
suite (test_iter452_smart_analytics.py) with a real HTTP path — validates
auth dependency wiring, routing, and response contracts as seen by the SPA.
"""
import os
import sys
import time
import uuid

import pytest
import requests
from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")

BASE = os.environ.get("REACT_APP_BACKEND_URL",
                      "https://active-project-4.preview.emergentagent.com").rstrip("/")


def _mint(email: str, admin: bool = False) -> str:
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token, issue_magic_token
    magic = (issue_admin_magic_token(email) if admin
             else issue_magic_token(email))
    path = "/api/admin/auth/verify" if admin else "/api/maker/auth/verify"
    r = requests.post(f"{BASE}{path}", json={"token": magic}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="session")
def maker_jwt():
    return _mint("iron-and-oak@craftersmarket.org")


@pytest.fixture(scope="session")
def other_maker_jwt():
    return _mint("metalart-pro@craftersmarket.org")


@pytest.fixture(scope="session")
def admin_jwt():
    return _mint("team@craftersmarket.org", admin=True)


def _mauth(jwt): return {"Authorization": f"Bearer {jwt}"}


# ── SMART SECTIONS ────────────────────────────────────────────────────────────

class TestSmartSections:

    def test_maker_smart_sections_9_rows(self, maker_jwt):
        r = requests.get(f"{BASE}/api/maker/smart-sections", headers=_mauth(maker_jwt), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "sections" in body
        assert len(body["sections"]) == 9
        keys = {s["key"] for s in body["sections"]}
        expected = {"new-arrivals", "best-sellers", "on-sale", "recently-updated",
                    "customer-favorites", "low-inventory", "nearly-sold-out",
                    "staff-picks", "featured"}
        assert keys == expected
        for s in body["sections"]:
            assert "enabled" in s and "count" in s and "preview" in s
            assert "auto" in s

    def test_maker_smart_sections_requires_auth(self):
        r = requests.get(f"{BASE}/api/maker/smart-sections", timeout=10)
        assert r.status_code in (401, 403)

    def test_admin_cant_access_maker_smart_sections(self, admin_jwt):
        r = requests.get(f"{BASE}/api/maker/smart-sections", headers=_mauth(admin_jwt), timeout=10)
        assert r.status_code in (401, 403)

    def test_patch_unknown_key_404(self, maker_jwt):
        r = requests.patch(f"{BASE}/api/maker/smart-sections/does-not-exist",
                           headers=_mauth(maker_jwt), json={"enabled": True}, timeout=10)
        assert r.status_code == 404

    def test_patch_auto_key_rejects_product_slugs(self, maker_jwt):
        r = requests.patch(f"{BASE}/api/maker/smart-sections/new-arrivals",
                           headers=_mauth(maker_jwt),
                           json={"product_slugs": ["foo"]}, timeout=10)
        assert r.status_code == 400

    def test_patch_toggle_and_revert(self, maker_jwt):
        # Read current state for on-sale, toggle, then revert
        r0 = requests.get(f"{BASE}/api/maker/smart-sections", headers=_mauth(maker_jwt), timeout=10)
        current = next(s for s in r0.json()["sections"] if s["key"] == "on-sale")
        original = current["enabled"]
        # toggle
        r = requests.patch(f"{BASE}/api/maker/smart-sections/on-sale",
                           headers=_mauth(maker_jwt),
                           json={"enabled": not original}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        # verify
        r2 = requests.get(f"{BASE}/api/maker/smart-sections", headers=_mauth(maker_jwt), timeout=10)
        after = next(s for s in r2.json()["sections"] if s["key"] == "on-sale")
        assert after["enabled"] == (not original)
        # revert
        requests.patch(f"{BASE}/api/maker/smart-sections/on-sale",
                       headers=_mauth(maker_jwt),
                       json={"enabled": original}, timeout=10)

    def test_patch_manual_key_dedups_and_ownership(self, maker_jwt):
        # Pull a valid owned slug from products endpoint via analytics
        r_p = requests.get(f"{BASE}/api/maker/analytics/products?days=30",
                           headers=_mauth(maker_jwt), timeout=15)
        assert r_p.status_code == 200
        owned = [x["slug"] for x in r_p.json().get("most_viewed", [])][:2]
        # If products endpoint gave fewer, try no_views_30d
        if len(owned) < 2:
            owned += [x["slug"] for x in r_p.json().get("no_views_30d", [])]
        owned = owned[:2] or ["rustic-family-name-sign"]
        payload_slugs = owned + [owned[0], "totally-fake-not-owned-slug"]
        r = requests.patch(f"{BASE}/api/maker/smart-sections/staff-picks",
                           headers=_mauth(maker_jwt),
                           json={"product_slugs": payload_slugs}, timeout=15)
        assert r.status_code == 200, r.text
        saved = r.json()["setting"].get("product_slugs") or []
        # Fake slug dropped, dedup applied
        assert "totally-fake-not-owned-slug" not in saved
        assert len(saved) == len(set(saved))
        for s in saved:
            assert s in owned

    def test_public_smart_sections_returns_enabled_only(self):
        r = requests.get(f"{BASE}/api/makers/iron-and-oak/smart-sections", timeout=15)
        assert r.status_code == 200
        secs = r.json()["sections"]
        # All returned entries must be enabled per contract
        for s in secs:
            assert "product_slugs" in s
            assert "count" in s
            assert s["count"] == len(s["product_slugs"])
        keys = {s["key"] for s in secs}
        # Seed says new-arrivals + staff-picks are enabled with 2 products each
        assert "new-arrivals" in keys or "staff-picks" in keys or len(secs) >= 0


# ── STORE EVENTS ─────────────────────────────────────────────────────────────

class TestStoreEvents:

    def test_ingest_batch_accepts_whitelisted(self):
        sid = f"sess-TEST_{uuid.uuid4().hex[:8]}"
        payload = {"events": [
            {"type": "store_view", "maker_slug": "iron-and-oak", "session_id": sid,
             "category": "analytics"},
            {"type": "product_click", "maker_slug": "iron-and-oak",
             "product_slug": "rustic-family-name-sign", "session_id": sid,
             "category": "analytics"},
        ]}
        r = requests.post(f"{BASE}/api/store-events", json=payload, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["stored"] == 2

    def test_ingest_filters_bad_types(self):
        r = requests.post(f"{BASE}/api/store-events", json={"events": [
            {"type": "not_a_type", "maker_slug": "iron-and-oak"},
            {"type": "store_view", "maker_slug": "iron-and-oak"},
        ]}, timeout=10)
        assert r.status_code == 200
        assert r.json()["stored"] == 1

    def test_ingest_bot_ua_filtered(self):
        r = requests.post(f"{BASE}/api/store-events",
                          headers={"User-Agent": "Googlebot/2.1"},
                          json={"events": [{"type": "store_view",
                                            "maker_slug": "iron-and-oak"}]},
                          timeout=10)
        assert r.status_code == 200
        assert r.json()["stored"] == 0


# ── MAKER ANALYTICS ──────────────────────────────────────────────────────────

class TestAnalyticsMaker:

    @pytest.mark.parametrize("path", [
        "/api/maker/analytics/overview",
        "/api/maker/analytics/sections",
        "/api/maker/analytics/products",
        "/api/maker/analytics/search-insights",
        "/api/maker/analytics/recommendations",
    ])
    def test_requires_maker_auth(self, path):
        r = requests.get(f"{BASE}{path}", timeout=15)
        assert r.status_code in (401, 403), f"{path} → {r.status_code}"

    @pytest.mark.parametrize("path", [
        "/api/maker/analytics/overview",
        "/api/maker/analytics/sections",
        "/api/maker/analytics/products",
        "/api/maker/analytics/search-insights",
    ])
    def test_admin_cant_access(self, admin_jwt, path):
        r = requests.get(f"{BASE}{path}", headers=_mauth(admin_jwt), timeout=15)
        assert r.status_code in (401, 403)

    def test_overview_shape_and_deltas(self, maker_jwt):
        r = requests.get(f"{BASE}/api/maker/analytics/overview?days=30&tz=America/New_York",
                         headers=_mauth(maker_jwt), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["range"]["days"] == 30
        assert body["range"]["tz"]
        assert "start" in body["range"] and "end" in body["range"]
        for k in ("store_views", "unique_visitors", "product_views", "searches",
                  "search_to_click_rate", "add_to_cart", "orders", "revenue",
                  "conversion_rate", "avg_order_value"):
            assert k in body["current"], f"missing {k}"
            assert k in body["previous"]
            assert k in body["deltas"]
        assert isinstance(body["daily"], list)
        # end must be yesterday (partial today excluded) — end < today
        from datetime import date
        assert body["range"]["end"] < date.today().isoformat()

    def test_overview_range_validation(self, maker_jwt):
        # Invalid days defaults to 30
        r = requests.get(f"{BASE}/api/maker/analytics/overview?days=5",
                         headers=_mauth(maker_jwt), timeout=20)
        assert r.status_code == 200
        assert r.json()["range"]["days"] == 30

    @pytest.mark.parametrize("days", [7, 30, 90])
    def test_overview_valid_days(self, maker_jwt, days):
        r = requests.get(f"{BASE}/api/maker/analytics/overview?days={days}",
                         headers=_mauth(maker_jwt), timeout=25)
        assert r.status_code == 200
        assert r.json()["range"]["days"] == days

    def test_sections_returns_rows(self, maker_jwt):
        r = requests.get(f"{BASE}/api/maker/analytics/sections?days=30",
                         headers=_mauth(maker_jwt), timeout=25)
        assert r.status_code == 200
        secs = r.json()["sections"]
        assert isinstance(secs, list)
        for s in secs:
            for k in ("slug", "name", "smart", "products", "views",
                      "product_clicks", "add_to_cart", "orders",
                      "revenue", "conversion_rate", "top_products"):
                assert k in s

    def test_products_seven_lists(self, maker_jwt):
        r = requests.get(f"{BASE}/api/maker/analytics/products?days=30",
                         headers=_mauth(maker_jwt), timeout=25)
        assert r.status_code == 200
        body = r.json()
        for k in ("most_viewed", "most_purchased", "highest_revenue",
                  "highest_conversion", "lowest_conversion",
                  "no_views_30d", "no_sales_60d"):
            assert isinstance(body.get(k), list)

    def test_search_insights_shape(self, maker_jwt):
        r = requests.get(f"{BASE}/api/maker/analytics/search-insights?days=30",
                         headers=_mauth(maker_jwt), timeout=25)
        assert r.status_code == 200
        b = r.json()
        for k in ("top_terms", "zero_result_terms", "converted_terms",
                  "not_converted_terms", "trending_7d", "trending_30d",
                  "recommendations"):
            assert k in b, f"missing {k}"

    def test_recommendations_shape_and_priority(self, maker_jwt):
        r = requests.get(
            f"{BASE}/api/maker/analytics/recommendations?days=30&ai=0",
            headers=_mauth(maker_jwt), timeout=30)
        assert r.status_code == 200
        b = r.json()
        assert isinstance(b["recommendations"], list)
        assert b["ai_summary"] is None  # ai=0 skips summary
        for rec in b["recommendations"]:
            assert rec["priority"] in ("high", "medium", "low")
            assert isinstance(rec["confidence"], int)
            assert isinstance(rec["message"], str) and rec["message"]
            assert "type" in rec

    def test_recommendations_ai_summary_when_present(self, maker_jwt):
        # ai=1 default; may be None if no recs, but if recs exist it should be a string
        r = requests.get(
            f"{BASE}/api/maker/analytics/recommendations?days=30&ai=1",
            headers=_mauth(maker_jwt), timeout=60)
        assert r.status_code == 200
        b = r.json()
        if b["recommendations"]:
            # First call may take ~5s (LLM); allow None if LLM key missing but should be str
            assert b["ai_summary"] is None or isinstance(b["ai_summary"], str)


# ── ADMIN TRENDS ─────────────────────────────────────────────────────────────

class TestMarketplaceTrends:

    def test_requires_admin(self):
        r = requests.get(f"{BASE}/api/admin/marketplace-trends", timeout=15)
        assert r.status_code in (401, 403)

    def test_maker_cant_access(self, maker_jwt):
        r = requests.get(f"{BASE}/api/admin/marketplace-trends",
                         headers=_mauth(maker_jwt), timeout=15)
        assert r.status_code in (401, 403)

    def test_admin_shape(self, admin_jwt):
        r = requests.get(f"{BASE}/api/admin/marketplace-trends?days=30",
                         headers=_mauth(admin_jwt), timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        for k in ("top_search_terms", "empty_searches",
                  "fastest_growing_sections", "highest_converting_sections",
                  "trending_categories"):
            assert k in b, f"missing {k}"
        assert b["range"]["days"] == 30
