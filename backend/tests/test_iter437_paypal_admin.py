"""iter437 — Admin PayPal Events viewer: authz, pagination, filtering,
search, sanitization, summary, and duplicate accounting."""
import os
import uuid

import pytest
import pytest_asyncio

os.environ["PAYPAL_ENVIRONMENT"] = "sandbox"
os.environ["PAYPAL_CLIENT_ID_SANDBOX"] = os.environ.get("PAYPAL_CLIENT_ID_SANDBOX") or "test-id"
os.environ["PAYPAL_CLIENT_SECRET_SANDBOX"] = os.environ.get("PAYPAL_CLIENT_SECRET_SANDBOX") or "test-secret"
os.environ["PAYPAL_WEBHOOK_ID_SANDBOX"] = os.environ.get("PAYPAL_WEBHOOK_ID_SANDBOX") or "test-wh"

from httpx import ASGITransport, AsyncClient  # noqa: E402
from server import app  # noqa: E402
from core import db  # noqa: E402
from maker_auth import issue_session_jwt  # noqa: E402
from routers import paypal_webhooks  # noqa: E402

SIG = {
    "paypal-transmission-id": "t", "paypal-transmission-time": "x",
    "paypal-transmission-sig": "s", "paypal-cert-url": "https://c", "paypal-auth-algo": "A",
}
ADMIN = {"Authorization": f"Bearer {issue_session_jwt('admin-test', 'team@craftersmarket.org', role='admin')}"}


def _event(eid=None, etype="PAYMENT.CAPTURE.COMPLETED", **res_extra):
    return {
        "id": eid or f"WH-ADMIN-{uuid.uuid4().hex[:12]}",
        "event_type": etype,
        "resource_type": "capture",
        "create_time": "2026-07-11T00:00:00Z",
        "resource": {
            "id": f"CAP-{uuid.uuid4().hex[:8]}",
            "invoice_id": "INV-42",
            "custom_id": "order-abc",
            "amount": {"value": "25.00", "currency_code": "USD"},
            "supplementary_data": {"related_ids": {"order_id": "ORD-777"}},
            "secret_token": "SHOULD-BE-REDACTED",
            **res_extra,
        },
    }


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def _clean():
    await db.paypal_webhook_events.delete_many({"event_id": {"$regex": "^WH-ADMIN-"}})
    yield
    await db.paypal_webhook_events.delete_many({"event_id": {"$regex": "^WH-ADMIN-"}})


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
async def test_admin_endpoints_require_auth(client):
    for path in ["/api/admin/paypal/events", "/api/admin/paypal/events/summary", "/api/admin/paypal/events/some-id"]:
        r = await client.get(path)
        assert r.status_code in (401, 403), path


@pytest.mark.asyncio
async def test_list_pagination_and_sort(client, verify_success):
    for i in range(7):
        await client.post("/api/webhooks/paypal", json=_event(), headers=SIG)
    r = await client.get("/api/admin/paypal/events?page=1&page_size=5&q=", headers=ADMIN)
    d = r.json()
    assert r.status_code == 200 and d["total"] >= 7 and len(d["events"]) == 5
    times = [e["received_at"] for e in d["events"]]
    assert times == sorted(times, reverse=True)  # newest first
    r2 = await client.get("/api/admin/paypal/events?page=2&page_size=5", headers=ADMIN)
    assert len(r2.json()["events"]) >= 2
    assert "payload" not in d["events"][0]  # list view excludes payload


@pytest.mark.asyncio
async def test_filters_and_search(client, verify_success, verify_failure_unused=None):
    ev = _event(etype="CHECKOUT.ORDER.APPROVED")
    await client.post("/api/webhooks/paypal", json=ev, headers=SIG)
    r = await client.get("/api/admin/paypal/events?event_type=CHECKOUT.ORDER.APPROVED&environment=sandbox&verification_status=SUCCESS", headers=ADMIN)
    ids = [e["event_id"] for e in r.json()["events"]]
    assert ev["id"] in ids
    # search by order id / event id / invoice id
    for needle in (ev["id"], "ORD-777", "INV-42"):
        r = await client.get(f"/api/admin/paypal/events?q={needle}", headers=ADMIN)
        assert any(e["event_id"] == ev["id"] for e in r.json()["events"]), needle
    # non-matching filter excludes
    r = await client.get("/api/admin/paypal/events?verification_status=FAILURE&q=" + ev["id"], headers=ADMIN)
    assert all(e["event_id"] != ev["id"] for e in r.json()["events"])


@pytest.mark.asyncio
async def test_detail_sanitization_and_ids(client, verify_success):
    ev = _event()
    await client.post("/api/webhooks/paypal", json=ev, headers=SIG)
    r = await client.get(f"/api/admin/paypal/events/{ev['id']}", headers=ADMIN)
    d = r.json()
    assert r.status_code == 200
    assert d["order_id"] == "ORD-777" and d["invoice_id"] == "INV-42" and d["custom_id"] == "order-abc"
    assert d["amount"] == "25.00" and d["currency"] == "USD"
    assert d["capture_id"] == ev["resource"]["id"]
    assert d["http_outcome"] == "200 ok" and d["processing_result"] == "recorded_no_matching_order"
    # credential-shaped keys redacted in stored payload
    assert d["payload"]["resource"]["secret_token"] == "[redacted]"
    assert "links" not in d["payload"]


@pytest.mark.asyncio
async def test_rejected_event_visible_with_reason(client, verify_failure):
    ev = _event()
    r = await client.post("/api/webhooks/paypal", json=ev, headers=SIG)
    assert r.status_code == 400
    d = (await client.get(f"/api/admin/paypal/events/{ev['id']}", headers=ADMIN)).json()
    assert d["verification_status"] == "FAILURE"
    assert d["processing_result"] == "rejected_unverified"
    assert d["http_outcome"].startswith("400")


@pytest.mark.asyncio
async def test_duplicates_counted_and_summary(client, verify_success):
    ev = _event()
    await client.post("/api/webhooks/paypal", json=ev, headers=SIG)
    await client.post("/api/webhooks/paypal", json=ev, headers=SIG)
    await client.post("/api/webhooks/paypal", json=ev, headers=SIG)
    d = (await client.get(f"/api/admin/paypal/events/{ev['id']}", headers=ADMIN)).json()
    assert d["duplicate_count"] == 2
    s = (await client.get("/api/admin/paypal/events/summary", headers=ADMIN)).json()
    assert s["last_24h"]["received"] >= 1 and s["last_24h"]["duplicates"] >= 2
    assert s["health"]["environment"] == "sandbox"
    assert s["health"]["client_id"] in ("Configured", "Missing")
    assert not any(len(str(v)) > 20 for v in s["health"].values())  # never leaks values


@pytest.mark.asyncio
async def test_processing_error_recorded(client, verify_success, monkeypatch):
    async def boom(event):
        raise ValueError("nope")
    monkeypatch.setattr(paypal_webhooks, "_process_event", boom)
    ev = _event()
    r = await client.post("/api/webhooks/paypal", json=ev, headers=SIG)
    assert r.status_code == 200
    d = (await client.get(f"/api/admin/paypal/events/{ev['id']}", headers=ADMIN)).json()
    assert d["processing_result"] == "error:ValueError"
    assert d["http_outcome"] == "200 processing error"
    r = await client.get("/api/admin/paypal/events?processing_result=error", headers=ADMIN)
    assert any(e["event_id"] == ev["id"] for e in r.json()["events"])
