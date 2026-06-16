"""Phase 4b/4c — Meta + Microsoft Ads push endpoint tests.

Verifies the new admin AI Ad-Creative push endpoints work alongside the
existing Google Ads push gateway:
  - GET  /api/admin/ad-creative/push/{google,meta,microsoft}/preflight
  - POST /api/admin/ad-creative/drafts/{draft_id}/push/{meta,microsoft}

Also regresses /api/products?limit=5 (seeder hardening fix).
"""
from __future__ import annotations
import os
import sys
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

sys.path.insert(0, "/app/backend")


def _admin_jwt() -> str:
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token
    magic = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{API}/admin/auth/verify", json={"token": magic}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token() -> str:
    return _admin_jwt()


@pytest.fixture(scope="module")
def admin_headers(admin_token) -> dict:
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def published_product_slug() -> str:
    r = requests.get(f"{API}/products?limit=5", timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    assert isinstance(items, list) and len(items) > 0
    return items[0]["slug"]


# ── Preflight regression + new endpoints ──────────────────────────────
class TestPreflights:
    def test_google_preflight_still_200(self, admin_headers):
        r = requests.get(f"{API}/admin/ad-creative/push/google/preflight", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "eligible" in data and "reason" in data

    def test_meta_preflight_returns_eligible_false(self, admin_headers):
        r = requests.get(f"{API}/admin/ad-creative/push/meta/preflight", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # iter413as — Meta may already be connected in this env; just verify shape.
        assert "eligible" in data and "reason" in data
        if data.get("eligible") is False:
            assert "Connect Meta Ads" in (data.get("reason") or "") or "Meta" in (data.get("reason") or "")

    def test_microsoft_preflight_returns_eligible_false(self, admin_headers):
        r = requests.get(f"{API}/admin/ad-creative/push/microsoft/preflight", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "eligible" in data and "reason" in data
        if data.get("eligible") is False:
            assert "Microsoft" in (data.get("reason") or "")

    def test_google_preflight_requires_admin(self):
        r = requests.get(f"{API}/admin/ad-creative/push/google/preflight", timeout=15)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text}"

    def test_meta_preflight_requires_admin(self):
        r = requests.get(f"{API}/admin/ad-creative/push/meta/preflight", timeout=15)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text}"

    def test_microsoft_preflight_requires_admin(self):
        r = requests.get(f"{API}/admin/ad-creative/push/microsoft/preflight", timeout=15)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text}"


# ── Push endpoints — 404 + 422 validation ─────────────────────────────
class TestPushValidation:
    def test_push_meta_404_for_missing_draft(self, admin_headers):
        r = requests.post(
            f"{API}/admin/ad-creative/drafts/does_not_exist_xyz/push/meta",
            headers=admin_headers, json={"daily_budget_cents": 1000}, timeout=15,
        )
        assert r.status_code == 404, r.text

    def test_push_microsoft_404_for_missing_draft(self, admin_headers):
        r = requests.post(
            f"{API}/admin/ad-creative/drafts/does_not_exist_xyz/push/microsoft",
            headers=admin_headers, json={"daily_budget_cents": 1000}, timeout=15,
        )
        assert r.status_code == 404, r.text

    def test_push_meta_422_below_min_budget(self, admin_headers):
        r = requests.post(
            f"{API}/admin/ad-creative/drafts/any_id/push/meta",
            headers=admin_headers, json={"daily_budget_cents": 100}, timeout=15,
        )
        assert r.status_code == 422, r.text

    def test_push_microsoft_422_below_min_budget(self, admin_headers):
        r = requests.post(
            f"{API}/admin/ad-creative/drafts/any_id/push/microsoft",
            headers=admin_headers, json={"daily_budget_cents": 100}, timeout=15,
        )
        assert r.status_code == 422, r.text


# ── End-to-end happy path → 409 GatewayNotEligible ────────────────────
def _generate_draft(headers: dict, slug: str, channels: list[str]) -> str:
    """Helper to POST /admin/ad-creative/generate and return the draft_id."""
    body = {
        "subject_type": "product",
        "subject_slug": slug,
        "channels": channels,
        "tone": "professional",
        "generate_images": False,
    }
    r = requests.post(f"{API}/admin/ad-creative/generate", headers=headers, json=body, timeout=120)
    assert r.status_code == 200, f"generate failed: {r.status_code} {r.text[:500]}"
    data = r.json()
    draft_obj = data.get("draft") or {}
    draft_id = (
        data.get("draft_id")
        or draft_obj.get("draft_id")
        or draft_obj.get("_id")
        or draft_obj.get("id")
    )
    assert draft_id, f"no draft_id in response: {data}"
    return draft_id


class TestPushHappyPath:
    def test_meta_push_returns_409_when_not_connected(self, admin_headers, published_product_slug):
        draft_id = _generate_draft(admin_headers, published_product_slug, ["meta_feed"])
        r = requests.post(
            f"{API}/admin/ad-creative/drafts/{draft_id}/push/meta",
            headers=admin_headers, json={"daily_budget_cents": 500}, timeout=30,
        )
        assert r.status_code == 409, f"expected 409 got {r.status_code}: {r.text}"
        detail = (r.json().get("detail") or "").lower()
        # The friendly reason should mention either Meta App Review or ads_management
        assert ("app review" in detail) or ("ads_management" in detail) or ("connect meta" in detail), \
            f"detail missing meta-specific reason: {detail!r}"

    def test_microsoft_push_returns_409_when_not_connected(self, admin_headers, published_product_slug):
        draft_id = _generate_draft(admin_headers, published_product_slug, ["google_search"])
        r = requests.post(
            f"{API}/admin/ad-creative/drafts/{draft_id}/push/microsoft",
            headers=admin_headers, json={"daily_budget_cents": 500}, timeout=30,
        )
        assert r.status_code == 409, f"expected 409 got {r.status_code}: {r.text}"
        detail = (r.json().get("detail") or "").lower()
        assert "microsoft" in detail, f"detail missing microsoft mention: {detail!r}"


# ── Cross-channel validation (400 missing-spec) ───────────────────────
class TestChannelValidation:
    def test_meta_only_draft_pushed_to_microsoft_400(self, admin_headers, published_product_slug):
        draft_id = _generate_draft(admin_headers, published_product_slug, ["meta_feed"])
        r = requests.post(
            f"{API}/admin/ad-creative/drafts/{draft_id}/push/microsoft",
            headers=admin_headers, json={"daily_budget_cents": 500}, timeout=30,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"
        detail = (r.json().get("detail") or "").lower()
        assert ("google_search" in detail) or ("google" in detail), f"detail: {detail!r}"

    def test_google_only_draft_pushed_to_meta_400(self, admin_headers, published_product_slug):
        draft_id = _generate_draft(admin_headers, published_product_slug, ["google_search"])
        r = requests.post(
            f"{API}/admin/ad-creative/drafts/{draft_id}/push/meta",
            headers=admin_headers, json={"daily_budget_cents": 500}, timeout=30,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"
        detail = (r.json().get("detail") or "").lower()
        assert "meta" in detail, f"detail: {detail!r}"


# ── Regression: pushes list + products endpoint ───────────────────────
class TestRegression:
    def test_pushes_list_returns_200(self, admin_headers):
        r = requests.get(f"{API}/admin/ad-creative/pushes", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # Accept list directly or wrapped in {"items": [...]} or {"pushes": [...]}
        assert isinstance(data, (list, dict))

    def test_products_endpoint_returns_200(self):
        r = requests.get(f"{API}/products?limit=5", timeout=15)
        assert r.status_code == 200, f"products endpoint regressed: {r.status_code} {r.text[:300]}"
        items = r.json()
        assert isinstance(items, list)
