"""Iteration 44 — Maker Bulk-Purge Toolbar (P2 backlog).

Covers:
- DELETE /api/maker/products/{slug}/purge (new)  — archived-only, no-orders, owner-only
- DELETE /api/maker/products/{slug}        (soft-delete)  — Bulk Restore precursor
- POST   /api/maker/products/{slug}/restore (existing)    — used by Bulk Restore
"""
import os
import sys
import uuid
import pytest
import requests
from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")
from maker_auth import issue_session_jwt  # noqa: E402

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    # Fallback to frontend .env when not invoked via that environment
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

IRON = issue_session_jwt("iron-and-oak", "iron-and-oak@craftersmarket.org")
META = issue_session_jwt("metalart-pro", "metalart-pro@craftersmarket.org")

H_IRON = {"Authorization": f"Bearer {IRON}", "Content-Type": "application/json"}
H_META = {"Authorization": f"Bearer {META}", "Content-Type": "application/json"}


def _create_iron_listing(suffix: str = "") -> str:
    """Helper: create a draft test listing on iron-and-oak; return slug."""
    sfx = suffix or uuid.uuid4().hex[:6]
    payload = {
        "title": f"TEST_iter44_purge_{sfx}",
        "category": "wood",
        "technique": "carving",
        "price": 25.0,
        "description": "iter44 bulk purge regression test listing",
        "materials": ["wood"],
        "dimensions": "10x10",
        "images": [],
        "in_stock": 5,
        "status": "draft",
    }
    r = requests.post(f"{BASE_URL}/api/maker/products", json=payload, headers=H_IRON, timeout=30)
    assert r.status_code == 200, f"create failed: {r.status_code} {r.text}"
    return r.json()["slug"]


# ───────────────────────── PURGE — happy path ─────────────────────────

class TestPurgeHappyPath:
    def test_purge_after_archive(self):
        slug = _create_iron_listing()
        try:
            # Archive (soft-delete)
            r = requests.delete(f"{BASE_URL}/api/maker/products/{slug}", headers=H_IRON, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json().get("deleted") is True
            assert "deleted_at" in r.json()

            # Purge (hard-delete)
            r = requests.delete(f"{BASE_URL}/api/maker/products/{slug}/purge", headers=H_IRON, timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("purged") is True
            assert body.get("slug") == slug

            # Verify gone from /maker/products
            r = requests.get(f"{BASE_URL}/api/maker/products", headers=H_IRON, timeout=15)
            assert r.status_code == 200
            assert not any(p["slug"] == slug for p in r.json()), "purged listing still appears"
        except Exception:
            requests.delete(f"{BASE_URL}/api/maker/products/{slug}/purge", headers=H_IRON, timeout=15)
            raise


# ───────────────────────── PURGE — error gates ─────────────────────────

class TestPurgeErrorGates:
    def test_purge_live_listing_400(self):
        """Cannot purge a listing that hasn't been archived first."""
        slug = _create_iron_listing("live")
        try:
            r = requests.delete(f"{BASE_URL}/api/maker/products/{slug}/purge", headers=H_IRON, timeout=15)
            assert r.status_code == 400, f"expected 400 on live, got {r.status_code} {r.text}"
            assert "archived" in r.json().get("detail", "").lower()
        finally:
            requests.delete(f"{BASE_URL}/api/maker/products/{slug}", headers=H_IRON, timeout=15)
            requests.delete(f"{BASE_URL}/api/maker/products/{slug}/purge", headers=H_IRON, timeout=15)

    def test_purge_unknown_slug_404(self):
        r = requests.delete(
            f"{BASE_URL}/api/maker/products/iter44-does-not-exist-{uuid.uuid4().hex[:6]}/purge",
            headers=H_IRON, timeout=15,
        )
        assert r.status_code == 404

    def test_purge_other_maker_403(self):
        """Cross-tenant: metalart-pro cannot purge an iron-and-oak listing."""
        slug = _create_iron_listing("xtenant")
        try:
            # Archive it as iron
            r = requests.delete(f"{BASE_URL}/api/maker/products/{slug}", headers=H_IRON, timeout=15)
            assert r.status_code == 200
            # Try to purge as metalart-pro
            r = requests.delete(f"{BASE_URL}/api/maker/products/{slug}/purge", headers=H_META, timeout=15)
            assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
        finally:
            requests.delete(f"{BASE_URL}/api/maker/products/{slug}/purge", headers=H_IRON, timeout=15)

    def test_purge_no_auth_401_or_403(self):
        slug = _create_iron_listing("noauth")
        try:
            requests.delete(f"{BASE_URL}/api/maker/products/{slug}", headers=H_IRON, timeout=15)
            r = requests.delete(f"{BASE_URL}/api/maker/products/{slug}/purge", timeout=15)
            assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"
        finally:
            requests.delete(f"{BASE_URL}/api/maker/products/{slug}/purge", headers=H_IRON, timeout=15)

    def test_purge_with_order_history_400(self):
        """REGRESSION: backend currently checks `payment_transactions.items.slug`
        but real items use `product_id` — so the order-history gate is broken
        and any archived listing can be permanently purged regardless of
        whether it has order history. This test will FAIL until the maker
        purge endpoint is patched to query by `items.product_id` (or both).

        Setup: confirm carved-oak-wedding-monogram is referenced by paid
        payment_transactions (44 rows expected per Mongo audit), archive it,
        then assert purge is rejected.
        """
        target = "carved-oak-wedding-monogram"
        # Sanity: it must exist before we try
        get_resp = requests.get(f"{BASE_URL}/api/products/{target}", timeout=15)
        if get_resp.status_code != 200:
            pytest.skip(f"{target} not present, skipping")
        was_archived = bool(get_resp.json().get("deleted_at"))
        try:
            if not was_archived:
                r = requests.delete(f"{BASE_URL}/api/maker/products/{target}",
                                    headers=H_IRON, timeout=15)
                assert r.status_code == 200
            r = requests.delete(f"{BASE_URL}/api/maker/products/{target}/purge",
                                headers=H_IRON, timeout=15)
            assert r.status_code == 400, (
                f"CRITICAL — order-history gate broken. expected 400, "
                f"got {r.status_code} {r.text}. Likely fix: query "
                f"payment_transactions by items.product_id, not items.slug."
            )
            assert "order history" in r.json().get("detail", "").lower()
        finally:
            # Always restore live state
            requests.post(f"{BASE_URL}/api/maker/products/{target}/restore",
                          headers=H_IRON, timeout=15)


# ───────────────────────── Bulk-toolbar adjacent endpoints ─────────────────────────

class TestSoftDeleteAndRestore:
    def test_soft_delete_then_restore_roundtrip(self):
        slug = _create_iron_listing("rt")
        try:
            # Soft-delete
            r = requests.delete(f"{BASE_URL}/api/maker/products/{slug}", headers=H_IRON, timeout=15)
            assert r.status_code == 200
            assert r.json().get("deleted") is True

            # Verify it shows as archived (deleted_at set) in maker list
            r = requests.get(f"{BASE_URL}/api/maker/products", headers=H_IRON, timeout=15)
            archived = next((p for p in r.json() if p["slug"] == slug), None)
            assert archived is not None, "soft-deleted listing missing from maker products"
            assert archived.get("deleted_at"), "deleted_at not set after soft-delete"

            # Restore
            r = requests.post(f"{BASE_URL}/api/maker/products/{slug}/restore",
                              headers=H_IRON, timeout=15)
            assert r.status_code == 200
            assert r.json().get("deleted_at") in (None, ""), "deleted_at not cleared after restore"

            # Verify cleared in list
            r = requests.get(f"{BASE_URL}/api/maker/products", headers=H_IRON, timeout=15)
            restored = next((p for p in r.json() if p["slug"] == slug), None)
            assert restored is not None
            assert not restored.get("deleted_at")
        finally:
            requests.delete(f"{BASE_URL}/api/maker/products/{slug}", headers=H_IRON, timeout=15)
            requests.delete(f"{BASE_URL}/api/maker/products/{slug}/purge", headers=H_IRON, timeout=15)

    def test_soft_delete_other_maker_403(self):
        slug = _create_iron_listing("xtdel")
        try:
            r = requests.delete(f"{BASE_URL}/api/maker/products/{slug}", headers=H_META, timeout=15)
            assert r.status_code == 403
        finally:
            requests.delete(f"{BASE_URL}/api/maker/products/{slug}", headers=H_IRON, timeout=15)
            requests.delete(f"{BASE_URL}/api/maker/products/{slug}/purge", headers=H_IRON, timeout=15)


class TestBulkScenario:
    """Simulate the frontend bulk-toolbar Restore + Purge pattern: 3 archived
    listings → restore 1, purge 2."""

    def test_bulk_restore_and_purge_sequence(self):
        slugs = [_create_iron_listing(f"bulk{i}") for i in range(3)]
        try:
            # Archive all 3
            for s in slugs:
                r = requests.delete(f"{BASE_URL}/api/maker/products/{s}", headers=H_IRON, timeout=15)
                assert r.status_code == 200
            # Bulk restore the first one
            r = requests.post(f"{BASE_URL}/api/maker/products/{slugs[0]}/restore",
                              headers=H_IRON, timeout=15)
            assert r.status_code == 200
            # Bulk purge the other two
            for s in slugs[1:]:
                r = requests.delete(f"{BASE_URL}/api/maker/products/{s}/purge",
                                    headers=H_IRON, timeout=15)
                assert r.status_code == 200, f"{s} purge failed: {r.text}"
            # Verify final state
            r = requests.get(f"{BASE_URL}/api/maker/products", headers=H_IRON, timeout=15)
            data = r.json()
            assert any(p["slug"] == slugs[0] and not p.get("deleted_at") for p in data), \
                "restored slug missing or still archived"
            assert not any(p["slug"] in slugs[1:] for p in data), "purged slugs still present"
        finally:
            # Cleanup whatever survived
            for s in slugs:
                requests.delete(f"{BASE_URL}/api/maker/products/{s}", headers=H_IRON, timeout=15)
                requests.delete(f"{BASE_URL}/api/maker/products/{s}/purge", headers=H_IRON, timeout=15)
