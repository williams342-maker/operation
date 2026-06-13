"""Backend tests for iteration 3:
SEO endpoints (sitemap.xml, robots.txt), shipping/tax engine (cart/quote +
checkout/session line items), and the Admin Console (magic-link auth, role
enforcement, list endpoints, PATCH approve/quote)."""
import os
import sys
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load env so issue_admin_magic_token / issue_magic_token can run
load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
sys.path.insert(0, "/app/backend")

from maker_auth import issue_admin_magic_token, issue_magic_token  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
OPS_EMAIL = os.environ.get("OPS_EMAIL", "team@craftersmarket.org")
PAID_SESSION = "cs_test_a1iMM98ftY3GF2JouCJbRQkPvPkMcJE9lwLYh51c946CyXqtkL5oaa0O5o"


# --------- Fixtures ---------
@pytest.fixture(scope="session")
def s():
    return requests.Session()


@pytest.fixture(scope="session")
def admin_jwt(s):
    """Mint a real admin JWT through the public verify endpoint."""
    token = issue_admin_magic_token(OPS_EMAIL)
    r = s.post(f"{API}/admin/auth/verify", json={"token": token})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def maker_jwt(s):
    """Mint a real maker JWT through verify (iron-and-oak)."""
    mt = issue_magic_token("iron-and-oak@craftersmarket.org")
    r = s.post(f"{API}/maker/auth/verify", json={"token": mt})
    assert r.status_code == 200, r.text
    return r.json()["token"]


# --------- SEO ---------
class TestSEO:
    def test_sitemap_xml(self, s):
        r = s.get(f"{API}/sitemap.xml")
        assert r.status_code == 200
        assert "application/xml" in r.headers.get("content-type", "")
        body = r.text
        assert "<urlset" in body
        for path in ["/shop", "/makers", "/custom-order", "/apply", "/journal"]:
            assert path in body, f"missing {path}"
        assert "/shop/mountain-range-silhouette" in body
        assert "/makers/iron-and-oak" in body
        # at least one journal slug
        assert "/journal/" in body

    def test_robots_txt(self, s):
        r = s.get(f"{API}/robots.txt")
        assert r.status_code == 200
        assert "text/plain" in r.headers.get("content-type", "")
        body = r.text
        assert "Sitemap:" in body
        assert "Disallow: /maker/" in body
        assert "Disallow: /admin/" in body
        assert "Disallow: /checkout/" in body


# --------- Shipping engine ---------
class TestShipping:
    def test_quote_wall_art_under_threshold(self, s):
        r = s.post(f"{API}/cart/quote", json={
            "items": [{"product_id": "mountain-range-silhouette", "quantity": 1}],
            "origin_url": BASE_URL,
        })
        assert r.status_code == 200
        d = r.json()
        assert d["subtotal"] == 149.0
        assert d["shipping"] == 25.0
        assert d["free_shipping_eligible"] is False

    def test_quote_custom_signs(self, s):
        r = s.post(f"{API}/cart/quote", json={
            "items": [{"product_id": "rustic-family-name-sign", "quantity": 1}],
            "origin_url": BASE_URL,
        })
        assert r.status_code == 200
        d = r.json()
        assert d["shipping"] == 35.0
        assert d["subtotal"] > 0

    def test_quote_outdoor_art(self, s):
        r = s.post(f"{API}/cart/quote", json={
            "items": [{"product_id": "outdoor-compass-medallion", "quantity": 1}],
            "origin_url": BASE_URL,
        })
        assert r.status_code == 200
        d = r.json()
        assert d["shipping"] == 55.0

    def test_quote_free_shipping_over_250(self, s):
        # mountain (149) x 2 = 298 -> free shipping
        r = s.post(f"{API}/cart/quote", json={
            "items": [{"product_id": "mountain-range-silhouette", "quantity": 2}],
            "origin_url": BASE_URL,
        })
        assert r.status_code == 200
        d = r.json()
        assert d["subtotal"] == 298.0
        assert d["shipping"] == 0
        assert d["free_shipping_eligible"] is True

    def test_quote_empty_cart(self, s):
        r = s.post(f"{API}/cart/quote", json={"items": [], "origin_url": BASE_URL})
        assert r.status_code == 200
        d = r.json()
        assert d["subtotal"] == 0
        assert d["shipping"] == 0


# --------- Stripe Checkout (shape only — no live click-through) ---------
class TestCheckout:
    def test_create_session_returns_shape(self, s):
        r = s.post(f"{API}/checkout/session", json={
            "items": [{"product_id": "mountain-range-silhouette", "quantity": 1}],
            "origin_url": BASE_URL,
            "customer_email": "TEST_buyer@example.com",
            # iter411c — Site Policies acceptance now required.
            "policy_accepted": True,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["url", "session_id", "amount", "subtotal", "shipping"]:
            assert k in d
        assert d["session_id"].startswith(("cs_test_", "cs_live_"))
        assert d["subtotal"] == 149.0
        assert d["shipping"] == 25.0
        # amount = subtotal + shipping (Stripe Tax may add a line on the hosted page,
        # but our response uses pre-tax total)
        assert round(d["amount"], 2) == round(d["subtotal"] + d["shipping"], 2)

    @pytest.mark.skip(reason="Hardcoded PAID_SESSION from a past Stripe test environment; "
                            "no longer valid. Regenerate against a fresh paid session.")
    def test_paid_session_regression(self, s):
        r = s.get(f"{API}/checkout/status/{PAID_SESSION}")
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "complete"
        assert d["payment_status"] == "paid"


# --------- Admin auth ---------
class TestAdminAuth:
    def test_request_non_admin_silent(self, s):
        r = s.post(f"{API}/admin/auth/request", json={
            "email": "random@example.com", "origin_url": BASE_URL,
        })
        assert r.status_code == 200
        assert r.json().get("sent") is True

    def test_request_admin_email(self, s):
        r = s.post(f"{API}/admin/auth/request", json={
            "email": OPS_EMAIL, "origin_url": BASE_URL,
        })
        assert r.status_code == 200
        assert r.json().get("sent") is True

    def test_verify_garbage_token(self, s):
        r = s.post(f"{API}/admin/auth/verify", json={"token": "garbage.invalid.token"})
        assert r.status_code == 401

    def test_verify_valid_admin_token(self, s):
        token = issue_admin_magic_token(OPS_EMAIL)
        r = s.post(f"{API}/admin/auth/verify", json={"token": token})
        assert r.status_code == 200
        d = r.json()
        assert "token" in d
        assert d["email"] == OPS_EMAIL.lower()

    def test_verify_non_ops_email_rejected(self, s):
        token = issue_admin_magic_token("random@x.com")
        r = s.post(f"{API}/admin/auth/verify", json={"token": token})
        assert r.status_code == 403


# --------- Role enforcement ---------
class TestRoleEnforcement:
    def test_maker_jwt_rejected_on_admin_endpoints(self, s, maker_jwt):
        h = {"Authorization": f"Bearer {maker_jwt}"}
        for path in ["/admin/me", "/admin/maker-applications",
                     "/admin/custom-orders", "/admin/orders"]:
            r = s.get(f"{API}{path}", headers=h)
            assert r.status_code == 403, f"{path} expected 403 got {r.status_code}"

    def test_admin_jwt_rejected_on_maker_me(self, s, admin_jwt):
        h = {"Authorization": f"Bearer {admin_jwt}"}
        r = s.get(f"{API}/maker/me", headers=h)
        assert r.status_code == 403

    def test_admin_endpoints_require_auth(self, s):
        for path in ["/admin/me", "/admin/maker-applications",
                     "/admin/custom-orders", "/admin/orders"]:
            r = s.get(f"{API}{path}")
            assert r.status_code == 401

    def test_patch_requires_admin(self, s, maker_jwt):
        # Without auth -> 401
        r = s.patch(f"{API}/admin/maker-applications/some-id",
                    json={"approved": True, "note": "x"})
        assert r.status_code == 401
        # With maker JWT -> 403
        r = s.patch(f"{API}/admin/maker-applications/some-id",
                    json={"approved": True, "note": "x"},
                    headers={"Authorization": f"Bearer {maker_jwt}"})
        assert r.status_code == 403


# --------- Admin lists ---------
class TestAdminLists:
    def test_admin_me(self, s, admin_jwt):
        r = s.get(f"{API}/admin/me", headers={"Authorization": f"Bearer {admin_jwt}"})
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "admin"
        assert d["email"] == OPS_EMAIL.lower()

    def test_lists_no_objectid(self, s, admin_jwt):
        h = {"Authorization": f"Bearer {admin_jwt}"}
        for path in ["/admin/maker-applications", "/admin/custom-orders", "/admin/orders"]:
            r = s.get(f"{API}{path}", headers=h)
            assert r.status_code == 200
            data = r.json()
            assert isinstance(data, list)
            for row in data:
                assert "_id" not in row, f"{path} leaked _id"


# --------- Admin PATCH (approve/reject + quote) ---------
class TestAdminPatch:
    def test_approve_then_reject_application(self, s, admin_jwt):
        h = {"Authorization": f"Bearer {admin_jwt}"}
        apps = s.get(f"{API}/admin/maker-applications", headers=h).json()
        if not apps:
            pytest.skip("No maker applications seeded")
        # use a TEST_-prefixed app if present, otherwise the first one
        target = next((a for a in apps if a.get("name", "").startswith("TEST_")), apps[0])
        app_id = target["id"]
        original_status = target.get("status")

        r = s.patch(f"{API}/admin/maker-applications/{app_id}",
                    json={"approved": True, "note": "welcome"}, headers=h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "approved"
        assert d["note"] == "welcome"
        assert "_id" not in d

        # verify persistence via GET
        apps2 = s.get(f"{API}/admin/maker-applications", headers=h).json()
        match = [a for a in apps2 if a["id"] == app_id][0]
        assert match["status"] == "approved"

        # now reject to validate the other branch
        r2 = s.patch(f"{API}/admin/maker-applications/{app_id}",
                     json={"approved": False, "note": "test reject"}, headers=h)
        assert r2.status_code == 200
        assert r2.json()["status"] == "rejected"

        # restore: clear status field by setting back to original (or unset via approve=True if originally approved)
        if original_status is None:
            # best-effort restore — leave as 'rejected' but clear the note
            s.patch(f"{API}/admin/maker-applications/{app_id}",
                    json={"approved": False, "note": ""}, headers=h)

    def test_quote_custom_order(self, s, admin_jwt):
        h = {"Authorization": f"Bearer {admin_jwt}"}
        orders = s.get(f"{API}/admin/custom-orders", headers=h).json()
        if not orders:
            pytest.skip("No custom orders seeded")
        order_id = orders[0]["id"]
        r = s.patch(f"{API}/admin/custom-orders/{order_id}",
                    json={"quote": 250.00, "message": "thanks"}, headers=h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "quoted"
        assert d["quote"] == 250.00
        assert "_id" not in d

    def test_patch_application_404(self, s, admin_jwt):
        h = {"Authorization": f"Bearer {admin_jwt}"}
        r = s.patch(f"{API}/admin/maker-applications/does-not-exist",
                    json={"approved": True}, headers=h)
        assert r.status_code == 404
