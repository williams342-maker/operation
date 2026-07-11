"""iter440 — PayPal order-pipeline parity tests.

Covers: successful order, duplicate webhook, duplicate capture callback,
inventory decrement once only, email once only, commission once only,
refund, reversal, amount mismatch, missing internal order, multi-item,
multi-maker.
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
from routers import paypal_webhooks  # noqa: E402
import routers.push as push_mod  # noqa: E402
from routers.paypal_finalize import (  # noqa: E402
    finalize_paypal_order, record_paypal_fees,
)

PFX = "pptest"

SIG_HEADERS = {
    "paypal-transmission-id": "t-id",
    "paypal-transmission-time": "2026-07-11T00:00:00Z",
    "paypal-transmission-sig": "sig",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
    "paypal-auth-algo": "SHA256withRSA",
}


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def _clean():
    async def wipe():
        await db.products.delete_many({"slug": {"$regex": f"^{PFX}-"}})
        await db.makers.delete_many({"slug": {"$regex": f"^{PFX}-"}})
        await db.paypal_orders.delete_many({"id": {"$regex": f"^{PFX}"}})
        await db.payment_transactions.delete_many({"session_id": {"$regex": f"^pp_{PFX}"}})
        await db.maker_payouts.delete_many({"session_id": {"$regex": f"^pp_{PFX}"}})
        await db.paypal_webhook_events.delete_many({"event_id": {"$regex": "^WH-PAR-"}})
        await db.activity_events.delete_many({"session_id": {"$regex": f"^pp_{PFX}"}})
    await wipe()
    yield
    await wipe()


@pytest.fixture(autouse=True)
def mails(monkeypatch):
    """Count every outbound email + silence admin push."""
    counts = {"buyer": 0, "ops": 0, "maker": 0, "low_stock": 0, "digital": 0}

    async def buyer(*a, **k): counts["buyer"] += 1
    async def ops(*a, **k): counts["ops"] += 1
    async def maker(*a, **k): counts["maker"] += 1
    async def low(*a, **k): counts["low_stock"] += 1
    async def digital(*a, **k): counts["digital"] += 1
    async def push(*a, **k): return None

    monkeypatch.setattr(email_service, "send_buyer_receipt", buyer)
    monkeypatch.setattr(email_service, "send_ops_new_order", ops)
    monkeypatch.setattr(email_service, "send_maker_new_order", maker)
    monkeypatch.setattr(email_service, "send_maker_low_stock", low)
    monkeypatch.setattr(email_service, "send_buyer_digital_downloads", digital)
    monkeypatch.setattr(push_mod, "notify_admins_new_order", push)
    return counts


@pytest.fixture
def verify_success(monkeypatch):
    async def fake(cfg, headers, event):
        return "SUCCESS", {"response_status": 200}
    monkeypatch.setattr(paypal_webhooks, "_verify_signature", fake)


async def seed_maker(n=1):
    slug = f"{PFX}-maker-{n}-{uuid.uuid4().hex[:6]}"
    await db.makers.insert_one({"slug": slug, "name": f"Test Maker {n}",
                                "email": f"{slug}@example.com"})
    return slug


async def seed_product(maker_slug, price=16.95, stock=10):
    pid = uuid.uuid4().hex
    slug = f"{PFX}-prod-{uuid.uuid4().hex[:8]}"
    await db.products.insert_one({
        "id": pid, "slug": slug, "title": f"Test Item {slug[-4:]}",
        "price": price, "maker_slug": maker_slug, "in_stock": stock,
        "status": "published", "listing_type": "physical",
    })
    return pid, slug


async def seed_pp_order(cart, total_cents, capture_id=None, **extra):
    internal = f"{PFX}{uuid.uuid4().hex[:12]}"
    item_total = sum(int(round(c["price"] * 100)) * c["quantity"] for c in cart)
    await db.paypal_orders.insert_one({
        "id": internal,
        "paypal_order_id": f"PPORD-{internal[-8:]}",
        "environment": "sandbox",
        "status": "captured" if capture_id else "created",
        "capture_id": capture_id,
        "items": [{"product_id": c["product_id"], "title": c["title"],
                   "price": c["price"], "quantity": c["quantity"],
                   "maker_slug": c["maker_slug"]} for c in cart],
        "cart_items": [{"product_id": c["product_id"], "quantity": c["quantity"]}
                       for c in cart],
        "summary": " | ".join(f"{c['title']} × {c['quantity']}" for c in cart),
        "quote": {"subtotal": item_total / 100.0, "shipping": 0.0,
                  "total_before_tax": total_cents / 100.0, "digital_only": False},
        "amounts_cents": {"item_total": item_total, "shipping": 0,
                          "discount": 0, "total": total_cents},
        "customer_email": "buyer@example.com",
        "payer_email": "buyer@example.com",
        "reconciled": False,
        "created_at": now_iso(),
        **extra,
    })
    return internal


async def one_item_order(price=16.95, stock=10, qty=1):
    maker = await seed_maker()
    pid, slug = await seed_product(maker, price=price, stock=stock)
    cart = [{"product_id": pid, "title": "Steel Test Flag", "price": price,
             "quantity": qty, "maker_slug": maker}]
    internal = await seed_pp_order(cart, int(round(price * 100)) * qty,
                                   capture_id=f"CAP-{uuid.uuid4().hex[:8]}")
    return internal, pid, slug, maker


# ─────────────────────────── happy path ────────────────────────────────────

@pytest.mark.asyncio
async def test_successful_order_full_pipeline(mails):
    internal, pid, slug, maker = await one_item_order()
    res = await finalize_paypal_order(internal, trigger="test", captured_amount_cents=1695)
    assert res == "finalized"

    tx = await db.payment_transactions.find_one({"session_id": f"pp_{internal}"}, {"_id": 0})
    assert tx and tx["payment_status"] == "paid"
    assert tx["payment_provider"] == "paypal"
    assert tx["paypal_capture_id"].startswith("CAP-")
    assert tx["amount"] == 16.95

    prod = await db.products.find_one({"slug": slug}, {"_id": 0})
    assert prod["in_stock"] == 9  # decremented exactly once

    payout = await db.maker_payouts.find_one(
        {"session_id": f"pp_{internal}", "maker_slug": maker}, {"_id": 0})
    assert payout and payout["provider"] == "paypal"
    assert payout["status"] == "deferred"
    # Commission from GROSS sale amount — same policy as Stripe (5% default).
    assert payout["gross_cents"] == 1695
    assert payout["commission_cents"] == int(round(1695 * payout["commission_bps"] / 10000))

    assert mails["buyer"] == 1 and mails["ops"] == 1 and mails["maker"] == 1


@pytest.mark.asyncio
async def test_paypal_fees_recorded():
    internal, *_ = await one_item_order()
    await finalize_paypal_order(internal, trigger="test")
    await record_paypal_fees(internal, {
        "gross_amount": {"currency_code": "USD", "value": "16.95"},
        "paypal_fee": {"currency_code": "USD", "value": "1.08"},
        "net_amount": {"currency_code": "USD", "value": "15.87"},
    })
    order = await db.paypal_orders.find_one({"id": internal}, {"_id": 0})
    tx = await db.payment_transactions.find_one({"session_id": f"pp_{internal}"}, {"_id": 0})
    for doc in (order, tx):
        assert doc["paypal_fees"]["gross_cents"] == 1695
        assert doc["paypal_fees"]["paypal_fee_cents"] == 108
        assert doc["paypal_fees"]["net_cents"] == 1587


# ─────────────────────────── idempotency ───────────────────────────────────

@pytest.mark.asyncio
async def test_finalize_idempotent_stock_emails_commission_once(mails):
    internal, pid, slug, maker = await one_item_order()
    r1 = await finalize_paypal_order(internal, trigger="capture_callback")
    r2 = await finalize_paypal_order(internal, trigger="capture_callback_repeat")
    r3 = await finalize_paypal_order(internal, trigger="webhook:PAYMENT.CAPTURE.COMPLETED")
    assert r1 == "finalized" and r2 == "already_finalized" and r3 == "already_finalized"

    prod = await db.products.find_one({"slug": slug}, {"_id": 0})
    assert prod["in_stock"] == 9  # once only
    assert mails["buyer"] == 1 and mails["maker"] == 1 and mails["ops"] == 1  # once only
    assert await db.maker_payouts.count_documents({"session_id": f"pp_{internal}"}) == 1
    assert await db.payment_transactions.count_documents({"session_id": f"pp_{internal}"}) == 1


@pytest.mark.asyncio
async def test_duplicate_capture_callback_no_double_side_effects(client, mails):
    internal, pid, slug, maker = await one_item_order()
    doc = await db.paypal_orders.find_one({"id": internal}, {"_id": 0})
    # First finalize (as the real capture endpoint would have done).
    await finalize_paypal_order(internal, trigger="capture_callback")
    # Buyer's browser retries the capture callback — order already captured.
    r = await client.post(f"/api/paypal/checkout/orders/{doc['paypal_order_id']}/capture")
    assert r.status_code == 200
    assert r.json()["status"] == "captured"
    prod = await db.products.find_one({"slug": slug}, {"_id": 0})
    assert prod["in_stock"] == 9
    assert mails["buyer"] == 1


@pytest.mark.asyncio
async def test_duplicate_webhook_processed_once(client, verify_success, mails):
    internal, pid, slug, maker = await one_item_order()
    doc = await db.paypal_orders.find_one({"id": internal}, {"_id": 0})
    ev = {
        "id": f"WH-PAR-{uuid.uuid4().hex[:10]}",
        "event_type": "PAYMENT.CAPTURE.COMPLETED",
        "resource_type": "capture",
        "create_time": now_iso(),
        "resource": {"id": doc["capture_id"], "custom_id": internal,
                     "status": "COMPLETED",
                     "amount": {"currency_code": "USD", "value": "16.95"},
                     "seller_receivable_breakdown": {
                         "gross_amount": {"value": "16.95"},
                         "paypal_fee": {"value": "1.08"},
                         "net_amount": {"value": "15.87"}}},
    }
    r1 = await client.post("/api/webhooks/paypal", json=ev, headers=SIG_HEADERS)
    r2 = await client.post("/api/webhooks/paypal", json=ev, headers=SIG_HEADERS)
    assert r1.status_code == 200 and r1.json()["result"] == f"reconciled:{internal}:finalized"
    assert r2.status_code == 200 and r2.json()["status"] == "duplicate"

    prod = await db.products.find_one({"slug": slug}, {"_id": 0})
    assert prod["in_stock"] == 9
    assert mails["buyer"] == 1
    order = await db.paypal_orders.find_one({"id": internal}, {"_id": 0})
    assert order["reconciled"] is True
    assert order["paypal_fees"]["paypal_fee_cents"] == 108


# ─────────────────────────── failure paths ──────────────────────────────────

@pytest.mark.asyncio
async def test_amount_mismatch_blocks_finalize(mails):
    internal, pid, slug, maker = await one_item_order()
    res = await finalize_paypal_order(internal, trigger="test", captured_amount_cents=1000)
    assert res.startswith("amount_mismatch:")
    order = await db.paypal_orders.find_one({"id": internal}, {"_id": 0})
    assert order["status"] == "amount_mismatch"
    assert order["amount_mismatch"]["captured_cents"] == 1000
    # No downstream side effects.
    assert await db.payment_transactions.count_documents({"session_id": f"pp_{internal}"}) == 0
    prod = await db.products.find_one({"slug": slug}, {"_id": 0})
    assert prod["in_stock"] == 10
    assert mails["buyer"] == 0
    # Later retries stay blocked even without an amount.
    assert await finalize_paypal_order(internal, trigger="retry") == "amount_mismatch_blocked"


@pytest.mark.asyncio
async def test_missing_internal_order(client, verify_success):
    assert await finalize_paypal_order("nope-unknown") == "missing_internal_order"
    ev = {
        "id": f"WH-PAR-{uuid.uuid4().hex[:10]}",
        "event_type": "PAYMENT.CAPTURE.COMPLETED",
        "resource_type": "capture",
        "create_time": now_iso(),
        "resource": {"id": "CAP-none", "custom_id": "unknown-internal-id",
                     "amount": {"value": "9.99"}},
    }
    r = await client.post("/api/webhooks/paypal", json=ev, headers=SIG_HEADERS)
    assert r.status_code == 200
    assert r.json()["result"] == "recorded_no_matching_order"


# ─────────────────────────── refund / reversal ──────────────────────────────

async def _post_refund_like(client, internal, etype):
    ev = {
        "id": f"WH-PAR-{uuid.uuid4().hex[:10]}",
        "event_type": etype,
        "resource_type": "refund" if "REFUND" in etype else "capture",
        "create_time": now_iso(),
        "resource": {"id": f"RF-{uuid.uuid4().hex[:8]}", "custom_id": internal,
                     "amount": {"currency_code": "USD", "value": "16.95"}},
    }
    return await client.post("/api/webhooks/paypal", json=ev, headers=SIG_HEADERS)


@pytest.mark.asyncio
async def test_refund_webhook_updates_everything(client, verify_success):
    internal, *_ = await one_item_order()
    await finalize_paypal_order(internal, trigger="test")
    r = await _post_refund_like(client, internal, "PAYMENT.CAPTURE.REFUNDED")
    assert r.status_code == 200 and r.json()["result"] == f"refunded:{internal}"
    order = await db.paypal_orders.find_one({"id": internal}, {"_id": 0})
    tx = await db.payment_transactions.find_one({"session_id": f"pp_{internal}"}, {"_id": 0})
    payout = await db.maker_payouts.find_one({"session_id": f"pp_{internal}"}, {"_id": 0})
    assert order["status"] == "refunded"
    assert tx["refund_status"] == "refunded" and tx["refund_amount"] == 16.95
    assert payout["status"] == "cancelled"


@pytest.mark.asyncio
async def test_reversal_webhook(client, verify_success):
    internal, *_ = await one_item_order()
    await finalize_paypal_order(internal, trigger="test")
    r = await _post_refund_like(client, internal, "PAYMENT.CAPTURE.REVERSED")
    assert r.status_code == 200 and r.json()["result"] == f"reversed:{internal}"
    tx = await db.payment_transactions.find_one({"session_id": f"pp_{internal}"}, {"_id": 0})
    assert tx["refund_status"] == "reversed"
    order = await db.paypal_orders.find_one({"id": internal}, {"_id": 0})
    assert order["status"] == "reversed"


@pytest.mark.asyncio
async def test_dispute_webhook(client, verify_success):
    internal, *_ = await one_item_order()
    doc = await db.paypal_orders.find_one({"id": internal}, {"_id": 0})
    await finalize_paypal_order(internal, trigger="test")
    ev = {
        "id": f"WH-PAR-{uuid.uuid4().hex[:10]}",
        "event_type": "CUSTOMER.DISPUTE.CREATED",
        "resource_type": "dispute",
        "create_time": now_iso(),
        "resource": {"dispute_id": "PP-D-123", "status": "OPEN",
                     "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                     "disputed_transactions": [
                         {"seller_transaction_id": doc["capture_id"]}]},
    }
    r = await client.post("/api/webhooks/paypal", json=ev, headers=SIG_HEADERS)
    assert r.status_code == 200 and r.json()["result"] == f"dispute:{internal}"
    tx = await db.payment_transactions.find_one({"session_id": f"pp_{internal}"}, {"_id": 0})
    assert tx["dispute_id"] == "PP-D-123" and tx["dispute_status"] == "OPEN"


# ─────────────────────────── multi-item / multi-maker ───────────────────────

@pytest.mark.asyncio
async def test_multi_item_order(mails):
    maker = await seed_maker()
    p1, s1 = await seed_product(maker, price=10.00, stock=5)
    p2, s2 = await seed_product(maker, price=4.50, stock=8)
    cart = [
        {"product_id": p1, "title": "Item A", "price": 10.00, "quantity": 2, "maker_slug": maker},
        {"product_id": p2, "title": "Item B", "price": 4.50, "quantity": 3, "maker_slug": maker},
    ]
    internal = await seed_pp_order(cart, 3350, capture_id=f"CAP-{uuid.uuid4().hex[:8]}")
    assert await finalize_paypal_order(internal, trigger="test", captured_amount_cents=3350) == "finalized"
    prod1 = await db.products.find_one({"slug": s1}, {"_id": 0})
    prod2 = await db.products.find_one({"slug": s2}, {"_id": 0})
    assert prod1["in_stock"] == 3 and prod2["in_stock"] == 5
    tx = await db.payment_transactions.find_one({"session_id": f"pp_{internal}"}, {"_id": 0})
    assert len(tx["items"]) == 2
    # Single maker → single payout row, single maker email.
    assert await db.maker_payouts.count_documents({"session_id": f"pp_{internal}"}) == 1
    assert mails["maker"] == 1 and mails["buyer"] == 1


@pytest.mark.asyncio
async def test_multi_maker_cart(mails):
    m1, m2 = await seed_maker(1), await seed_maker(2)
    p1, s1 = await seed_product(m1, price=20.00, stock=5)
    p2, s2 = await seed_product(m2, price=15.00, stock=5)
    cart = [
        {"product_id": p1, "title": "Maker1 Item", "price": 20.00, "quantity": 1, "maker_slug": m1},
        {"product_id": p2, "title": "Maker2 Item", "price": 15.00, "quantity": 1, "maker_slug": m2},
    ]
    internal = await seed_pp_order(cart, 3500, capture_id=f"CAP-{uuid.uuid4().hex[:8]}")
    assert await finalize_paypal_order(internal, trigger="test", captured_amount_cents=3500) == "finalized"
    payouts = await db.maker_payouts.find(
        {"session_id": f"pp_{internal}"}, {"_id": 0}).to_list(10)
    assert len(payouts) == 2
    by_slug = {p["maker_slug"]: p for p in payouts}
    assert by_slug[m1]["gross_cents"] == 2000 and by_slug[m2]["gross_cents"] == 1500
    for p in payouts:  # commission always from each maker's gross
        assert p["commission_cents"] == int(round(p["gross_cents"] * p["commission_bps"] / 10000))
    assert mails["maker"] == 2  # one order email per maker
    assert mails["buyer"] == 1  # single buyer receipt
