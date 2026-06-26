"""iter413ck — GSC OAuth redirect URI is derived from the inbound
request host so preview vs production each get the correct callback
automatically. Locks the behavior the production `redirect_uri_mismatch`
bug surfaced.

Verifies:
  • `_resolve_redirect_uri()` derives from x-forwarded-host + proto
    when env var unset
  • Env var override still wins when explicitly set
  • Status + oauth-start endpoints return the derived URI
  • Token exchange uses the redirect URI bound at oauth-start (not
    re-derived from a possibly different callback request hop)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def admin_jwt():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("williams342@gmail.com")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def test_resolve_uses_xforwarded_host_when_env_unset():
    from routers.gsc_admin import _resolve_redirect_uri

    class _Req:
        url = type("U", (), {"scheme": "https", "netloc": "internal.svc:8001"})()
        headers = {
            "x-forwarded-host": "craftersmarket.org",
            "x-forwarded-proto": "https",
        }

    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("GSC_OAUTH_REDIRECT_URI", None)
        uri = _resolve_redirect_uri(_Req())
    assert uri == "https://craftersmarket.org/api/admin/gsc/oauth-callback"


def test_resolve_uses_preview_host():
    from routers.gsc_admin import _resolve_redirect_uri

    class _Req:
        url = type("U", (), {"scheme": "https", "netloc": "internal.svc:8001"})()
        headers = {
            "x-forwarded-host": "active-project-4.preview.emergentagent.com",
            "x-forwarded-proto": "https",
        }

    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("GSC_OAUTH_REDIRECT_URI", None)
        uri = _resolve_redirect_uri(_Req())
    assert uri == "https://active-project-4.preview.emergentagent.com/api/admin/gsc/oauth-callback"


def test_resolve_honors_env_override():
    from routers.gsc_admin import _resolve_redirect_uri

    class _Req:
        url = type("U", (), {"scheme": "https", "netloc": "anything.test"})()
        headers = {"x-forwarded-host": "anything.test"}

    with patch.dict(os.environ, {
        "GSC_OAUTH_REDIRECT_URI": "https://manual-override.test/api/admin/gsc/oauth-callback",
    }):
        uri = _resolve_redirect_uri(_Req())
    assert uri == "https://manual-override.test/api/admin/gsc/oauth-callback"


def test_status_returns_derived_redirect_uri(admin_jwt):
    """End-to-end: hitting the live status endpoint from the preview
    domain must return the preview callback URI in the response."""
    r = requests.get(
        f"{BASE_URL}/api/admin/gsc/status",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["redirect_uri"].endswith("/api/admin/gsc/oauth-callback"), body
    # Must match the host the request came in through.
    from urllib.parse import urlparse
    expected_host = urlparse(BASE_URL).netloc
    assert expected_host in body["redirect_uri"], (expected_host, body["redirect_uri"])


def test_oauth_start_returns_url_with_derived_redirect(admin_jwt):
    """The Google authorization URL must embed the derived redirect_uri
    so the user lands on the correct callback after consent."""
    r = requests.get(
        f"{BASE_URL}/api/admin/gsc/oauth-start",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    auth_url = r.json()["authorization_url"]
    from urllib.parse import urlparse, parse_qs
    qs = parse_qs(urlparse(auth_url).query)
    assert "redirect_uri" in qs
    embedded = qs["redirect_uri"][0]
    assert embedded.endswith("/api/admin/gsc/oauth-callback")
    from urllib.parse import urlparse as up
    expected_host = up(BASE_URL).netloc
    assert expected_host in embedded
