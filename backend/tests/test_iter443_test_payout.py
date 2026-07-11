"""iter443 — $0.01 sandbox test payout tests.

Proves: sandbox-only gating, sandbox-recipient-only, explicit confirmation,
idempotency (one PayPal call per request_id), zero impact on maker balances,
and webhook flipping the test item submitted → paid/failed.
"""
import os
import uuid

import pytest
import pytest_asyncio

os.environ["PAYPAL_ENVIRONMENT"] = "sandbox"
os.environ.setdefault("PAYPAL_CLIENT_ID_SANDBOX", "test-client-id")
os.environ.setdefault("PAYPAL_CLIENT_SECRET_SANDBOX", "test-client-secret")
os.environ.setdefault("PAYPAL_WEBHOOK_ID_SANDBOX", "test-webhook-id")

from httpx import ASGITransport, AsyncClient  # noqa: E402
from server import app  # noqa: E402
from core import db, now_iso  # noqa: E402
import email_service  # noqa: E402
from maker_auth import issue_session_jwt  # noqa: E402
from routers import paypal_payouts, paypal_webhooks  # noqa: E402

ADMIN = {"Authorization": f"Bearer {issue_session_jwt('admin-test', 'team@craftersmarket.org', role='admin')}"}
SIG = {
    "paypal-transmission-id": "t", "paypal-transmission-time": "x",
    "paypal-transmission-sig": "s", "paypal-cert-url": "https://c", "paypal-auth-algo": "A",
}
SANDBOX_RCPT = "sb-buyer@personal.example.com"


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def _clean():
    async def wipe():
        await db.paypal_payout_runs.delete_many({"kind": "test",
                                                 "created_by": "team@craftersmarket.org"})
        await db.paypal_webhook_events.delete_many({"event_id": {"$regex": "^WH-TPO-"}})
    await wipe()
    yield
    await wipe()


@pytest.fixture(autouse=True)
def receipt_mail(monkeypatch):
    sent = []

    async def receipt(*a, **k): sent.append({"args": a, "kwargs": k})
    monkeypatch.setattr(email_service, "send_maker_payout_sent", receipt)
    return sent


def mock_payouts_api(monkeypatch, status=201, calls=None):
    calls = calls if calls is not None else []

    async def fake_token(cfg): return "tok"

    class Resp:
        status_code = status
        text = "{}"
        content = b"{}"
        def json(self):
            if status not in (200, 201):
                return {"name": "VALIDATION_ERROR", "message": "bad", "debug_id": "d1"}
            return {"batch_header": {"payout_batch_id": "TESTBATCH-1",
                                     "batch_status": "PENDING"}}

    class FakeClient:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, **kw):
            calls.append({"url": url, "json": kw.get("json")})
            return Resp()

    monkeypatch.setattr(paypal_payouts, "_access_token", fake_token)
    monkeypatch.setattr(paypal_payouts.httpx, "AsyncClient", FakeClient)
    return calls


def _body(**over):
    return {"recipient_email": SANDBOX_RCPT, "confirm": True,
            "request_id": f"tp-{uuid.uuid4().hex[:10]}", **over}


@pytest.mark.asyncio
async def test_blocked_in_live_mode(client, monkeypatch):
    monkeypatch.setenv("PAYPAL_ENVIRONMENT", "live")
    monkeypatch.setenv("PAYPAL_CLIENT_ID_LIVE", "x")
    monkeypatch.setenv("PAYPAL_CLIENT_SECRET_LIVE", "y")
    monkeypatch.setenv("PAYPAL_WEBHOOK_ID_LIVE", "z")
    r = await client.post("/api/admin/paypal/payouts/test", headers=ADMIN, json=_body())
    assert r.status_code == 403
    assert "sandbox" in r.json()["detail"].lower()
    assert await db.paypal_payout_runs.count_documents(
        {"kind": "test", "created_by": "team@craftersmarket.org"}) == 0


@pytest.mark.asyncio
async def test_non_sandbox_recipient_rejected(client, monkeypatch):
    calls = mock_payouts_api(monkeypatch)
    r = await client.post("/api/admin/paypal/payouts/test", headers=ADMIN,
                          json=_body(recipient_email="someone@gmail.com"))
    assert r.status_code == 400
    assert len(calls) == 0


@pytest.mark.asyncio
async def test_confirmation_required(client, monkeypatch):
    calls = mock_payouts_api(monkeypatch)
    r = await client.post("/api/admin/paypal/payouts/test", headers=ADMIN,
                          json=_body(confirm=False))
    assert r.status_code == 400
    assert len(calls) == 0


@pytest.mark.asyncio
async def test_requires_admin(client):
    r = await client.post("/api/admin/paypal/payouts/test", json=_body())
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_success_isolated_from_maker_balances(client, monkeypatch, receipt_mail):
    before = await client.get("/api/admin/paypal/payouts/summary", headers=ADMIN)
    totals_before = before.json()["totals"]
    payouts_before = await db.maker_payouts.count_documents({})

    calls = mock_payouts_api(monkeypatch)
    r = await client.post("/api/admin/paypal/payouts/test", headers=ADMIN, json=_body())
    assert r.status_code == 200
    d = r.json()
    assert d["amount"] == "0.01"
    assert d["payout_batch_id"] == "TESTBATCH-1"
    assert d["item_id"].endswith(":__test__")
    assert d["api_response"]["payout_batch_id"] == "TESTBATCH-1"
    # Exactly one PayPal call, exactly $0.01, unique ids.
    assert len(calls) == 1
    item = calls[0]["json"]["items"][0]
    assert item["amount"]["value"] == "0.01"
    assert item["receiver"] == SANDBOX_RCPT
    assert calls[0]["json"]["sender_batch_header"]["sender_batch_id"] == d["run_id"]
    # Receipt email labeled as sandbox test.
    assert len(receipt_mail) == 1 and receipt_mail[0]["kwargs"].get("sandbox_test") is True
    # ZERO impact on maker balances / ledger / totals.
    assert await db.maker_payouts.count_documents({}) == payouts_before
    after = await client.get("/api/admin/paypal/payouts/summary", headers=ADMIN)
    assert after.json()["totals"] == totals_before
    run = await db.paypal_payout_runs.find_one({"id": d["run_id"]}, {"_id": 0})
    assert run["kind"] == "test" and run["test_item_status"] == "submitted"


@pytest.mark.asyncio
async def test_idempotent_per_request_id(client, monkeypatch):
    calls = mock_payouts_api(monkeypatch)
    body = _body()
    r1 = await client.post("/api/admin/paypal/payouts/test", headers=ADMIN, json=body)
    r2 = await client.post("/api/admin/paypal/payouts/test", headers=ADMIN, json=body)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r2.json()["duplicate"] is True
    assert r2.json()["run_id"] == r1.json()["run_id"]
    assert len(calls) == 1  # PayPal hit exactly once


@pytest.mark.asyncio
async def test_webhook_flips_test_item_to_paid(client, monkeypatch):
    mock_payouts_api(monkeypatch)
    r = await client.post("/api/admin/paypal/payouts/test", headers=ADMIN, json=_body())
    run_id = r.json()["run_id"]

    async def fake_verify(cfg, headers, event):
        return "SUCCESS", {"response_status": 200}
    monkeypatch.setattr(paypal_webhooks, "_verify_signature", fake_verify)
    ev = {
        "id": f"WH-TPO-{uuid.uuid4().hex[:10]}",
        "event_type": "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        "resource_type": "payouts_item",
        "create_time": now_iso(),
        "resource": {"payout_item_id": "TITEM-1", "transaction_status": "SUCCESS",
                     "payout_item": {"sender_item_id": f"{run_id}:__test__"}},
    }
    w = await client.post("/api/webhooks/paypal", json=ev, headers=SIG)
    assert w.status_code == 200 and w.json()["result"] == "payout_test_item:paid"
    run = await db.paypal_payout_runs.find_one({"id": run_id}, {"_id": 0})
    assert run["test_item_status"] == "paid"
    assert run["payout_item_id"] == "TITEM-1"
    assert run["webhook_updates"][-1]["event_type"] == "PAYMENT.PAYOUTS-ITEM.SUCCEEDED"
    # Still zero maker ledger rows for this run.
    assert await db.maker_payouts.count_documents({"payout_run_id": run_id}) == 0


@pytest.mark.asyncio
async def test_webhook_flips_test_item_to_failed(client, monkeypatch):
    mock_payouts_api(monkeypatch)
    r = await client.post("/api/admin/paypal/payouts/test", headers=ADMIN, json=_body())
    run_id = r.json()["run_id"]

    async def fake_verify(cfg, headers, event):
        return "SUCCESS", {"response_status": 200}
    monkeypatch.setattr(paypal_webhooks, "_verify_signature", fake_verify)
    ev = {
        "id": f"WH-TPO-{uuid.uuid4().hex[:10]}",
        "event_type": "PAYMENT.PAYOUTS-ITEM.FAILED",
        "resource_type": "payouts_item",
        "create_time": now_iso(),
        "resource": {"payout_item_id": "TITEM-2", "transaction_status": "FAILED",
                     "payout_item": {"sender_item_id": f"{run_id}:__test__"}},
    }
    w = await client.post("/api/webhooks/paypal", json=ev, headers=SIG)
    assert w.json()["result"] == "payout_test_item:failed"
    run = await db.paypal_payout_runs.find_one({"id": run_id}, {"_id": 0})
    assert run["test_item_status"] == "failed"
