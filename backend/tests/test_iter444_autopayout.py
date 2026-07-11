"""iter444 — Automated payout engine (Phase A) tests."""
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
from ledger import ledger_record  # noqa: E402
from maker_auth import issue_session_jwt  # noqa: E402
from routers import paypal_payouts, payout_engine  # noqa: E402

PFX = "aptest"
ADMIN = {"Authorization": f"Bearer {issue_session_jwt('admin-test', 'team@craftersmarket.org', role='admin')}"}
OLD = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()


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
        await db.paypal_payout_runs.delete_many({"created_by": {"$regex": "^autopayout|^admin:team@"}})
        await db.payout_reports.delete_many({"trigger": {"$regex": "^test|^admin:team@|^autopayout"}})
        await db.marketplace_ledger.delete_many({"maker_slug": {"$regex": f"^{PFX}-"}})
    await wipe()
    # Freeze pre-existing (non-test) makers so force runs never pick up
    # real/demo balances living in the shared preview DB.
    frozen = [m["slug"] async for m in db.makers.find(
        {"slug": {"$not": {"$regex": f"^{PFX}-"}}, "payouts_on_hold": {"$ne": True}},
        {"_id": 0, "slug": 1})]
    if frozen:
        await db.makers.update_many(
            {"slug": {"$in": frozen}}, {"$set": {"payouts_on_hold": True}})
    yield
    if frozen:
        await db.makers.update_many(
            {"slug": {"$in": frozen}}, {"$unset": {"payouts_on_hold": 1}})
    await wipe()


@pytest.fixture(autouse=True)
def mails(monkeypatch):
    counts = {"receipt": 0, "report": 0, "report_last": None}

    async def receipt(*a, **k): counts["receipt"] += 1
    async def report(rep): counts["report"] += 1; counts["report_last"] = rep
    monkeypatch.setattr(email_service, "send_maker_payout_sent", receipt)
    monkeypatch.setattr(email_service, "send_admin_payout_report", report)
    return counts


def mock_paypal(monkeypatch, calls=None):
    calls = calls if calls is not None else []

    async def fake_token(cfg): return "tok"

    class Resp:
        status_code = 201
        text = "{}"
        content = b"{}"
        def json(self):
            return {"batch_header": {"payout_batch_id": "AUTOBATCH-1", "batch_status": "PENDING"}}

    class FakeClient:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, **kw):
            calls.append(kw.get("json"))
            return Resp()

    monkeypatch.setattr(paypal_payouts, "_access_token", fake_token)
    monkeypatch.setattr(paypal_payouts.httpx, "AsyncClient", FakeClient)
    return calls


async def seed_maker(paypal_email="m@paypal.com", **extra):
    slug = f"{PFX}-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({"slug": slug, "name": f"M {slug[-4:]}",
                                "initials": "TM", "location": "Test, US", "bio": "t",
                                "techniques": [], "portrait": "", "cover": "",
                                "email": f"{slug}@example.com",
                                "paypal_email": paypal_email, **extra})
    return slug


async def seed_row(slug, cents, status="deferred", earned_at=OLD, **extra):
    session = f"pp_{PFX}{uuid.uuid4().hex[:10]}"
    await db.maker_payouts.insert_one({
        "session_id": session, "maker_slug": slug, "provider": "paypal",
        "amount_cents": cents, "gross_cents": cents, "commission_cents": 0,
        "status": status, "reason": "paypal-manual-payout",
        "earned_at": earned_at, "updated_at": earned_at, **extra})
    return session


@pytest.mark.asyncio
async def test_disabled_flags_block_engine(monkeypatch):
    monkeypatch.setenv("PAYPAL_AUTOPAYOUT_ENABLED", "false")
    r = await payout_engine.run_automated_payouts(trigger="test")
    assert r["ran"] is False and r["reason"] == "automation_disabled"


@pytest.mark.asyncio
async def test_force_run_pays_eligible_maker(monkeypatch, mails):
    slug = await seed_maker()
    await seed_row(slug, 3000)
    calls = mock_paypal(monkeypatch)
    r = await payout_engine.run_automated_payouts(trigger="test", force=True)
    assert r["ran"] and r["paid_makers"] == 1 and r["total_paid_cents"] == 3000
    assert r["payout_batch_id"] == "AUTOBATCH-1"
    assert len(calls) == 1
    run = await db.paypal_payout_runs.find_one({"id": r["run_id"]}, {"_id": 0})
    assert run["kind"] == "auto" and run["status"] == "submitted"
    row = await db.maker_payouts.find_one({"maker_slug": slug}, {"_id": 0})
    assert row["status"] == "processing" and row["payout_run_id"] == r["run_id"]
    assert mails["receipt"] == 1 and mails["report"] == 1
    led = await db.marketplace_ledger.find_one(
        {"kind": "payout", "maker_slug": slug}, {"_id": 0})
    assert led and led["net_cents"] == 3000 and led["payout_run_id"] == r["run_id"]
    # No duplicates: immediate second cycle finds nothing eligible.
    r2 = await payout_engine.run_automated_payouts(trigger="test", force=True)
    assert r2["paid_makers"] == 0 and len(calls) == 1


@pytest.mark.asyncio
async def test_skip_rules(monkeypatch, mails):
    recent = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    m_hold = await seed_maker(); await seed_row(m_hold, 5000, earned_at=recent)
    m_min = await seed_maker(); await seed_row(m_min, 1000)
    m_noemail = await seed_maker(paypal_email=None); await seed_row(m_noemail, 9000)
    m_manual = await seed_maker(payout_frequency="manual"); await seed_row(m_manual, 9000)
    m_onhold = await seed_maker(payouts_on_hold=True); await seed_row(m_onhold, 9000)
    m_disp = await seed_maker()
    s = await seed_row(m_disp, 9000)
    await db.payment_transactions.insert_one(
        {"session_id": s, "dispute_id": "D-9", "dispute_status": "OPEN"})
    m_perm = await seed_maker()
    await seed_row(m_perm, 9000, status="failed", failure_permanent=True)

    calls = mock_paypal(monkeypatch)
    r = await payout_engine.run_automated_payouts(trigger="test", force=True)
    assert r["paid_makers"] == 0 and len(calls) == 0
    reasons = {x["maker_slug"]: x["reason"] for x in r["skipped"]}
    assert reasons[m_hold] == "inside_hold_period"
    assert reasons[m_min] == "below_minimum"
    assert reasons[m_noemail] == "missing_paypal_email"
    assert reasons[m_manual] == "manual_schedule"
    assert reasons[m_onhold] == "on_hold"
    assert reasons[m_disp] == "open_dispute"
    assert m_perm not in reasons  # permanent failures never retried

    ov = await payout_engine.compute_overview()
    by = {x["maker_slug"]: x for x in ov["makers"] if x["maker_slug"].startswith(PFX)}
    assert by[m_hold]["waiting_hold_cents"] == 5000
    assert by[m_min]["waiting_minimum"] is True
    assert by[m_noemail]["missing_email_cents"] == 9000
    assert by[m_disp]["disputed_cents"] == 9000
    assert by[m_perm]["failed_permanent_cents"] == 9000


@pytest.mark.asyncio
async def test_retryable_failure_included_next_cycle(monkeypatch):
    slug = await seed_maker()
    await seed_row(slug, 4000, status="failed", failure_permanent=False)
    calls = mock_paypal(monkeypatch)
    r = await payout_engine.run_automated_payouts(trigger="test", force=True)
    assert r["paid_makers"] == 1 and r["total_paid_cents"] == 4000 and len(calls) == 1


@pytest.mark.asyncio
async def test_custom_minimum_respected(monkeypatch):
    slug = await seed_maker(payout_min_cents=10000)  # maker raised min to $100
    await seed_row(slug, 5000)
    calls = mock_paypal(monkeypatch)
    r = await payout_engine.run_automated_payouts(trigger="test", force=True)
    reasons = {x["maker_slug"]: x["reason"] for x in r["skipped"]}
    assert reasons[slug] == "below_minimum" and len(calls) == 0


@pytest.mark.asyncio
async def test_restart_safety_recovers_stale_run():
    slug = await seed_maker()
    session = await seed_row(slug, 3000)
    stale_run = "auto-" + uuid.uuid4().hex[:12]
    old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    await db.paypal_payout_runs.insert_one({
        "id": stale_run, "kind": "auto", "status": "created",
        "created_by": "autopayout:test", "created_at": old})
    await db.maker_payouts.update_one(
        {"session_id": session},
        {"$set": {"status": "processing", "payout_run_id": stale_run}})
    n = await payout_engine.recover_stale_runs()
    assert n == 1
    row = await db.maker_payouts.find_one({"session_id": session}, {"_id": 0})
    assert row["status"] == "deferred" and "payout_run_id" not in row
    run = await db.paypal_payout_runs.find_one({"id": stale_run}, {"_id": 0})
    assert run["status"] == "failed"


@pytest.mark.asyncio
async def test_admin_toggle_and_run_now(client, monkeypatch):
    monkeypatch.setenv("PAYPAL_AUTOPAYOUT_ENABLED", "true")
    r = await client.post("/api/admin/paypal/payouts/automation", headers=ADMIN,
                          json={"enabled": True})
    assert r.status_code == 200 and r.json()["enabled"] is True
    r2 = await client.post("/api/admin/paypal/payouts/automation", headers=ADMIN,
                           json={"enabled": False})
    assert r2.json()["enabled"] is False  # instant pause
    slug = await seed_maker()
    await seed_row(slug, 3000)
    rn = await client.post("/api/admin/paypal/payouts/automation/run-now", headers=ADMIN,
                           json={"dry_run": True})
    assert rn.status_code == 200
    d = rn.json()
    assert d["dry_run"] is True and d["paid_makers"] == 1
    row = await db.maker_payouts.find_one({"maker_slug": slug}, {"_id": 0})
    assert row["status"] == "deferred"  # dry run touched nothing


@pytest.mark.asyncio
async def test_maker_settings_validation_and_overview(client):
    slug = await seed_maker()
    await seed_row(slug, 3000)
    tok = {"Authorization": f"Bearer {issue_session_jwt(slug, f'{slug}@example.com')}"}
    r = await client.patch("/api/maker/profile", headers=tok, json={
        "payout_method": "paypal", "payout_frequency": "weekly",
        "payout_min_cents": 100})  # below platform min → clamped
    assert r.status_code == 200
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    assert m["payout_min_cents"] == 2500
    bad = await client.patch("/api/maker/profile", headers=tok,
                             json={"payout_frequency": "hourly"})
    assert bad.status_code == 200
    m2 = await db.makers.find_one({"slug": slug}, {"_id": 0})
    assert m2["payout_frequency"] == "weekly"  # invalid value dropped
    ov = await client.get("/api/maker/payout-overview", headers=tok)
    d = ov.json()
    assert d["available_cents"] == 3000
    assert d["payout_frequency"] == "weekly" and d["hold_days"] == 7
    assert d["next_payout_date"]


@pytest.mark.asyncio
async def test_ledger_idempotent():
    slug = f"{PFX}-ledger"
    await ledger_record("sale", "paypal", "pp_aptestledger1", slug,
                        gross_cents=1000, commission_cents=50, net_cents=950)
    await ledger_record("sale", "paypal", "pp_aptestledger1", slug,
                        gross_cents=9999, commission_cents=1, net_cents=1)
    rows = await db.marketplace_ledger.find(
        {"session_id": "pp_aptestledger1"}, {"_id": 0}).to_list(10)
    assert len(rows) == 1 and rows[0]["gross_cents"] == 1000
    await db.marketplace_ledger.delete_many({"session_id": "pp_aptestledger1"})
