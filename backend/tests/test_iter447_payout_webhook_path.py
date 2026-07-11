"""iter447 — dedicated /webhooks/paypal/payout-status ingress tests."""
import json
import os

import pytest
import pytest_asyncio

os.environ["PAYPAL_ENVIRONMENT"] = "sandbox"
os.environ.setdefault("PAYPAL_CLIENT_ID_SANDBOX", "test-client-id")
os.environ.setdefault("PAYPAL_CLIENT_SECRET_SANDBOX", "test-client-secret")
os.environ.setdefault("PAYPAL_WEBHOOK_ID_SANDBOX", "primary-webhook-id")

from httpx import ASGITransport, AsyncClient  # noqa: E402
from server import app  # noqa: E402
from core import db  # noqa: E402
from routers import paypal_webhooks  # noqa: E402

SIG = {
    "paypal-transmission-id": "t", "paypal-transmission-time": "x",
    "paypal-transmission-sig": "s", "paypal-cert-url": "https://c",
    "paypal-auth-algo": "A",
}


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def _clean():
    await db.paypal_webhook_events.delete_many({"event_id": {"$regex": "^WH-PST-"}})
    yield
    await db.paypal_webhook_events.delete_many({"event_id": {"$regex": "^WH-PST-"}})


@pytest.fixture
def capture_verify(monkeypatch):
    seen = {}

    async def fake_verify(cfg, headers, raw):
        seen["webhook_id"] = cfg["webhook_id"]
        return "SUCCESS", {"webhook_id_last4": cfg["webhook_id"][-4:]}
    monkeypatch.setattr(paypal_webhooks, "_verify_signature", fake_verify)
    return seen


def _event(eid, etype="PAYMENT.PAYOUTSBATCH.SUCCESS"):
    return json.dumps({"id": eid, "event_type": etype,
                       "resource_type": "payouts",
                       "resource": {"batch_header": {}},
                       "summary": "test", "create_time": "2026-07-11T00:00:00Z"})


@pytest.mark.asyncio
async def test_payout_status_path_exists_and_records(client, capture_verify):
    r = await client.post("/api/webhooks/paypal/payout-status",
                          content=_event("WH-PST-1"), headers=SIG)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    doc = await db.paypal_webhook_events.find_one({"event_id": "WH-PST-1"}, {"_id": 0})
    assert doc and doc["ingress"] == "payout-status"


@pytest.mark.asyncio
async def test_falls_back_to_primary_webhook_id(client, capture_verify, monkeypatch):
    monkeypatch.delenv("PAYPAL_PAYOUT_WEBHOOK_ID_SANDBOX", raising=False)
    await client.post("/api/webhooks/paypal/payout-status",
                      content=_event("WH-PST-2"), headers=SIG)
    assert capture_verify["webhook_id"] == os.environ["PAYPAL_WEBHOOK_ID_SANDBOX"]


@pytest.mark.asyncio
async def test_uses_dedicated_webhook_id_when_set(client, capture_verify, monkeypatch):
    monkeypatch.setenv("PAYPAL_PAYOUT_WEBHOOK_ID_SANDBOX", "payout-webhook-id")
    await client.post("/api/webhooks/paypal/payout-status",
                      content=_event("WH-PST-3"), headers=SIG)
    assert capture_verify["webhook_id"] == "payout-webhook-id"
    # primary path still verifies against the primary id
    await client.post("/api/webhooks/paypal",
                      content=_event("WH-PST-4"), headers=SIG)
    assert capture_verify["webhook_id"] == os.environ["PAYPAL_WEBHOOK_ID_SANDBOX"]


@pytest.mark.asyncio
async def test_duplicate_across_both_paths(client, capture_verify):
    r1 = await client.post("/api/webhooks/paypal/payout-status",
                           content=_event("WH-PST-5"), headers=SIG)
    assert r1.json()["status"] == "ok"
    r2 = await client.post("/api/webhooks/paypal",
                           content=_event("WH-PST-5"), headers=SIG)
    assert r2.json()["status"] == "duplicate"


@pytest.mark.asyncio
async def test_checkout_webhook_path_exists_and_records(client, capture_verify):
    r = await client.post("/api/paypal/webhook",
                          content=_event("WH-PST-6", "PAYMENT.CAPTURE.PENDING"),
                          headers=SIG)
    assert r.status_code == 200 and r.json()["status"] == "ok"
    doc = await db.paypal_webhook_events.find_one({"event_id": "WH-PST-6"}, {"_id": 0})
    assert doc and doc["ingress"] == "checkout"


@pytest.mark.asyncio
async def test_checkout_webhook_id_env_var(client, capture_verify, monkeypatch):
    monkeypatch.setenv("PAYPAL_CHECKOUT_WEBHOOK_ID", "checkout-webhook-id")
    await client.post("/api/paypal/webhook",
                      content=_event("WH-PST-7"), headers=SIG)
    assert capture_verify["webhook_id"] == "checkout-webhook-id"
    # falls back to primary when unset
    monkeypatch.delenv("PAYPAL_CHECKOUT_WEBHOOK_ID")
    await client.post("/api/paypal/webhook",
                      content=_event("WH-PST-8"), headers=SIG)
    assert capture_verify["webhook_id"] == os.environ["PAYPAL_WEBHOOK_ID_SANDBOX"]
