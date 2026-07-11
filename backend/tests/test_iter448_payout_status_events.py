"""iter448 — payout-status event semantics: UNCLAIMED / RETURNED / REFUNDED /
CANCELED with ledger reversal, balance restore, audit trail, idempotency and
reconciliation integration."""
import json
import os
import uuid

import pytest
import pytest_asyncio

os.environ["PAYPAL_ENVIRONMENT"] = "sandbox"
os.environ.setdefault("PAYPAL_CLIENT_ID_SANDBOX", "test-client-id")
os.environ.setdefault("PAYPAL_CLIENT_SECRET_SANDBOX", "test-client-secret")
os.environ.setdefault("PAYPAL_WEBHOOK_ID_SANDBOX", "primary-webhook-id")

from httpx import ASGITransport, AsyncClient  # noqa: E402
from server import app  # noqa: E402
from core import db, now_iso  # noqa: E402
import recon_engine  # noqa: E402
from ledger import ledger_record  # noqa: E402
from routers import paypal_webhooks  # noqa: E402
from routers.paypal_payouts import apply_payout_item_event  # noqa: E402

PFX = "pstest"
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
    async def wipe():
        await db.maker_payouts.delete_many({"maker_slug": {"$regex": f"^{PFX}-"}})
        await db.marketplace_ledger.delete_many({"maker_slug": {"$regex": f"^{PFX}-"}})
        await db.paypal_payout_runs.delete_many({"id": {"$regex": f"^{PFX}"}})
        await db.paypal_webhook_events.delete_many({"event_id": {"$regex": "^WH-PS8-"}})
        await db.audit_log.delete_many({"maker_slug": {"$regex": f"^{PFX}-"}})
    await wipe()
    yield
    await wipe()


@pytest_asyncio.fixture(autouse=True)
def _no_external(monkeypatch):
    async def none_bal():
        return None
    monkeypatch.setattr(recon_engine, "_stripe_balance_cents", none_bal)
    monkeypatch.setattr(recon_engine, "_paypal_balance_cents", none_bal)


async def _seed_processing(cents=3000):
    """A payout in flight: processing row + payout ledger entry (as written
    by _execute_run) + run doc + originating sale entry."""
    run_id = f"{PFX}{uuid.uuid4().hex[:8]}"
    slug = f"{PFX}-{uuid.uuid4().hex[:5]}"
    sid = f"pp_{PFX}{uuid.uuid4().hex[:6]}"
    await ledger_record("sale", "paypal", sid, slug, gross_cents=cents + 300,
                        commission_cents=300, net_cents=cents)
    await db.maker_payouts.insert_one({
        "session_id": sid, "maker_slug": slug, "provider": "paypal",
        "status": "processing", "amount_cents": cents,
        "payout_run_id": run_id, "payout_batch_id": f"BATCH-{run_id}",
        "earned_at": now_iso(), "updated_at": now_iso()})
    await ledger_record("payout", "paypal", f"run:{run_id}", slug,
                        net_cents=cents, payout_run_id=run_id,
                        payout_batch_id=f"BATCH-{run_id}")
    await db.paypal_payout_runs.insert_one({
        "id": run_id, "kind": "batch", "status": "submitted",
        "payout_batch_id": f"BATCH-{run_id}", "created_by": "test448",
        "created_at": now_iso()})
    return run_id, slug, sid


def _item_event(run_id, slug, status, etype=None, eid=None):
    return {
        "id": eid or f"WH-PS8-{uuid.uuid4().hex[:8]}",
        "event_type": etype or f"PAYMENT.PAYOUTS-ITEM.{status}",
        "resource_type": "payouts_item",
        "resource": {"payout_item_id": "ITEM123",
                     "transaction_status": status,
                     "payout_item": {"sender_item_id": f"{run_id}:{slug}"}},
        "summary": "s", "create_time": "2026-07-11T00:00:00Z",
    }


async def _row(slug):
    return await db.maker_payouts.find_one({"maker_slug": slug}, {"_id": 0})


# ── Semantics ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_unclaimed_marks_recoverable_not_failed():
    run_id, slug, _ = await _seed_processing()
    r = await apply_payout_item_event(_item_event(run_id, slug, "UNCLAIMED"))
    assert r == f"payout_item:unclaimed:{slug}"
    row = await _row(slug)
    assert row["status"] == "unclaimed" and row["payout_run_id"] == run_id
    assert row.get("unclaimed_at")
    # no reversal ledger entry yet — funds still claimable
    assert not await db.marketplace_ledger.find_one(
        {"kind": "payout_reversal", "maker_slug": slug})
    # recon flags it as a warning
    rep = await recon_engine.run_nightly_reconciliation(trigger="test448")
    c = next(x for x in rep["checks"] if x["id"] == "payout_status_flags")
    assert not c["ok"] and "unclaimed" in c["detail"]
    assert rep["recon"]["payout_flags"]["unclaimed"]["count"] >= 1
    await db.recon_reports.delete_many({"trigger": "test448"})


@pytest.mark.asyncio
@pytest.mark.parametrize("status,reason", [
    ("RETURNED", "returned"), ("REFUNDED", "refunded"), ("CANCELED", "canceled")])
async def test_reversal_restores_balance_and_ledger(status, reason):
    run_id, slug, _ = await _seed_processing(cents=3000)
    base = await recon_engine.compute_reconciliation()
    r = await apply_payout_item_event(_item_event(run_id, slug, status))
    assert r == f"payout_item:reversed_{reason}:{slug}"
    row = await _row(slug)
    assert row["status"] == "deferred"                       # balance restored
    assert row["payout_returned_reason"] == reason.upper()
    assert row["returned_from_run_id"] == run_id
    assert "payout_run_id" not in row
    led = await db.marketplace_ledger.find_one(
        {"kind": "payout_reversal", "maker_slug": slug}, {"_id": 0})
    assert led and led["net_cents"] == 3000 and led["meta"]["reason"] == reason
    audit = await db.audit_log.find_one(
        {"kind": "paypal_payout_reversed", "maker_slug": slug}, {"_id": 0})
    assert audit and audit["amount_cents"] == 3000 and audit["reason"] == reason
    # reconciliation: ledger + books BOTH gain 3000 → diff unchanged
    after = await recon_engine.compute_reconciliation()
    assert after["ledger"]["outstanding_cents"] == base["ledger"]["outstanding_cents"] + 3000
    assert after["maker_outstanding_cents"] == base["maker_outstanding_cents"] + 3000
    assert after["diff_cents"] == base["diff_cents"]
    assert after["payout_flags"][reason]["count"] >= 1


@pytest.mark.asyncio
async def test_unclaimed_then_returned_full_lifecycle():
    run_id, slug, _ = await _seed_processing(cents=2000)
    await apply_payout_item_event(_item_event(run_id, slug, "UNCLAIMED"))
    assert (await _row(slug))["status"] == "unclaimed"
    r = await apply_payout_item_event(_item_event(run_id, slug, "RETURNED"))
    assert r == f"payout_item:reversed_returned:{slug}"
    assert (await _row(slug))["status"] == "deferred"


@pytest.mark.asyncio
async def test_reversal_is_idempotent_on_redelivery():
    run_id, slug, _ = await _seed_processing(cents=3000)
    ev = _item_event(run_id, slug, "RETURNED")
    await apply_payout_item_event(ev)
    # redelivery (same or different event id) matches nothing — no double restore
    r2 = await apply_payout_item_event(_item_event(run_id, slug, "RETURNED"))
    assert r2 == "recorded_no_matching_payout"
    n = await db.marketplace_ledger.count_documents(
        {"kind": "payout_reversal", "maker_slug": slug})
    assert n == 1
    assert (await _row(slug))["status"] == "deferred"


@pytest.mark.asyncio
async def test_failed_and_blocked_still_fail():
    run_id, slug, _ = await _seed_processing()
    await apply_payout_item_event(_item_event(run_id, slug, "BLOCKED"))
    row = await _row(slug)
    assert row["status"] == "failed" and row["failure_permanent"] is True
    assert not await db.marketplace_ledger.find_one(
        {"kind": "payout_reversal", "maker_slug": slug})


# ── HTTP path: signature + dedupe + env var ─────────────────────────────────

@pytest.mark.asyncio
async def test_http_valid_signature_processes_returned(client, monkeypatch):
    async def ok_verify(cfg, headers, raw):
        return "SUCCESS", {}
    monkeypatch.setattr(paypal_webhooks, "_verify_signature", ok_verify)
    run_id, slug, _ = await _seed_processing()
    ev = _item_event(run_id, slug, "RETURNED", eid="WH-PS8-HTTP1")
    r = await client.post("/api/webhooks/paypal/payout-status",
                          content=json.dumps(ev), headers=SIG)
    assert r.status_code == 200
    assert r.json()["result"] == f"payout_item:reversed_returned:{slug}"
    # duplicate delivery → deduped by event id, no reprocessing
    r2 = await client.post("/api/webhooks/paypal/payout-status",
                           content=json.dumps(ev), headers=SIG)
    assert r2.json()["status"] == "duplicate"
    assert await db.marketplace_ledger.count_documents(
        {"kind": "payout_reversal", "maker_slug": slug}) == 1


@pytest.mark.asyncio
async def test_http_invalid_signature_rejected(client, monkeypatch):
    async def bad_verify(cfg, headers, raw):
        return "FAILURE", {}
    monkeypatch.setattr(paypal_webhooks, "_verify_signature", bad_verify)
    run_id, slug, _ = await _seed_processing()
    ev = _item_event(run_id, slug, "RETURNED", eid="WH-PS8-BAD1")
    r = await client.post("/api/webhooks/paypal/payout-status",
                          content=json.dumps(ev), headers=SIG)
    assert r.status_code == 400
    assert (await _row(slug))["status"] == "processing"  # untouched


@pytest.mark.asyncio
async def test_payout_status_webhook_id_env_var(client, monkeypatch):
    seen = {}

    async def spy_verify(cfg, headers, raw):
        seen["webhook_id"] = cfg["webhook_id"]
        return "SUCCESS", {}
    monkeypatch.setattr(paypal_webhooks, "_verify_signature", spy_verify)
    monkeypatch.setenv("PAYPAL_PAYOUT_STATUS_WEBHOOK_ID", "payout-status-id")
    ev = {"id": "WH-PS8-ENV1", "event_type": "PAYMENT.PAYOUTSBATCH.SUCCESS",
          "resource": {}, "summary": "s", "create_time": "x"}
    await client.post("/api/webhooks/paypal/payout-status",
                      content=json.dumps(ev), headers=SIG)
    assert seen["webhook_id"] == "payout-status-id"
    # primary path unaffected
    ev["id"] = "WH-PS8-ENV2"
    await client.post("/api/webhooks/paypal", content=json.dumps(ev), headers=SIG)
    assert seen["webhook_id"] == os.environ["PAYPAL_WEBHOOK_ID_SANDBOX"]
