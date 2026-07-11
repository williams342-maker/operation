"""iter441 — PayPal Payouts (admin-triggered) tests.

Covers: summary buckets (available / missing email / hold), dry-run,
execute batch (mocked PayPal), rollback on PayPal failure, payout item
webhooks (paid/failed + retry eligibility), maker paypal_email save,
missing-email nudge + reminders.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

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

PFX = "pyttest"
ADMIN = {"Authorization": f"Bearer {issue_session_jwt('admin-test', 'team@craftersmarket.org', role='admin')}"}
SIG = {
    "paypal-transmission-id": "t", "paypal-transmission-time": "x",
    "paypal-transmission-sig": "s", "paypal-cert-url": "https://c", "paypal-auth-algo": "A",
}


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def _clean():
    async def wipe():
        await db.makers.delete_many({"slug": {"$regex": f"^{PFX}-"}})
        await db.maker_payouts.delete_many({"maker_slug": {"$regex": f"^{PFX}-"}})
        await db.payment_transactions.delete_many({"session_id": {"$regex": f"^pp_{PFX}"}})
        await db.paypal_payout_runs.delete_many({"created_by": "team@craftersmarket.org"})
        await db.marketplace_ledger.delete_many({"$or": [
            {"session_id": {"$regex": f"^pp_{PFX}"}},
            {"maker_slug": {"$regex": f"^{PFX}-"}}]})
        await db.paypal_webhook_events.delete_many({"event_id": {"$regex": "^WH-PYT-"}})
    await wipe()
    yield
    await wipe()


@pytest.fixture(autouse=True)
def mails(monkeypatch):
    counts = {"needed": 0, "receipt": 0, "needed_to": []}

    async def needed(email, *a, **k):
        counts["needed"] += 1
        counts["needed_to"].append(email)
    async def receipt(*a, **k): counts["receipt"] += 1
    monkeypatch.setattr(email_service, "send_maker_paypal_email_needed", needed)
    monkeypatch.setattr(email_service, "send_maker_payout_sent", receipt)
    return counts


@pytest.fixture
def verify_success(monkeypatch):
    async def fake(cfg, headers, event):
        return "SUCCESS", {"response_status": 200}
    monkeypatch.setattr(paypal_webhooks, "_verify_signature", fake)


def mock_payouts_api(monkeypatch, status=201, body=None, calls=None):
    calls = calls if calls is not None else []

    async def fake_token(cfg): return "tok"

    class Resp:
        status_code = status
        text = "{}"
        def json(self):
            return body or {"batch_header": {"payout_batch_id": "BATCH-XYZ",
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


async def seed_maker(paypal_email=None, **extra):
    slug = f"{PFX}-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({"slug": slug, "name": f"M {slug[-4:]}",
                                "initials": "TM", "location": "Testville, US",
                                "bio": "Test maker", "techniques": [],
                                "portrait": "", "cover": "",
                                "email": f"{slug}@example.com",
                                "paypal_email": paypal_email, **extra})
    return slug


async def seed_payout(maker_slug, cents, status="deferred", session=None, **extra):
    session = session or f"pp_{PFX}{uuid.uuid4().hex[:10]}"
    await db.maker_payouts.insert_one({
        "session_id": session, "maker_slug": maker_slug, "provider": "paypal",
        "amount": cents / 100.0, "amount_cents": cents, "gross_cents": cents,
        "commission_cents": int(cents * 0.05), "commission_bps": 500,
        "status": status, "reason": "paypal-manual-payout",
        "updated_at": now_iso(), **extra,
    })
    return session


@pytest.mark.asyncio
async def test_summary_buckets(client):
    m_ready = await seed_maker(paypal_email="ready@paypal.com")
    m_missing = await seed_maker()
    m_hold = await seed_maker(paypal_email="hold@paypal.com")
    await seed_payout(m_ready, 1500)
    await seed_payout(m_ready, 900, status="paid", paid_at=now_iso())
    await seed_payout(m_missing, 2500)
    hold_sess = await seed_payout(m_hold, 4000)
    await db.payment_transactions.insert_one({
        "session_id": hold_sess, "dispute_id": "D-1", "dispute_status": "OPEN"})

    r = await client.get("/api/admin/paypal/payouts/summary", headers=ADMIN)
    assert r.status_code == 200
    d = r.json()
    by = {m["maker_slug"]: m for m in d["makers"]}
    assert by[m_ready]["available_cents"] == 1500
    assert by[m_ready]["paid_cents"] == 900
    assert by[m_missing]["missing_email_cents"] == 2500
    assert by[m_missing]["available_cents"] == 0
    assert by[m_hold]["hold_cents"] == 4000
    assert by[m_hold]["available_cents"] == 0
    assert d["totals"]["available_cents"] >= 1500


@pytest.mark.asyncio
async def test_dry_run_no_state_change(client):
    m = await seed_maker(paypal_email="m@paypal.com")
    await seed_payout(m, 1200)
    r = await client.post("/api/admin/paypal/payouts/run", headers=ADMIN,
                          json={"maker_slugs": [], "dry_run": True})
    assert r.status_code == 200
    d = r.json()
    assert d["dry_run"] is True and d["total_cents"] >= 1200
    row = await db.maker_payouts.find_one({"maker_slug": m}, {"_id": 0})
    assert row["status"] == "deferred"  # untouched
    assert await db.paypal_payout_runs.count_documents(
        {"created_by": "team@craftersmarket.org"}) == 0


@pytest.mark.asyncio
async def test_execute_batch_success(client, monkeypatch, mails):
    m = await seed_maker(paypal_email="m@paypal.com")
    s1 = await seed_payout(m, 1000)
    s2 = await seed_payout(m, 500)
    calls = mock_payouts_api(monkeypatch)
    r = await client.post("/api/admin/paypal/payouts/run", headers=ADMIN,
                          json={"maker_slugs": [m], "dry_run": False})
    assert r.status_code == 200
    d = r.json()
    assert d["payout_batch_id"] == "BATCH-XYZ" and d["total_cents"] == 1500
    # PayPal called once with correct item + idempotent sender_batch_id.
    assert len(calls) == 1
    item = calls[0]["json"]["items"][0]
    assert item["receiver"] == "m@paypal.com"
    assert item["amount"]["value"] == "15.00"
    assert item["sender_item_id"] == f"{d['run_id']}:{m}"
    assert calls[0]["json"]["sender_batch_header"]["sender_batch_id"] == d["run_id"]
    for sess in (s1, s2):
        row = await db.maker_payouts.find_one({"session_id": sess}, {"_id": 0})
        assert row["status"] == "processing"
        assert row["payout_batch_id"] == "BATCH-XYZ"
        assert row["paypal_email_used"] == "m@paypal.com"
    run = await db.paypal_payout_runs.find_one({"id": d["run_id"]}, {"_id": 0})
    assert run["status"] == "submitted"
    assert mails["receipt"] == 1
    # Re-running immediately finds nothing eligible (no double pay).
    r2 = await client.post("/api/admin/paypal/payouts/run", headers=ADMIN,
                           json={"maker_slugs": [m], "dry_run": False})
    assert r2.status_code == 400


@pytest.mark.asyncio
async def test_execute_rolls_back_on_paypal_failure(client, monkeypatch):
    m = await seed_maker(paypal_email="m@paypal.com")
    sess = await seed_payout(m, 2000)
    mock_payouts_api(monkeypatch, status=400,
                     body={"name": "VALIDATION_ERROR"})
    r = await client.post("/api/admin/paypal/payouts/run", headers=ADMIN,
                          json={"maker_slugs": [m], "dry_run": False})
    assert r.status_code == 502
    row = await db.maker_payouts.find_one({"session_id": sess}, {"_id": 0})
    assert row["status"] == "deferred" and "payout_run_id" not in row


@pytest.mark.asyncio
async def test_payout_item_succeeded_webhook(client, monkeypatch, verify_success):
    m = await seed_maker(paypal_email="m@paypal.com")
    sess = await seed_payout(m, 1000)
    mock_payouts_api(monkeypatch)
    r = await client.post("/api/admin/paypal/payouts/run", headers=ADMIN,
                          json={"maker_slugs": [m], "dry_run": False})
    run_id = r.json()["run_id"]
    ev = {
        "id": f"WH-PYT-{uuid.uuid4().hex[:10]}",
        "event_type": "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        "resource_type": "payouts_item",
        "create_time": now_iso(),
        "resource": {"payout_item_id": "ITEM-1", "transaction_status": "SUCCESS",
                     "payout_item": {"sender_item_id": f"{run_id}:{m}"}},
    }
    w = await client.post("/api/webhooks/paypal", json=ev, headers=SIG)
    assert w.status_code == 200 and w.json()["result"] == f"payout_item:paid:{m}"
    row = await db.maker_payouts.find_one({"session_id": sess}, {"_id": 0})
    assert row["status"] == "paid" and row["payout_item_id"] == "ITEM-1" and row["paid_at"]


@pytest.mark.asyncio
async def test_payout_item_failed_webhook_is_retryable(client, monkeypatch, verify_success):
    m = await seed_maker(paypal_email="m@paypal.com")
    sess = await seed_payout(m, 1000)
    mock_payouts_api(monkeypatch)
    r = await client.post("/api/admin/paypal/payouts/run", headers=ADMIN,
                          json={"maker_slugs": [m], "dry_run": False})
    run_id = r.json()["run_id"]
    ev = {
        "id": f"WH-PYT-{uuid.uuid4().hex[:10]}",
        "event_type": "PAYMENT.PAYOUTS-ITEM.FAILED",
        "resource_type": "payouts_item",
        "create_time": now_iso(),
        "resource": {"payout_item_id": "ITEM-2", "transaction_status": "FAILED",
                     "errors": {"message": "Receiver is invalid"},
                     "payout_item": {"sender_item_id": f"{run_id}:{m}"}},
    }
    w = await client.post("/api/webhooks/paypal", json=ev, headers=SIG)
    assert w.json()["result"] == f"payout_item:failed:{m}"
    row = await db.maker_payouts.find_one({"session_id": sess}, {"_id": 0})
    assert row["status"] == "failed" and row["failure_reason"] == "Receiver is invalid"
    # Failed balances re-surface as available for a retry run.
    s = await client.get("/api/admin/paypal/payouts/summary", headers=ADMIN)
    by = {x["maker_slug"]: x for x in s.json()["makers"]}
    assert by[m]["available_cents"] == 1000


@pytest.mark.asyncio
async def test_maker_saves_paypal_email(client):
    slug = await seed_maker()
    tok = issue_session_jwt(slug, f"{slug}@example.com")
    r = await client.patch("/api/maker/profile",
                           headers={"Authorization": f"Bearer {tok}"},
                           json={"paypal_email": "Pay.Me@Example.COM"})
    assert r.status_code == 200
    assert r.json()["paypal_email"] == "Pay.Me@Example.COM".lower() or r.json()["paypal_email"]
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    assert m["paypal_email"]
    # Bad format rejected by validation.
    r2 = await client.patch("/api/maker/profile",
                            headers={"Authorization": f"Bearer {tok}"},
                            json={"paypal_email": "not-an-email"})
    assert r2.status_code == 422


@pytest.mark.asyncio
async def test_nudge_sent_once(mails):
    slug = await seed_maker()
    await seed_payout(slug, 800)
    await paypal_payouts.nudge_paypal_email_needed(slug)
    await paypal_payouts.nudge_paypal_email_needed(slug)  # second sale — no re-send
    assert mails["needed"] == 1
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    assert m["paypal_email_nudged_at"]


@pytest.mark.asyncio
async def test_reminder_stages(mails):
    nudged = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    slug = await seed_maker(paypal_email_nudged_at=nudged, paypal_email_reminder_count=0)
    my_email = f"{slug}@example.com"
    my_count = lambda: mails["needed_to"].count(my_email)  # noqa: E731
    await seed_payout(slug, 1200)
    await paypal_payouts.job_paypal_email_reminders()
    assert my_count() == 1  # 3-day reminder fired
    await paypal_payouts.job_paypal_email_reminders()
    assert my_count() == 1  # 7-day stage not reached — no dup
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    assert m["paypal_email_reminder_count"] == 1
    # Maker adds their email → reminders stop entirely.
    await db.makers.update_one({"slug": slug}, {"$set": {"paypal_email": "x@y.com"}})
    await paypal_payouts.job_paypal_email_reminders()
    assert my_count() == 1
