"""iter436 — PayPal webhook endpoint: verification, dedupe, persistence."""
import os
import uuid

import pytest
import pytest_asyncio

os.environ["PAYPAL_ENVIRONMENT"] = "sandbox"
os.environ["PAYPAL_CLIENT_ID_SANDBOX"] = "test-client-id"
os.environ["PAYPAL_CLIENT_SECRET_SANDBOX"] = "test-client-secret"
os.environ["PAYPAL_WEBHOOK_ID_SANDBOX"] = "test-webhook-id"

from httpx import ASGITransport, AsyncClient  # noqa: E402
from server import app  # noqa: E402
from core import db  # noqa: E402
from routers import paypal_webhooks  # noqa: E402

SIG_HEADERS = {
    "paypal-transmission-id": "t-id",
    "paypal-transmission-time": "2026-07-10T00:00:00Z",
    "paypal-transmission-sig": "sig",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
    "paypal-auth-algo": "SHA256withRSA",
}


def _event(eid=None, etype="PAYMENT.CAPTURE.COMPLETED"):
    return {
        "id": eid or f"WH-TEST-{uuid.uuid4().hex[:12]}",
        "event_type": etype,
        "resource_type": "capture",
        "summary": "Payment completed",
        "create_time": "2026-07-10T00:00:00Z",
        "resource": {"id": f"CAP-{uuid.uuid4().hex[:8]}"},
    }


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def _clean():
    await db.paypal_webhook_events.delete_many({"event_id": {"$regex": "^WH-TEST-"}})
    yield
    await db.paypal_webhook_events.delete_many({"event_id": {"$regex": "^WH-TEST-"}})


@pytest.fixture
def verify_success(monkeypatch):
    async def fake(cfg, headers, event):
        return "SUCCESS"
    monkeypatch.setattr(paypal_webhooks, "_verify_signature", fake)


@pytest.fixture
def verify_failure(monkeypatch):
    async def fake(cfg, headers, event):
        return "FAILURE"
    monkeypatch.setattr(paypal_webhooks, "_verify_signature", fake)


@pytest.mark.asyncio
async def test_invalid_json_rejected(client):
    r = await client.post("/api/webhooks/paypal", content=b"not-json", headers=SIG_HEADERS)
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_missing_signature_headers_rejected(client):
    r = await client.post("/api/webhooks/paypal", json=_event())
    assert r.status_code == 400
    assert "signature headers" in r.json()["error"]


@pytest.mark.asyncio
async def test_missing_event_id_rejected(client):
    ev = _event(); ev.pop("id")
    r = await client.post("/api/webhooks/paypal", json=ev, headers=SIG_HEADERS)
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_verified_event_stored_and_processed(client, verify_success):
    ev = _event()
    r = await client.post("/api/webhooks/paypal", json=ev, headers=SIG_HEADERS)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    doc = await db.paypal_webhook_events.find_one({"event_id": ev["id"]})
    assert doc["verification_status"] == "SUCCESS"
    assert doc["processing_result"] == "recorded_no_matching_order"  # iter438: capture events reconcile
    assert doc["event_type"] == ev["event_type"]
    assert doc["resource_id"] == ev["resource"]["id"]
    assert doc["environment"] == "sandbox"
    assert doc["received_at"] and doc["event_time"]


@pytest.mark.asyncio
async def test_duplicate_event_not_reprocessed(client, verify_success):
    ev = _event()
    r1 = await client.post("/api/webhooks/paypal", json=ev, headers=SIG_HEADERS)
    r2 = await client.post("/api/webhooks/paypal", json=ev, headers=SIG_HEADERS)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r2.json()["status"] == "duplicate"
    assert await db.paypal_webhook_events.count_documents({"event_id": ev["id"]}) == 1


@pytest.mark.asyncio
async def test_unverified_event_rejected_but_recorded(client, verify_failure):
    ev = _event()
    r = await client.post("/api/webhooks/paypal", json=ev, headers=SIG_HEADERS)
    assert r.status_code == 400
    doc = await db.paypal_webhook_events.find_one({"event_id": ev["id"]})
    assert doc["verification_status"] == "FAILURE"
    assert doc["processing_result"] == "rejected_unverified"


@pytest.mark.asyncio
async def test_verification_transport_error_returns_503(client, monkeypatch):
    async def boom(cfg, headers, event):
        raise RuntimeError("paypal down")
    monkeypatch.setattr(paypal_webhooks, "_verify_signature", boom)
    r = await client.post("/api/webhooks/paypal", json=_event(), headers=SIG_HEADERS)
    assert r.status_code == 503
