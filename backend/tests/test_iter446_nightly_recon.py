"""iter446 — Nightly reconciliation engine + health score + Fin Ops tests."""
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
import recon_engine  # noqa: E402
from ledger import ledger_record  # noqa: E402
from maker_auth import issue_session_jwt  # noqa: E402

PFX = "nrtest"
ADMIN = {"Authorization": f"Bearer {issue_session_jwt('admin-test', 'team@craftersmarket.org', role='admin')}"}


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def _clean():
    async def wipe():
        await db.marketplace_ledger.delete_many({"session_id": {"$regex": PFX}})
        await db.maker_payouts.delete_many({"maker_slug": {"$regex": f"^{PFX}-"}})
        await db.makers.delete_many({"slug": {"$regex": f"^{PFX}-"}})
        await db.payment_transactions.delete_many({"session_id": {"$regex": PFX}})
        await db.recon_reports.delete_many({"trigger": {"$regex": "^test446"}})
    await wipe()
    yield
    await wipe()


@pytest_asyncio.fixture(autouse=True)
def _no_external(monkeypatch):
    async def none_bal():
        return None
    sent = {"emails": [], "webhooks": []}

    async def fake_email(report):
        sent["emails"].append(report)

    async def fake_webhook(**kw):
        sent["webhooks"].append(kw)
        return {}

    monkeypatch.setattr(recon_engine, "_stripe_balance_cents", none_bal)
    monkeypatch.setattr(recon_engine, "_paypal_balance_cents", none_bal)
    monkeypatch.setattr(email_service, "send_recon_report", fake_email)
    import notify_webhook
    monkeypatch.setattr(notify_webhook, "notify_team", fake_webhook)
    return sent


async def _seed_pair(cents=5000, slug=None):
    """A book row + matching sale ledger entry (self-balancing)."""
    sid = f"pp_{PFX}{uuid.uuid4().hex[:6]}"
    slug = slug or f"{PFX}-{uuid.uuid4().hex[:5]}"
    await db.makers.insert_one({"slug": slug, "name": slug})
    await ledger_record("sale", "paypal", sid, slug, gross_cents=cents + 500,
                        commission_cents=500, net_cents=cents)
    await db.payment_transactions.insert_one({
        "session_id": sid, "payment_provider": "paypal", "payment_status": "paid",
        "amount": (cents + 500) / 100, "created_at": now_iso()})
    await db.maker_payouts.insert_one({
        "session_id": sid, "maker_slug": slug, "provider": "paypal",
        "status": "deferred", "amount_cents": cents,
        "earned_at": now_iso(), "updated_at": now_iso()})
    return sid, slug


def _check(report, cid):
    return next(c for c in report["checks"] if c["id"] == cid)


@pytest.mark.asyncio
async def test_report_persisted_and_email_sent(_no_external):
    await _seed_pair()
    r = await recon_engine.run_nightly_reconciliation(trigger="test446")
    assert r["status"] in ("balanced", "alert")
    assert 0 <= r["score"] <= 100
    assert len(r["checks"]) == 9
    stored = await db.recon_reports.find_one({"id": r["id"]}, {"_id": 0})
    assert stored and stored["trigger"] == "test446"
    assert len(_no_external["emails"]) == 1


@pytest.mark.asyncio
async def test_seeded_pair_does_not_create_new_issues(_no_external):
    base = await recon_engine.run_nightly_reconciliation(trigger="test446")
    await _seed_pair()
    r = await recon_engine.run_nightly_reconciliation(trigger="test446")
    assert r["recon"]["diff_cents"] == base["recon"]["diff_cents"]
    assert r["score"] == base["score"]


@pytest.mark.asyncio
async def test_legacy_row_detected_and_explained(_no_external):
    base = await recon_engine.run_nightly_reconciliation(trigger="test446")
    base_legacy = _check(base, "legacy_unreconciled")
    sid = f"pp_{PFX}legacy"
    slug = f"{PFX}-legacy"
    await db.payment_transactions.insert_one({
        "session_id": sid, "payment_provider": "paypal", "payment_status": "paid",
        "amount": 10.0, "created_at": now_iso()})
    await db.maker_payouts.insert_one({
        "session_id": sid, "maker_slug": slug, "provider": "paypal",
        "status": "deferred", "amount_cents": 1000,
        "earned_at": now_iso(), "updated_at": now_iso()})
    r = await recon_engine.run_nightly_reconciliation(trigger="test446")
    c = _check(r, "legacy_unreconciled")
    assert not c["ok"]
    assert f"{sid}·{slug}" in c["detail"] or "row(s)" in c["detail"]
    assert r["recon"]["diff_cents"] == base["recon"]["diff_cents"] - 1000
    assert r["status"] == "alert"
    assert r["score"] < 100
    _ = base_legacy


@pytest.mark.asyncio
async def test_negative_and_duplicate_and_orphan_checks(_no_external):
    sid, slug = await _seed_pair()
    # negative
    await db.maker_payouts.insert_one({
        "session_id": f"pp_{PFX}neg", "maker_slug": slug, "provider": "paypal",
        "status": "paid", "amount_cents": -100, "paid_at": now_iso(),
        "earned_at": now_iso(), "updated_at": now_iso()})
    # duplicate (same session+maker twice)
    await db.maker_payouts.insert_one({
        "session_id": sid, "maker_slug": slug, "provider": "paypal",
        "status": "paid", "amount_cents": 100, "paid_at": now_iso(),
        "earned_at": now_iso(), "updated_at": now_iso()})
    # orphan paid paypal order with no commission rows
    await db.payment_transactions.insert_one({
        "session_id": f"pp_{PFX}orphan", "payment_provider": "paypal",
        "payment_status": "paid", "amount": 5.0, "created_at": now_iso()})
    r = await recon_engine.run_nightly_reconciliation(trigger="test446")
    assert not _check(r, "negative_balances")["ok"]
    assert not _check(r, "duplicate_payouts")["ok"]
    assert not _check(r, "orphan_transactions")["ok"]
    assert r["status"] == "alert" and r["score"] < 100
    # alert fires the team webhook
    assert len(_no_external["webhooks"]) >= 1


@pytest.mark.asyncio
async def test_failed_payout_check(_no_external):
    _, slug = await _seed_pair()
    await db.maker_payouts.insert_one({
        "session_id": f"pp_{PFX}fail", "maker_slug": slug, "provider": "paypal",
        "status": "failed", "failure_permanent": True, "amount_cents": 700,
        "earned_at": now_iso(), "updated_at": now_iso()})
    r = await recon_engine.run_nightly_reconciliation(trigger="test446")
    c = _check(r, "failed_payouts")
    assert not c["ok"] and "permanent" in c["detail"]


@pytest.mark.asyncio
async def test_endpoints(client, _no_external):
    await _seed_pair()
    r = await client.post("/api/admin/finance/reconciliation/run", headers=ADMIN)
    assert r.status_code == 200
    rep = r.json()
    assert rep["trigger"].startswith("admin:") and len(rep["checks"]) == 9

    r = await client.get("/api/admin/finance/recon-reports", headers=ADMIN)
    assert r.status_code == 200
    assert any(x["id"] == rep["id"] for x in r.json()["reports"])

    r = await client.get("/api/admin/finance/ops-dashboard", headers=ADMIN)
    assert r.status_code == 200
    d = r.json()
    for k in ("gmv_today_cents", "orders_today", "commission_today_cents",
              "stripe_balance_cents", "paypal_balance_cents",
              "deferred_maker_balances_cents", "upcoming_payouts_cents",
              "failed_payouts", "disputes_cents", "health", "automation",
              "next_payout_run_at", "largest_outstanding",
              "makers_missing_paypal_email", "makers_below_minimum",
              "weekly_payout_forecast_cents", "diff_cents", "balanced"):
        assert k in d
    assert d["health"] is not None  # the run above persisted a report

    r = await client.get("/api/admin/finance/ops-dashboard")
    assert r.status_code in (401, 403)
    r = await client.post("/api/admin/finance/reconciliation/run")
    assert r.status_code in (401, 403)
