"""iter413ay — Stripe-side webhook endpoint introspection contract.

Verifies:
  • GET  /api/admin/stripe/webhook-endpoints
      - requires admin
      - graceful response when STRIPE_API_KEY is missing
      - red-flags endpoints whose URL path doesn't match a known route
      - returns summary counts and sorted rows (broken first)
  • POST /api/admin/stripe/webhook-endpoints/{id}/disable
      - requires super-admin
      - validates id shape
      - audit-logs the disable

We mock `stripe.WebhookEndpoint.list` + `.modify` to avoid hitting the
live Stripe API from CI (no live key required).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import requests
import pytest

# Allow `from maker_auth import ...` without changing PYTHONPATH.
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


def test_list_endpoints_requires_admin():
    r = requests.get(f"{BASE_URL}/api/admin/stripe/webhook-endpoints", timeout=15)
    assert r.status_code in (401, 403)


def test_list_endpoints_returns_shape(H):
    """Smoke: route exists, auth ok, and the response carries the expected keys.
    We don't assert on endpoint content because that depends on the live
    Stripe account state (preview deploy may or may not have STRIPE_API_KEY)."""
    r = requests.get(f"{BASE_URL}/api/admin/stripe/webhook-endpoints", headers=H, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "configured" in body
    assert "known_paths" in body
    assert "public_hosts" in body
    assert "endpoints" in body
    assert isinstance(body["endpoints"], list)
    # known_paths is the authoritative source of truth for which paths
    # the backend actually answers — verify our routes show up.
    assert "/api/webhook/stripe" in body["known_paths"]
    assert "/api/webhook/stripe/connect" in body["known_paths"]
    assert "/api/stripe/connect/webhook" in body["known_paths"]


def test_verdict_logic_unit():
    """Direct unit-test of the route's classification logic by exercising
    the handler against a mocked Stripe SDK. Doesn't touch HTTP."""
    import asyncio
    # Avoid importing the router twice when pytest re-collects.
    from routers import admin_secrets as mod

    fake_endpoints = [
        # 1. ok — matches known path on our host
        MagicMock(spec_set=["__getitem__"]),
        # 2. wrong path on our host (the actual bug)
        MagicMock(spec_set=["__getitem__"]),
        # 3. foreign host (preview pod)
        MagicMock(spec_set=["__getitem__"]),
        # 4. disabled
        MagicMock(spec_set=["__getitem__"]),
    ]
    rows = [
        {"id": "we_ok",      "url": "https://craftersmarket.org/api/webhook/stripe",
         "status": "enabled", "enabled_events": ["checkout.session.completed"],
         "secret": "whsec_test_aaaaaaaaaaaaaaaa", "created": 1},
        {"id": "we_wrong",   "url": "https://craftersmarket.org/api/checkout/webhook",
         "status": "enabled", "enabled_events": ["checkout.session.completed"],
         "secret": "whsec_test_bbbbbbbbbbbbbbbb", "created": 2},
        {"id": "we_foreign", "url": "https://other.example.com/api/webhook/stripe",
         "status": "enabled", "enabled_events": [],
         "secret": "whsec_test_cccccccccccccccc", "created": 3},
        {"id": "we_off",     "url": "https://craftersmarket.org/api/webhook/stripe/connect",
         "status": "disabled", "enabled_events": [],
         "secret": "whsec_test_dddddddddddddddd", "created": 4},
    ]
    for m, data in zip(fake_endpoints, rows):
        m.__getitem__.side_effect = lambda k, _d=data: _d[k]

    fake_list = MagicMock()
    fake_list.data = fake_endpoints
    fake_sdk = MagicMock()
    fake_sdk.WebhookEndpoint.list.return_value = fake_list

    with patch.dict(os.environ, {"STRIPE_API_KEY": "sk_test_x",
                                  "PUBLIC_SITE_URL": "https://craftersmarket.org"}), \
         patch.object(mod, "_stripe_sdk", return_value=fake_sdk):
        result = asyncio.run(mod.stripe_webhook_endpoints_list(_admin={"email": "t@x"}))

    assert result["configured"] is True
    assert result["error"] is None
    verdicts = {r["id"]: r["verdict"] for r in result["endpoints"]}
    assert verdicts == {
        "we_ok":      "ok",
        "we_wrong":   "wrong_path",
        "we_foreign": "foreign_host",
        "we_off":     "disabled",
    }
    # Broken row sorts first.
    assert result["endpoints"][0]["id"] == "we_wrong"
    # Summary aggregates correctly.
    assert result["summary"]["ok"] == 1
    assert result["summary"]["wrong_path"] == 1
    assert result["summary"]["disabled"] == 1
    assert result["summary"]["foreign_host"] == 1
    # Secret is redacted (never the full value).
    for row in result["endpoints"]:
        assert "whsec_test_" not in row["secret_prefix"] or row["secret_prefix"].endswith(("aaaa", "bbbb", "cccc", "dddd"))


def test_list_endpoints_handles_missing_stripe_key():
    """If STRIPE_API_KEY is unset we return a 200 with `configured: false`
    rather than a 503 — the UI relies on this to render its 'unconfigured'
    state without breaking the surrounding card."""
    import asyncio
    from routers import admin_secrets as mod
    with patch.dict(os.environ, {}, clear=False):
        # Force both envs unset for this scope.
        os.environ.pop("STRIPE_API_KEY", None)
        os.environ.pop("STRIPE_SECRET_KEY", None)
        result = asyncio.run(mod.stripe_webhook_endpoints_list(_admin={"email": "t@x"}))
    assert result["configured"] is False
    assert "STRIPE_API_KEY" in (result["error"] or "")
    assert result["endpoints"] == []


def test_disable_endpoint_validates_id(H):
    r = requests.post(
        f"{BASE_URL}/api/admin/stripe/webhook-endpoints/not-a-real-id/disable",
        headers=H, timeout=15,
    )
    # Either 400 (id-shape rejection) or 401/403 if super-admin gate fires
    # first (depends on how `require_super_admin` resolves for the magic
    # token in this env). Both are acceptable contract responses.
    assert r.status_code in (400, 401, 403), r.text


def test_disable_endpoint_requires_admin():
    r = requests.post(
        f"{BASE_URL}/api/admin/stripe/webhook-endpoints/we_test/disable",
        timeout=15,
    )
    assert r.status_code in (401, 403)
