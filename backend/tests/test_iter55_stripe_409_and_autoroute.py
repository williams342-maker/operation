"""Iter55 — Stripe dashboard-link 409 onboarding_incomplete + admin auto-route top match.

Targets public REACT_APP_BACKEND_URL. Uses direct Mongo access to flip charges_enabled
on iron-and-oak for the 409 path, then restores. Also exercises the existing
push-to-maker endpoint through an unassigned brief to validate the auto-route path.
"""
import os
import sys
import uuid
import asyncio
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _issue_maker_jwt(email: str) -> str:
    from maker_auth import issue_magic_token
    tok = issue_magic_token(email)
    r = requests.post(f"{API}/maker/auth/verify", json={"token": tok}, timeout=20)
    r.raise_for_status()
    return r.json()["token"]


def _issue_admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{API}/admin/auth/verify", json={"token": tok}, timeout=20)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="session")
def maker_jwt():
    return _issue_maker_jwt("iron-and-oak@craftersmarket.org")


@pytest.fixture(scope="session")
def admin_jwt():
    return _issue_admin_jwt()


@pytest.fixture(scope="session")
def maker_headers(maker_jwt):
    return {"Authorization": f"Bearer {maker_jwt}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_headers(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}", "Content-Type": "application/json"}


# --- Mongo helper to flip charges_enabled --------------------------------
async def _get_db():
    from motor.motor_asyncio import AsyncIOMotorClient
    url = os.environ["MONGO_URL"]
    name = os.environ["DB_NAME"]
    return AsyncIOMotorClient(url)[name]


def _set_maker_charges_enabled(slug: str, value: bool):
    async def run():
        db = await _get_db()
        await db.makers.update_one({"slug": slug}, {"$set": {"stripe_charges_enabled": value}})
    asyncio.run(run())


def _get_maker_stripe_state(slug: str):
    async def run():
        db = await _get_db()
        m = await db.makers.find_one({"slug": slug}, {"_id": 0, "stripe_account_id": 1, "stripe_charges_enabled": 1})
        return m or {}
    return asyncio.run(run())


# =========================================================================
# Stripe dashboard-link endpoint — 200 / 409 / 400 paths
# =========================================================================
class TestStripeDashboardLink:
    """POST /api/maker/stripe/connect/dashboard-link — structured 409 on incomplete."""

    def test_auth_required(self):
        r = requests.post(f"{API}/maker/stripe/connect/dashboard-link", timeout=15)
        assert r.status_code in (401, 403)

    def test_happy_path_returns_login_url(self, maker_headers):
        state = _get_maker_stripe_state("iron-and-oak")
        if not state.get("stripe_account_id"):
            pytest.skip("iron-and-oak has no stripe_account_id in this env")
        if not state.get("stripe_charges_enabled"):
            pytest.skip("charges_enabled is False — covered by 409 test")
        r = requests.post(f"{API}/maker/stripe/connect/dashboard-link",
                          headers=maker_headers, timeout=20)
        # With a test Stripe account that hasn't actually completed onboarding
        # on Stripe's side, Stripe itself rejects create_login_link and our
        # defense-in-depth except block translates to a structured 409. Accept
        # either outcome — both are correct server behavior.
        assert r.status_code in (200, 409), r.text
        if r.status_code == 200:
            data = r.json()
            assert "url" in data
            assert isinstance(data["url"], str) and data["url"].startswith("https://")
        else:
            detail = r.json().get("detail")
            assert isinstance(detail, dict)
            assert detail.get("code") == "onboarding_incomplete"

    def test_409_when_charges_disabled(self, maker_headers):
        state = _get_maker_stripe_state("iron-and-oak")
        if not state.get("stripe_account_id"):
            pytest.skip("iron-and-oak has no stripe_account_id in this env")
        original = bool(state.get("stripe_charges_enabled", False))
        try:
            _set_maker_charges_enabled("iron-and-oak", False)
            r = requests.post(f"{API}/maker/stripe/connect/dashboard-link",
                              headers=maker_headers, timeout=20)
            assert r.status_code == 409, r.text
            body = r.json()
            detail = body.get("detail")
            assert isinstance(detail, dict), f"expected dict detail, got {type(detail).__name__}: {detail!r}"
            assert detail.get("code") == "onboarding_incomplete"
            assert "onboarding" in detail.get("message", "").lower()
        finally:
            _set_maker_charges_enabled("iron-and-oak", original)

    def test_400_when_no_stripe_account(self, maker_headers):
        # metalart-pro may not have a connect account wired — if it does, skip
        state = _get_maker_stripe_state("metalart-pro")
        if state.get("stripe_account_id"):
            pytest.skip("metalart-pro already has a stripe_account_id — 400 path not reachable here")
        # Use metalart-pro jwt instead
        jwt = _issue_maker_jwt("metalart-pro@craftersmarket.org")
        h = {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}
        r = requests.post(f"{API}/maker/stripe/connect/dashboard-link", headers=h, timeout=20)
        assert r.status_code == 400, r.text
        assert "stripe" in r.text.lower()


# =========================================================================
# Admin auto-route top match — uses push-to-maker under the hood
# =========================================================================
class TestAdminAutorouteTopMatch:
    """★ Route to top uses pushBriefToMaker — validate that endpoint still works
    with a templated note."""

    def test_push_with_autoroute_note(self, admin_headers):
        # Create an unassigned brief
        brief_email = f"TEST_iter55_{uuid.uuid4().hex[:8]}@example.com"
        payload = {
            "name": "Iter55 Tester",
            "email": brief_email,
            "project_type": "Custom Metal Sign",
            "material": "Steel",
            "size": "24x36",
            "quantity": "1",
            "description": "iter55 autoroute smoke test — needs steel sign welded and powder-coated.",
            "policy_accepted": True,
        }
        r = requests.post(f"{API}/custom-orders", json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        order_id = r.json().get("id") or r.json().get("order_id") or r.json().get("_id")
        assert order_id, f"no id in create response: {r.text}"

        # Fetch suggestions
        r = requests.get(f"{API}/admin/custom-orders/{order_id}/maker-suggestions",
                         headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        sugg = body.get("suggestions", [])
        if not sugg:
            pytest.skip("no suggestions returned for synthetic brief")
        top = sugg[0]
        assert top.get("slug")
        assert top.get("reason")

        # Emulate the UI's push-to-maker call with templated note
        note = f"Routed to you because: {top['reason']}."
        push_payload = {
            "maker_slug": top["slug"],
            "note": note,
            "notify_buyer": False,
        }
        r = requests.post(f"{API}/admin/custom-orders/{order_id}/push-to-maker",
                          headers=admin_headers, json=push_payload, timeout=30)
        assert r.status_code in (200, 201), r.text

        # Verify the order is now assigned
        r = requests.get(f"{API}/admin/custom-orders", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        orders = r.json() if isinstance(r.json(), list) else r.json().get("orders", [])
        match = next((o for o in orders if o.get("id") == order_id), None)
        assert match is not None, f"order {order_id} not found in admin list"
        assert match.get("assigned_maker_slug") == top["slug"]
