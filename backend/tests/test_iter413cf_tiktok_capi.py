"""iter413cf — TikTok Events API 2.0 server-side contract.

Verifies:
  • GET /admin/tiktok-capi/status      — shape + auth gate + redacted previews
  • send_tiktok_event() helper:
      - returns `configured: False` when env vars are unset (no crash)
      - hashes PII to SHA-256 (TikTok contract)
      - maps internal action names → TikTok standard events
      - sends `event_id` for dedup with the browser pixel
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
    r = requests.get(f"{BASE_URL}/api/admin/tiktok-capi/status", timeout=15)
    assert r.status_code in (401, 403)


def test_status_shape(H):
    r = requests.get(f"{BASE_URL}/api/admin/tiktok-capi/status", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("configured", "pixel_id_present", "token_present", "test_mode",
              "pixel_id_preview", "token_preview"):
        assert k in body
    assert isinstance(body["configured"], bool)


def test_helper_returns_unconfigured_when_env_missing():
    from routers.tiktok_capi import send_tiktok_event
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("TIKTOK_PIXEL_ID", None)
        os.environ.pop("TIKTOK_CAPI_ACCESS_TOKEN", None)
        result = asyncio.run(send_tiktok_event(
            event_name="purchase",
            event_id="cs_test_abc",
            email="test@example.com",
            value=42.0,
            currency="usd",
        ))
    assert result["sent"] is False
    assert result["configured"] is False
    assert "TIKTOK_PIXEL_ID" in result.get("reason", "")


def test_helper_hashes_pii_correctly():
    from routers.tiktok_capi import _sha256
    assert _sha256("  Foo@Example.com  ") == hashlib.sha256(
        b"foo@example.com",
    ).hexdigest()
    assert _sha256(None) is None
    assert _sha256("") is None


def test_helper_maps_action_to_tiktok_event_and_payload_shape():
    """Verify the helper builds a valid TikTok payload and maps internal
    action keys to TikTok standard events. We mock httpx.AsyncClient.post
    to capture the outgoing body without hitting the network."""
    from routers.tiktok_capi import send_tiktok_event

    captured: dict = {}

    class _Resp:
        status_code = 200
        headers = {"content-type": "application/json"}
        text = '{"code":0,"message":"OK"}'
        def json(self):
            return {"code": 0, "message": "OK"}

    async def _fake_post(self, url, json=None, headers=None, **kwargs):
        captured["url"] = url
        captured["body"] = json
        captured["headers"] = headers
        return _Resp()

    with patch.dict(os.environ, {
        "TIKTOK_PIXEL_ID": "D8UP6SJC77UCR7H8US60",
        "TIKTOK_CAPI_ACCESS_TOKEN": "tt_test_token",
    }), patch("httpx.AsyncClient.post", _fake_post):
        result = asyncio.run(send_tiktok_event(
            event_name="purchase",
            event_id="cs_stripe_session_xyz",
            email="Buyer@Example.com",
            value=89.50,
            currency="usd",
            content_id="iron-and-oak-bench",
        ))

    assert result["sent"] is True
    assert result["dedup_id"] == "cs_stripe_session_xyz"
    assert result["tiktok_event"] == "CompletePayment"

    body = captured["body"]
    assert body["event_source"] == "web"
    assert body["event_source_id"] == "D8UP6SJC77UCR7H8US60"
    row = body["data"][0]
    assert row["event"] == "CompletePayment"
    assert row["event_id"] == "cs_stripe_session_xyz"
    # PII hashed:
    expected_email_hash = hashlib.sha256(b"buyer@example.com").hexdigest()
    assert row["user"]["email"] == expected_email_hash
    # Properties:
    assert row["properties"]["value"] == 89.50
    assert row["properties"]["currency"] == "USD"
    assert row["properties"]["content_id"] == "iron-and-oak-bench"
    assert row["properties"]["content_type"] == "product"
    # Auth header carries access token (not URL):
    assert captured["headers"]["Access-Token"] == "tt_test_token"


def test_helper_never_raises_on_network_error():
    from routers.tiktok_capi import send_tiktok_event
    with patch.dict(os.environ, {
        "TIKTOK_PIXEL_ID": "D8UP6SJC77UCR7H8US60",
        "TIKTOK_CAPI_ACCESS_TOKEN": "tt_test_token",
    }):
        async def _go():
            import httpx
            async def _fake_post(self, url, **kwargs):
                raise httpx.ConnectError("simulated failure")
            with patch("httpx.AsyncClient.post", _fake_post):
                return await send_tiktok_event(
                    event_name="signup_maker",
                    event_id="app_evt_test",
                    email="m@example.com",
                )
        result = asyncio.run(_go())
    assert result["sent"] is False
    assert result["configured"] is True
    assert "error" in result


def test_internal_action_map_covers_all_documented_events():
    """The browser pixel and server CAPI MUST share the same taxonomy
    of internal action keys. Drift here = drift in dedup."""
    from routers.tiktok_capi import _TIKTOK_EVENT_MAP
    required = {"purchase", "add_to_cart", "signup_buyer", "signup_maker",
                "lead_custom_order", "lead_contact"}
    assert required.issubset(set(_TIKTOK_EVENT_MAP.keys()))
    assert _TIKTOK_EVENT_MAP["purchase"] == "CompletePayment"
    assert _TIKTOK_EVENT_MAP["add_to_cart"] == "AddToCart"
    assert _TIKTOK_EVENT_MAP["signup_buyer"] == "CompleteRegistration"
    assert _TIKTOK_EVENT_MAP["signup_maker"] == "CompleteRegistration"
    assert _TIKTOK_EVENT_MAP["lead_custom_order"] == "SubmitForm"
    assert _TIKTOK_EVENT_MAP["lead_contact"] == "Contact"
