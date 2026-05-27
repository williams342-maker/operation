"""Regression: Telnyx SMS service + webhook (iter265)."""
import base64
import os
import time

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from core import db
from sms_service import (
    TelnyxSignatureError,
    e164_normalize,
    is_configured,
    verify_telnyx_signature,
)


with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


# ─────────── E.164 normalizer ───────────
@pytest.mark.parametrize("raw,expected", [
    ("5551234567", "+15551234567"),       # bare 10-digit US
    ("15551234567", "+15551234567"),      # 11-digit with leading 1
    ("(555) 123-4567", "+15551234567"),   # formatted US
    ("+447911123456", "+447911123456"),   # E.164 UK passthrough
    ("", None),
    ("abc", None),
    ("123", None),                        # too short
])
def test_e164_normalize(raw, expected):
    assert e164_normalize(raw) == expected


def test_is_configured_false_without_env(monkeypatch):
    monkeypatch.delenv("TELNYX_API_KEY", raising=False)
    monkeypatch.delenv("TELNYX_MESSAGING_PROFILE_ID", raising=False)
    assert is_configured() is False


# ─────────── Ed25519 signature verification ───────────
def _setup_keys(monkeypatch) -> Ed25519PrivateKey:
    """Generate a throwaway Ed25519 key, register its public part in
    the env var the verifier reads."""
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key()
    from cryptography.hazmat.primitives import serialization
    pub_raw = pub.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    monkeypatch.setenv("TELNYX_PUBLIC_KEY", base64.b64encode(pub_raw).decode())
    return priv


def _sign(priv: Ed25519PrivateKey, body: bytes, ts: str) -> str:
    return base64.b64encode(priv.sign(f"{ts}|".encode() + body)).decode()


def test_signature_verifies_with_valid_keypair(monkeypatch):
    priv = _setup_keys(monkeypatch)
    body = b'{"data":{"event_type":"message.received"}}'
    ts = str(int(time.time()))
    sig = _sign(priv, body, ts)
    verify_telnyx_signature(body, sig, ts)  # must not raise


def test_signature_rejects_stale_timestamp(monkeypatch):
    priv = _setup_keys(monkeypatch)
    body = b"{}"
    old_ts = str(int(time.time()) - 9999)
    sig = _sign(priv, body, old_ts)
    with pytest.raises(TelnyxSignatureError, match="tolerance"):
        verify_telnyx_signature(body, sig, old_ts)


def test_signature_rejects_tampered_body(monkeypatch):
    priv = _setup_keys(monkeypatch)
    ts = str(int(time.time()))
    sig = _sign(priv, b'{"a":1}', ts)
    with pytest.raises(TelnyxSignatureError, match="(Invalid signature|verification)"):
        verify_telnyx_signature(b'{"a":2}', sig, ts)


def test_signature_rejects_missing_headers(monkeypatch):
    _setup_keys(monkeypatch)
    with pytest.raises(TelnyxSignatureError, match="(Missing|headers)"):
        verify_telnyx_signature(b"{}", None, None)


# ─────────── Webhook + admin endpoints reachable ───────────
@pytest.mark.asyncio
async def test_webhook_endpoints_exist_and_reject_bad_signature():
    """Webhook URLs must return 403 (not 404) when a bad signature is
    sent. Confirms the routes are wired."""
    async with httpx.AsyncClient(timeout=10) as c:
        # Without TELNYX_PUBLIC_KEY env, verifier returns 403 with
        # "not configured". Either way, NOT 404.
        for url in ("/api/sms/webhook", "/api/sms/webhook/failover"):
            r = await c.post(f"{API}{url}", content=b"{}", headers={
                "telnyx-signature-ed25519": "fake", "telnyx-timestamp": str(int(time.time())),
            })
            assert r.status_code in (403, 400), f"{url} → {r.status_code} {r.text[:200]}"


@pytest.mark.asyncio
async def test_admin_endpoints_require_auth():
    async with httpx.AsyncClient(timeout=10) as c:
        r1 = await c.get(f"{API}/api/admin/sms/diag")
        r2 = await c.post(f"{API}/api/admin/sms/test-send", json={"to": "+15551234567", "body": "x"})
    assert r1.status_code == 401
    assert r2.status_code == 401


# ─────────── STOP keyword opt-out flow ───────────
@pytest.mark.asyncio
async def test_stop_keyword_records_optout():
    """Crafted webhook payload routed through _process_event inserts
    into sms_optouts. (We test the dispatcher directly instead of going
    over HTTP so we don't need to inject env vars into the live
    backend service.)"""
    from routers.sms import _process_event

    test_phone = "+15550009999"
    await db.sms_optouts.delete_one({"phone": test_phone})
    await db.sms_webhook_events.delete_many({"id": "test-evt-stop-001"})

    await _process_event({
        "data": {
            "event_type": "message.received",
            "id": "test-evt-stop-001",
            "payload": {
                "from": {"phone_number": test_phone},
                "text": "STOP",
            },
        },
    })

    optout = await db.sms_optouts.find_one({"phone": test_phone}, {"_id": 0, "phone": 1, "source": 1})
    assert optout is not None
    assert "keyword" in (optout.get("source") or "")
    # cleanup
    await db.sms_optouts.delete_one({"phone": test_phone})
    await db.sms_webhook_events.delete_many({"id": "test-evt-stop-001"})


@pytest.mark.asyncio
async def test_start_keyword_clears_optout():
    from routers.sms import _process_event

    test_phone = "+15550008888"
    await db.sms_optouts.insert_one({"phone": test_phone, "source": "manual"})
    await db.sms_webhook_events.delete_many({"id": "test-evt-start-001"})

    await _process_event({
        "data": {
            "event_type": "message.received",
            "id": "test-evt-start-001",
            "payload": {
                "from": {"phone_number": test_phone},
                "text": "START",
            },
        },
    })

    optout = await db.sms_optouts.find_one({"phone": test_phone})
    assert optout is None  # opt-out should have been cleared
    await db.sms_webhook_events.delete_many({"id": "test-evt-start-001"})
