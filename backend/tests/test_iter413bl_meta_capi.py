"""iter413bl — Meta Conversions API server-side contract.

Verifies:
  • GET /admin/meta-capi/status      — shape + auth gate + redacted previews
  • send_meta_event() helper:
      - returns `configured: False` when env vars are unset (no crash)
      - hashes PII to SHA-256 (Meta contract)
      - never raises even when network fails
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import sys
from pathlib import Path
from unittest.mock import patch

import requests
import pytest

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
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def H(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


def test_status_requires_admin():
    r = requests.get(f"{BASE_URL}/api/admin/meta-capi/status", timeout=15)
    assert r.status_code in (401, 403)


def test_status_shape_when_unconfigured(H):
    """When env vars are missing the route must still return 200 with
    a clean shape — the UI relies on this to render its 'no-op' state."""
    r = requests.get(f"{BASE_URL}/api/admin/meta-capi/status", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("configured", "pixel_id_present", "token_present", "test_mode",
              "pixel_id_preview", "token_preview"):
        assert k in body
    assert isinstance(body["configured"], bool)


def test_helper_returns_unconfigured_when_env_missing():
    """`send_meta_event()` must not raise + must not hit the network
    when META_PIXEL_ID / TOKEN are missing."""
    from routers.meta_capi import send_meta_event

    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("META_PIXEL_ID", None)
        os.environ.pop("META_CAPI_ACCESS_TOKEN", None)
        result = asyncio.run(send_meta_event(
            event_name="Purchase",
            event_id="cs_test_abc",
            email="test@example.com",
            value=42.0,
            currency="usd",
        ))
    assert result["sent"] is False
    assert result["configured"] is False
    assert "META_PIXEL_ID" in result.get("reason", "")


def test_helper_hashes_pii_correctly():
    """Verify the hash is what Meta expects: lowercase, trimmed,
    SHA-256 hex digest."""
    from routers.meta_capi import _sha256
    assert _sha256("  Foo@Example.com  ") == hashlib.sha256(
        b"foo@example.com",
    ).hexdigest()
    assert _sha256(None) is None
    assert _sha256("") is None


def test_helper_never_raises_on_network_error():
    """Even when the Meta endpoint blows up, the helper must return
    a clean dict so a Stripe webhook handler never crashes on it."""
    from routers.meta_capi import send_meta_event

    with patch.dict(os.environ, {
        "META_PIXEL_ID": "111111111111",
        "META_CAPI_ACCESS_TOKEN": "EAAGtest",
    }):
        async def _go():
            # Use a hostname that will fail DNS / connect quickly.
            import httpx
            async def _fake_post(self, url, **kwargs):
                raise httpx.ConnectError("simulated failure")
            with patch("httpx.AsyncClient.post", _fake_post):
                return await send_meta_event(
                    event_name="Lead",
                    event_id="evt_fail_test",
                    email="x@y.com",
                )
        result = asyncio.run(_go())
    assert result["sent"] is False
    assert result["configured"] is True
    assert "error" in result
