"""iter413ck — Extra contract checks per review request.

Validates aspects beyond the original test file:
  • status returns enabled=true, oauth_configured=true
  • status without auth returns 401/403 (security)
  • oauth-start authorization_url embeds client_id with correct prefix + state param
  • oauth-start populates _oauth_state with (timestamp, redirect_uri) tuple
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")

EXPECTED_HOST = urlparse(BASE_URL).netloc


@pytest.fixture(scope="module")
def admin_jwt():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("williams342@gmail.com")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def test_status_enabled_and_oauth_configured(admin_jwt):
    r = requests.get(
        f"{BASE_URL}/api/admin/gsc/status",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("enabled") is True, body
    assert body.get("oauth_configured") is True, body
    # Regression check: must NOT default to craftersmarket.org on preview.
    assert "craftersmarket.org" not in body["redirect_uri"], body
    assert EXPECTED_HOST in body["redirect_uri"], body


def test_status_requires_auth():
    r = requests.get(f"{BASE_URL}/api/admin/gsc/status", timeout=15)
    assert r.status_code in (401, 403), (r.status_code, r.text)


def test_oauth_start_url_has_required_params(admin_jwt):
    r = requests.get(
        f"{BASE_URL}/api/admin/gsc/oauth-start",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    auth_url = r.json()["authorization_url"]
    parsed = urlparse(auth_url)
    assert parsed.netloc == "accounts.google.com"
    assert parsed.path == "/o/oauth2/v2/auth"
    qs = parse_qs(parsed.query)
    # client_id
    assert "client_id" in qs and qs["client_id"][0].startswith(
        "239405833611-lpcmj47ufbela6s5o6dgjfcgnap3s4o0"
    ), qs.get("client_id")
    # state present
    assert "state" in qs and len(qs["state"][0]) > 0
    # redirect_uri preview host
    assert EXPECTED_HOST in qs["redirect_uri"][0]
    assert qs["redirect_uri"][0].endswith("/api/admin/gsc/oauth-callback")
    # access_type=offline + prompt=consent for refresh token
    assert qs.get("access_type", [""])[0] == "offline"
    assert qs.get("prompt", [""])[0] == "consent"


def test_oauth_start_state_dict_binds_redirect_uri():
    """In-process verification: calling gsc_oauth_start populates
    _oauth_state with a tuple of (timestamp, redirect_uri) so the
    callback can re-use the exact URI Google saw."""
    from fastapi.testclient import TestClient
    from server import app
    from routers import gsc_admin
    from maker_auth import issue_admin_magic_token

    # Mint a JWT directly (skip the /verify round-trip) via the same
    # verify endpoint locally — keeps cookie/header expectations intact.
    client = TestClient(app)
    tok = issue_admin_magic_token("williams342@gmail.com")
    r = client.post("/api/admin/auth/verify", json={"token": tok})
    r.raise_for_status()
    jwt = r.json()["token"]

    before_keys = set(gsc_admin._oauth_state.keys())
    r = client.get(
        "/api/admin/gsc/oauth-start",
        headers={
            "Authorization": f"Bearer {jwt}",
            "x-forwarded-host": "active-project-4.preview.emergentagent.com",
            "x-forwarded-proto": "https",
        },
    )
    assert r.status_code == 200, r.text
    auth_url = r.json()["authorization_url"]
    state_param = parse_qs(urlparse(auth_url).query)["state"][0]

    assert state_param in gsc_admin._oauth_state, (
        state_param, list(gsc_admin._oauth_state.keys()),
    )
    entry = gsc_admin._oauth_state[state_param]
    assert isinstance(entry, tuple) and len(entry) == 2, entry
    ts, bound_uri = entry
    assert isinstance(ts, float) and ts <= time.time() + 1, entry
    assert bound_uri.endswith("/api/admin/gsc/oauth-callback"), bound_uri
    assert "active-project-4.preview.emergentagent.com" in bound_uri, bound_uri
    assert state_param not in before_keys
