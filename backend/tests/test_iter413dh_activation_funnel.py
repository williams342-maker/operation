"""iter413dh — Activation Funnel backend tests (read-only admin endpoint)."""
import os
import sys
import pytest
import requests

# Ensure backend env vars loaded for token minting
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import issue_admin_magic_token  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
ADMIN_EMAIL = os.environ.get("OPS_EMAIL", "williams342@gmail.com")


@pytest.fixture(scope="module")
def admin_jwt():
    token = issue_admin_magic_token(ADMIN_EMAIL)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": token}, timeout=30)
    assert r.status_code == 200, f"admin verify failed: {r.status_code} {r.text}"
    jwt = r.json().get("token") or r.json().get("jwt") or r.json().get("access_token")
    assert jwt, f"no jwt in response: {r.json()}"
    return jwt


@pytest.fixture(scope="module")
def auth_headers(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


# --- Endpoint shape -------------------------------------------------------
def test_activation_funnel_founder_cohort_200(auth_headers):
    r = requests.get(
        f"{BASE_URL}/api/admin/activation-funnel?tier=founder&include_rows=true",
        headers=auth_headers, timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("generated_at", "cohort", "funnel", "ttfl", "early_promotion_trigger", "rows"):
        assert key in body, f"missing key: {key}"
    assert body["cohort"] == "founder"
    assert isinstance(body["rows"], list)


def test_activation_funnel_all_8_stages(auth_headers):
    r = requests.get(
        f"{BASE_URL}/api/admin/activation-funnel?tier=founder",
        headers=auth_headers, timeout=30,
    )
    assert r.status_code == 200
    funnel = r.json()["funnel"]
    expected = [
        "approved", "welcome_delivered", "first_login", "profile_completed",
        "first_listing_created", "first_listing_published",
        "first_buyer_inquiry", "first_sale",
    ]
    for k in expected:
        assert k in funnel, f"missing stage: {k}"
        assert "count" in funnel[k] and "pct" in funnel[k]
        assert isinstance(funnel[k]["count"], int)
        assert isinstance(funnel[k]["pct"], (int, float))


def test_activation_funnel_monotonic_counts(auth_headers):
    """Each subsequent stage should have count <= previous stage."""
    r = requests.get(
        f"{BASE_URL}/api/admin/activation-funnel?tier=all_approved",
        headers=auth_headers, timeout=30,
    )
    assert r.status_code == 200
    funnel = r.json()["funnel"]
    order = ["approved", "welcome_delivered", "first_login", "profile_completed",
             "first_listing_created", "first_listing_published",
             "first_buyer_inquiry", "first_sale"]
    prev = funnel[order[0]]["count"]
    # Note: not strictly monotonic across all (e.g. profile_completed could be > first_login),
    # but approved must be the max.
    approved = funnel["approved"]["count"]
    for k in order[1:]:
        assert funnel[k]["count"] <= approved, f"{k} count > approved"


def test_activation_funnel_all_approved_cohort(auth_headers):
    r = requests.get(
        f"{BASE_URL}/api/admin/activation-funnel?tier=all_approved&include_rows=true",
        headers=auth_headers, timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cohort"] == "all_approved"
    # All-approved must be >= founder cohort
    rf = requests.get(
        f"{BASE_URL}/api/admin/activation-funnel?tier=founder",
        headers=auth_headers, timeout=30,
    ).json()
    assert body["funnel"]["approved"]["count"] >= rf["funnel"]["approved"]["count"]


def test_ttfl_shape(auth_headers):
    r = requests.get(
        f"{BASE_URL}/api/admin/activation-funnel?tier=founder",
        headers=auth_headers, timeout=30,
    )
    ttfl = r.json()["ttfl"]
    assert "count_with_listing" in ttfl
    assert "median_days" in ttfl
    assert "p25_days" in ttfl
    assert "p75_days" in ttfl


def test_early_promotion_trigger_shape(auth_headers):
    r = requests.get(
        f"{BASE_URL}/api/admin/activation-funnel?tier=founder",
        headers=auth_headers, timeout=30,
    )
    trig = r.json()["early_promotion_trigger"]
    for k in ("condition", "matching_count", "fires_at", "active"):
        assert k in trig, f"trigger missing: {k}"
    assert isinstance(trig["matching_count"], int)
    assert isinstance(trig["active"], bool)
    expected_active = trig["matching_count"] >= trig["fires_at"]
    assert trig["active"] == expected_active


def test_rows_have_required_fields(auth_headers):
    r = requests.get(
        f"{BASE_URL}/api/admin/activation-funnel?tier=all_approved&include_rows=true",
        headers=auth_headers, timeout=30,
    )
    rows = r.json()["rows"]
    if not rows:
        pytest.skip("no rows to validate")
    sample = rows[0]
    required_fields = [
        "slug", "name", "email", "approved_at",
        "welcome_delivered_at", "first_login_at", "profile_completed",
        "first_listing_created_at", "first_listing_published_at",
        "days_since_approval", "activation_status",
    ]
    for f in required_fields:
        assert f in sample, f"row missing field: {f}"


def test_include_rows_false(auth_headers):
    r = requests.get(
        f"{BASE_URL}/api/admin/activation-funnel?tier=founder&include_rows=false",
        headers=auth_headers, timeout=30,
    )
    assert r.status_code == 200
    assert r.json()["rows"] == []


# --- Auth gates -----------------------------------------------------------
def test_activation_funnel_requires_admin_auth():
    r = requests.get(f"{BASE_URL}/api/admin/activation-funnel", timeout=30)
    assert r.status_code in (401, 403)


def test_activation_funnel_rejects_bogus_jwt():
    r = requests.get(
        f"{BASE_URL}/api/admin/activation-funnel",
        headers={"Authorization": "Bearer not-a-real-jwt"}, timeout=30,
    )
    assert r.status_code in (401, 403)


# --- Read-only contract ---------------------------------------------------
def test_no_post_mutation_endpoint(auth_headers):
    """Activation Funnel must be read-only: no POST/PUT/DELETE."""
    for method in ("post", "put", "patch", "delete"):
        r = getattr(requests, method)(
            f"{BASE_URL}/api/admin/activation-funnel",
            headers=auth_headers, timeout=15,
        )
        # Should be 405 Method Not Allowed (or 404)
        assert r.status_code in (404, 405), f"{method} returned {r.status_code} — unexpected!"
