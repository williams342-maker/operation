import os, sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "craftersmarket_test_returns_cases")
os.environ.setdefault("MAKER_AUTH_SECRET", "test-maker-secret")
os.environ.setdefault("ADMIN_EMAILS", "admin@craftersmarket.local")
os.environ.setdefault("SCHEDULER_ENABLED", "false")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from core import db
from maker_auth import issue_session_jwt
from server import app
from routers.returns_cases import ensure_return_case_indexes, run_return_case_deadline_sweep

BUYER_EMAIL = "buyer@example.test"
BUYER = {"Authorization": f"Bearer {issue_session_jwt('buyer', BUYER_EMAIL, role='buyer')}"}
OTHER_BUYER = {"Authorization": f"Bearer {issue_session_jwt('other', 'other@example.test', role='buyer')}"}
MAKER = {"Authorization": f"Bearer {issue_session_jwt('maker-a', 'maker@example.test', role='maker')}"}
OTHER_MAKER = {"Authorization": f"Bearer {issue_session_jwt('maker-b', 'othermaker@example.test', role='maker')}"}
ADMIN = {"Authorization": f"Bearer {issue_session_jwt('admin', 'admin@craftersmarket.local', role='admin')}"}

@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

@pytest_asyncio.fixture(autouse=True)
async def clean(monkeypatch):
    for coll in [db.return_cases, db.return_case_items, db.return_case_messages, db.return_case_attachments, db.return_authorizations, db.return_case_resolutions, db.return_case_offers, db.return_case_notifications, db.return_case_timeline, db.payment_transactions, db.products, db.makers, db.admin_audit, db.marketplace_ledger, db.maker_payouts, db.maker_balance_adjustments, db.policy_versions]:
        await coll.delete_many({})
    await ensure_return_case_indexes()
    await db.makers.insert_many([
        {"slug":"maker-a","email":"maker@example.test","name":"Maker A","return_policy":"Returns accepted within 14 days."},
        {"slug":"maker-b","email":"othermaker@example.test","name":"Maker B"},
    ])
    await db.products.insert_one({"id":"prod-a","slug":"prod-a","title":"Walnut Bowl","maker_slug":"maker-a","price":40,"images":["/bowl.jpg"],"accept_returns":True})
    await db.policy_versions.insert_one({"id":"pv-returns","policy_id":"returns","version_number":"1.0","status":"published","effective_at":"2026-01-01T00:00:00+00:00"})
    await db.payment_transactions.insert_one({"session_id":"sess_1","payment_status":"paid","payment_provider":"stripe","customer_email":BUYER_EMAIL,"amount":50.0,"currency":"usd","created_at":"2026-07-01T00:00:00+00:00","policy_version":"checkout-1","policy_accepted_at":"2026-07-01T00:00:00+00:00","items":[{"product_id":"prod-a","quantity":1,"price":40,"maker_slug":"maker-a","title":"Walnut Bowl"}]})
    async def fake_mail(**kw): return {"ok": True}
    monkeypatch.setattr("email_service.send_return_case_notice", fake_mail, raising=False)
    yield

async def open_case(client, headers=BUYER):
    r = await client.post("/api/buyer/orders/sess_1/cases", headers=headers, json={"case_type":"damaged","reason_code":"damaged","requested_resolution":"return_for_refund","explanation":"The item arrived cracked across the side.","items":[{"order_item_id":"prod-a","quantity_affected":1}]})
    assert r.status_code == 200, r.text
    return r.json()

@pytest.mark.asyncio
async def test_buyer_can_open_case_and_snapshot_policy(client):
    case = await open_case(client)
    assert case["maker_id"] == "maker-a"
    assert case["policy_snapshot"]["source"] == "purchase_time"
    assert case["items"][0]["title"] == "Walnut Bowl"

@pytest.mark.asyncio
async def test_buyer_cannot_open_other_buyers_order(client):
    r = await client.post("/api/buyer/orders/sess_1/cases", headers=OTHER_BUYER, json={"case_type":"damaged","reason_code":"damaged","requested_resolution":"return_for_refund","explanation":"This should not work.","items":[{"order_item_id":"prod-a","quantity_affected":1}]})
    assert r.status_code == 404

@pytest.mark.asyncio
async def test_duplicate_active_case_rejected(client):
    await open_case(client)
    r = await client.post("/api/buyer/orders/sess_1/cases", headers=BUYER, json={"case_type":"damaged","reason_code":"damaged","requested_resolution":"return_for_refund","explanation":"The same damaged item again.","items":[{"order_item_id":"prod-a","quantity_affected":1}]})
    assert r.status_code == 409

@pytest.mark.asyncio
async def test_maker_access_is_scoped(client):
    case = await open_case(client)
    assert (await client.get(f"/api/maker/cases/{case['id']}", headers=MAKER)).status_code == 200
    assert (await client.get(f"/api/maker/cases/{case['id']}", headers=OTHER_MAKER)).status_code == 404

@pytest.mark.asyncio
async def test_messages_and_admin_notes_visibility(client):
    case = await open_case(client)
    await client.post(f"/api/maker/cases/{case['id']}/messages", headers=MAKER, json={"message_body":"Can you upload a photo?"})
    await client.post(f"/api/admin/returns-cases/{case['id']}/notes", headers=ADMIN, json={"message_body":"Watch for repeat issue."})
    buyer = await client.get(f"/api/buyer/cases/{case['id']}", headers=BUYER)
    admin = await client.get(f"/api/admin/returns-cases/{case['id']}", headers=ADMIN)
    assert "Can you upload" in str(buyer.json()["messages"])
    assert "Watch for repeat" not in str(buyer.json()["messages"])
    assert "Watch for repeat" in str(admin.json()["messages"])

@pytest.mark.asyncio
async def test_attachment_validation_rejects_unsupported(client):
    case = await open_case(client)
    r = await client.post(f"/api/buyer/cases/{case['id']}/attachments", headers=BUYER, files={"file": ("bad.exe", b"x", "application/x-msdownload")})
    assert r.status_code == 400

@pytest.mark.asyncio
async def test_return_authorization_and_tracking(client):
    case = await open_case(client)
    r = await client.post(f"/api/maker/cases/{case['id']}/approve-return", headers=MAKER, json={"shipping_paid_by":"maker"})
    assert r.status_code == 200
    assert r.json()["return_authorization"]["authorization_number"].startswith("RA-")
    t = await client.post(f"/api/buyer/cases/{case['id']}/return-tracking", headers=BUYER, json={"carrier":"USPS","tracking_number":"9400110200881234567890"})
    assert t.status_code == 200
    assert t.json()["case"]["current_status"] == "return_in_transit"

@pytest.mark.asyncio
async def test_partial_refund_limit_and_ledger_adjustment(client):
    case = await open_case(client)
    await db.maker_payouts.insert_one({"session_id":"sess_1","maker_slug":"maker-a","amount_cents":3000,"status":"deferred"})
    ok = await client.post(f"/api/maker/cases/{case['id']}/approve-refund", headers=MAKER, json={"amount":15,"reason":"Partial damage refund","idempotency_key":"idem-1"})
    assert ok.status_code == 200, ok.text
    assert (await db.marketplace_ledger.count_documents({"kind":"refund"})) == 1
    payout = await db.maker_payouts.find_one({"session_id":"sess_1","maker_slug":"maker-a"})
    assert payout["amount_cents"] == 1500
    too_much = await client.post(f"/api/maker/cases/{case['id']}/approve-refund", headers=MAKER, json={"amount":99,"reason":"Too much"})
    assert too_much.status_code in (400, 409)

@pytest.mark.asyncio
async def test_admin_can_view_and_link_provider_dispute(client):
    case = await open_case(client)
    r = await client.post(f"/api/admin/returns-cases/{case['id']}/link-provider-dispute", headers=ADMIN, json={"payment_provider":"stripe","payment_provider_dispute_id":"dp_123","amount_at_risk":50})
    assert r.status_code == 200
    assert r.json()["payment_provider_dispute_id"] == "dp_123"

@pytest.mark.asyncio
async def test_deadline_sweep_is_idempotent(client):
    case = await open_case(client)
    due = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    await db.return_cases.update_one({"id":case["id"]},{"$set":{"maker_response_due_at":due}})
    one = await run_return_case_deadline_sweep(); two = await run_return_case_deadline_sweep()
    assert one["sent"] >= 1
    assert two["sent"] == 0

