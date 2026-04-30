"""Iter57 — Backend test for GET /api/maker/briefs/{briefId} (single-brief fetch).

Verifies:
  - Auth gate (401/403 without maker JWT)
  - Cross-maker isolation (404 if assigned_maker_slug != caller)
  - 404 for unknown briefId
  - 200 + payload contains tracking_number, project_type, status
"""
import os
import sys
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# Sample assigned brief from the request (won_bid · iron-and-oak)
ASSIGNED_BRIEF_ID = "be5845d6-60f8-46da-a740-a3c004bc860b"
UNKNOWN_BRIEF_ID = "00000000-0000-0000-0000-000000000000"


def _maker_jwt(slug_email: str = "iron-and-oak@craftersmarket.org") -> str:
    """Mint a maker JWT directly via maker_auth (avoids email magic-link)."""
    sys.path.insert(0, "/app/backend")
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_magic_token  # type: ignore
    token = issue_magic_token(slug_email)
    r = requests.post(f"{API}/maker/auth/verify", json={"token": token}, timeout=15)
    assert r.status_code == 200, f"verify failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def iron_jwt() -> str:
    return _maker_jwt("iron-and-oak@craftersmarket.org")


@pytest.fixture(scope="module")
def metalart_jwt() -> str:
    return _maker_jwt("metalart-pro@craftersmarket.org")


# ---------- auth gate ----------
def test_no_auth_returns_401_or_403():
    r = requests.get(f"{API}/maker/briefs/{ASSIGNED_BRIEF_ID}", timeout=10)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


# ---------- happy path ----------
def test_get_assigned_brief_returns_200(iron_jwt):
    r = requests.get(
        f"{API}/maker/briefs/{ASSIGNED_BRIEF_ID}",
        headers={"Authorization": f"Bearer {iron_jwt}"}, timeout=15,
    )
    assert r.status_code == 200, f"expected 200, got {r.status_code} {r.text}"
    data = r.json()
    # Required fields
    assert data.get("project_type"), "missing project_type"
    assert data.get("tracking_number"), "missing tracking_number"
    assert str(data["tracking_number"]).isdigit() and len(str(data["tracking_number"])) == 10
    assert data.get("id") == ASSIGNED_BRIEF_ID
    # Spec mentioned tracking 2656469497 specifically
    assert str(data["tracking_number"]) == "2656469497", \
        f"expected tracking 2656469497, got {data['tracking_number']}"


def test_get_assigned_brief_status_is_won_bid(iron_jwt):
    r = requests.get(
        f"{API}/maker/briefs/{ASSIGNED_BRIEF_ID}",
        headers={"Authorization": f"Bearer {iron_jwt}"}, timeout=15,
    )
    assert r.status_code == 200
    data = r.json()
    # Per request: status=won_bid (maker_response_status)
    assert data.get("maker_response_status") == "won_bid" or data.get("status") == "won_bid"


# ---------- unknown brief ----------
def test_unknown_brief_returns_404(iron_jwt):
    r = requests.get(
        f"{API}/maker/briefs/{UNKNOWN_BRIEF_ID}",
        headers={"Authorization": f"Bearer {iron_jwt}"}, timeout=10,
    )
    assert r.status_code == 404, f"expected 404, got {r.status_code}"
    detail = r.json().get("detail", "")
    assert "not found" in detail.lower() or "not assigned" in detail.lower(), \
        f"unexpected detail: {detail}"


# ---------- cross-maker isolation ----------
def test_other_maker_cannot_fetch_brief(metalart_jwt):
    """metalart-pro should get 404 (not 200) when fetching iron-and-oak's brief."""
    r = requests.get(
        f"{API}/maker/briefs/{ASSIGNED_BRIEF_ID}",
        headers={"Authorization": f"Bearer {metalart_jwt}"}, timeout=10,
    )
    assert r.status_code == 404, \
        f"cross-maker leak! expected 404, got {r.status_code} {r.text}"


# ---------- regression: list endpoint still works ----------
def test_briefs_list_still_works(iron_jwt):
    r = requests.get(
        f"{API}/maker/briefs",
        headers={"Authorization": f"Bearer {iron_jwt}"}, timeout=15,
    )
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ---------- regression: public /track still works ----------
def test_public_track_still_works():
    r = requests.get(f"{API}/custom-orders/track/2656469497", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data.get("tracking_number") == "2656469497"
    # PII must NOT leak on public endpoint
    for forbidden in ("email", "phone", "description", "admin_note", "buyer_name"):
        assert forbidden not in data, f"PII leak: {forbidden} in public payload"
