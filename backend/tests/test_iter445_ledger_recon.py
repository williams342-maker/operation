"""iter445 — Marketplace Ledger viewer + finance reconciliation tests."""
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
from ledger import ledger_record  # noqa: E402
from maker_auth import issue_session_jwt  # noqa: E402
from routers import finance_ledger  # noqa: E402

PFX = "recontest"
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
    await wipe()
    yield
    await wipe()


@pytest_asyncio.fixture(autouse=True)
def _no_external(monkeypatch):
    async def none_bal():
        return None
    monkeypatch.setattr(finance_ledger, "_stripe_balance_cents", none_bal)
    monkeypatch.setattr(finance_ledger, "_paypal_balance_cents", none_bal)


async def _seed_balanced():
    sid = f"pp_{PFX}{uuid.uuid4().hex[:6]}"
    slug = f"{PFX}-maker"
    await db.makers.insert_one({"slug": slug, "name": "Recon Maker"})
    await ledger_record("sale", "paypal", sid, slug,
                        gross_cents=8400, commission_cents=840, net_cents=7560)
    await db.maker_payouts.insert_one({
        "session_id": sid, "maker_slug": slug, "provider": "paypal",
        "status": "deferred", "amount_cents": 7560, "gross_cents": 8400,
        "commission_cents": 840, "earned_at": now_iso(), "updated_at": now_iso()})
    return sid, slug


@pytest.mark.asyncio
async def test_ledger_endpoint_requires_admin(client):
    r = await client.get("/api/admin/ledger")
    assert r.status_code in (401, 403)
    r = await client.get("/api/admin/finance/reconciliation")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_ledger_lists_entries_with_maker_names(client):
    sid, slug = await _seed_balanced()
    r = await client.get("/api/admin/ledger", headers=ADMIN)
    assert r.status_code == 200
    rows = [e for e in r.json()["entries"] if e["session_id"] == sid]
    assert len(rows) == 1
    e = rows[0]
    assert e["provider"] == "paypal" and e["kind"] == "sale"
    assert e["gross_cents"] == 8400 and e["commission_cents"] == 840 and e["net_cents"] == 7560
    assert e["maker_name"] == "Recon Maker"


@pytest.mark.asyncio
async def test_ledger_filters(client):
    sid, slug = await _seed_balanced()
    await ledger_record("payout", "paypal", f"run:{PFX}{uuid.uuid4().hex[:6]}", slug,
                        net_cents=7560, payout_batch_id="BATCH445")
    r = await client.get("/api/admin/ledger?kind=payout", headers=ADMIN)
    kinds = {e["kind"] for e in r.json()["entries"]}
    assert kinds <= {"payout"}
    r = await client.get("/api/admin/ledger?provider=stripe&kind=sale", headers=ADMIN)
    assert all(e["provider"] == "stripe" for e in r.json()["entries"])


@pytest.mark.asyncio
async def test_reconciliation_balanced_shape(client):
    await _seed_balanced()
    r = await client.get("/api/admin/finance/reconciliation", headers=ADMIN)
    assert r.status_code == 200
    d = r.json()
    for k in ("stripe_balance_cents", "paypal_balance_cents", "ledger",
              "maker_outstanding_cents", "pending_payouts_cents", "paid_today_cents",
              "refunds_cents", "disputes_cents", "diff_cents", "balanced"):
        assert k in d
    # our seeded pair contributes equally to both sides
    assert d["ledger"]["sales_net_cents"] >= 7560
    assert d["maker_outstanding_cents"] >= 7560


@pytest.mark.asyncio
async def test_reconciliation_detects_difference(client):
    sid, slug = await _seed_balanced()
    base = (await client.get("/api/admin/finance/reconciliation", headers=ADMIN)).json()
    # A book row with no matching ledger entry → diff moves by -500
    await db.maker_payouts.insert_one({
        "session_id": f"pp_{PFX}orphan", "maker_slug": slug, "provider": "paypal",
        "status": "deferred", "amount_cents": 500,
        "earned_at": now_iso(), "updated_at": now_iso()})
    d = (await client.get("/api/admin/finance/reconciliation", headers=ADMIN)).json()
    assert d["diff_cents"] == base["diff_cents"] - 500
    assert d["balanced"] is False


@pytest.mark.asyncio
async def test_reconciliation_payout_and_refund_reduce_ledger(client):
    sid, slug = await _seed_balanced()
    base = (await client.get("/api/admin/finance/reconciliation", headers=ADMIN)).json()
    await ledger_record("payout", "paypal", f"run:{PFX}{uuid.uuid4().hex[:6]}", slug, net_cents=1000)
    await ledger_record("refund", "paypal", f"pp_{PFX}ref{uuid.uuid4().hex[:4]}", slug, gross_cents=250)
    d = (await client.get("/api/admin/finance/reconciliation", headers=ADMIN)).json()
    assert d["ledger"]["outstanding_cents"] == base["ledger"]["outstanding_cents"] - 1250


@pytest.mark.asyncio
async def test_admin_orders_include_payout_join(client):
    sid, slug = await _seed_balanced()
    await db.payment_transactions.insert_one({
        "session_id": sid, "payment_provider": "paypal", "payment_status": "paid",
        "amount": 84.0, "created_at": now_iso(),
        "paypal_order_id": "5AB0TEST", "paypal_capture_id": "3XY0TEST"})
    r = await client.get("/api/admin/orders", headers=ADMIN)
    assert r.status_code == 200
    row = next(o for o in r.json() if o["session_id"] == sid)
    assert row["payouts"] and row["payouts"][0]["maker_slug"] == slug
    assert row["payouts"][0]["status"] == "deferred"
    assert row["payouts"][0]["commission_cents"] == 840
