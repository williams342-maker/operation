"""iter459 — Order Cancellation & Resolution Workflow (backend tests).

Covers every backend bullet from the review request:
  • public reasons endpoint shape
  • maker cancel guards (invalid reason, short 'other' explanation, missing order,
    other-maker JWT → 403, shipped → 409, no auth → 401/403)
  • maker refund-failure path against a fake Stripe session (409 + refund_failed +
    duplicate-cancel guard)
  • admin reopen (before refund) + guard against reopening canceled_refunded
  • admin no-refund cancel (mandatory internal_note, timeline, inventory restore,
    duplicate-cancel guard)
  • restore_inventory:false path
  • PATCH cancellation reason (edit, invalid, 404)
  • cancellation-stats endpoint + admin gate
  • GET /api/maker/orders returns cancellation + order_total fields
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone

import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")

# From review request
MAKER_JWT = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJzdWIiOiJpcm9uLWFuZC1vYWsiLCJlbWFpbCI6Imlyb24tYW5kLW9ha0BjcmFmdGVyc21hcmtldC5vcmciLCJyb2xlIjoibWFrZXIiLCJzdiI6MCwiaWF0IjoxNzg0MDY4MjY5LCJleHAiOjE3ODQ2NzMwNjl9."
    "rVrYhSlxVTEPbna_soVN8s5YjxupE2Y1f4MHtAWwKKg"
)


def _mint_other_maker_jwt() -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt("kiln-and-clay", "kiln-and-clay@craftersmarket.org")


def _mint_admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token
    magic = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": magic}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


ADMIN_JWT: str = ""
OTHER_MAKER_JWT: str = ""

SID_1 = "cs_test_agent1"
SID_2 = "cs_test_agent2"
PRODUCT_SLUG = "mountain-range-silhouette"
MAKER_SLUG = "iron-and-oak"


# ── DB helpers via motor (sync-friendly here) ────────────────────────────────
def _mongo():
    from pymongo import MongoClient
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    return MongoClient(mongo_url)[db_name]


def _seed_paid_order(session_id: str, *, amount: float = 84.0):
    db = _mongo()
    now = datetime.now(timezone.utc).isoformat()
    db.payment_transactions.delete_one({"session_id": session_id})
    db.payment_transactions.insert_one({
        "session_id": session_id,
        "payment_status": "paid",
        "payment_provider": "stripe",
        "amount": amount,
        "customer_email": "buyer-test@example.com",
        "created_at": now,
        "items": [{"product_id": PRODUCT_SLUG, "quantity": 2, "maker_slug": MAKER_SLUG}],
        "order_status": "pending",
    })


def _reset_product_stock(qty: int = 4):
    db = _mongo()
    db.products.update_one({"$or": [{"id": PRODUCT_SLUG}, {"slug": PRODUCT_SLUG}]},
                           {"$set": {"in_stock": qty, "tracks_inventory": True}})


def _get_stock() -> int:
    db = _mongo()
    p = db.products.find_one({"$or": [{"id": PRODUCT_SLUG}, {"slug": PRODUCT_SLUG}]},
                             {"_id": 0, "in_stock": 1})
    return int(p.get("in_stock") if p else 0)


def _get_tx(sid: str) -> dict:
    db = _mongo()
    return db.payment_transactions.find_one({"session_id": sid}, {"_id": 0}) or {}


def _set_tx(sid: str, patch: dict):
    db = _mongo()
    db.payment_transactions.update_one({"session_id": sid}, {"$set": patch})


# ── Fixtures ─────────────────────────────────────────────────────────────────
@pytest.fixture(scope="session", autouse=True)
def _bootstrap_and_cleanup():
    global ADMIN_JWT, OTHER_MAKER_JWT
    ADMIN_JWT = _mint_admin_jwt()
    OTHER_MAKER_JWT = _mint_other_maker_jwt()
    _reset_product_stock(4)
    _seed_paid_order(SID_1)
    yield
    # Teardown — remove seeded orders + any leftovers, restore stock
    db = _mongo()
    db.payment_transactions.delete_many({"session_id": {"$in": [SID_1, SID_2]}})
    _reset_product_stock(4)


def _hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ─── 1. Public reasons endpoint ──────────────────────────────────────────────
class TestReasons:
    def test_reasons_shape(self):
        r = requests.get(f"{BASE_URL}/api/orders/cancel-reasons", timeout=15)
        assert r.status_code == 200
        data = r.json()
        groups = data["groups"]
        gids = [g["id"] for g in groups]
        assert set(gids) == {"inventory", "production", "customer",
                             "mutual", "shipping", "other"}
        total = sum(len(g["reasons"]) for g in groups)
        assert total == 16, f"expected 16 reasons, got {total}"


# ─── 2. Maker cancel guards ──────────────────────────────────────────────────
class TestMakerGuards:
    def test_no_auth_rejected(self):
        r = requests.post(f"{BASE_URL}/api/maker/orders/{SID_1}/cancel",
                          json={"reason": "buyer-requested"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_invalid_reason(self):
        r = requests.post(f"{BASE_URL}/api/maker/orders/{SID_1}/cancel",
                          headers=_hdr(MAKER_JWT),
                          json={"reason": "not-a-real-reason"}, timeout=15)
        assert r.status_code == 400

    def test_other_short_explanation(self):
        r = requests.post(f"{BASE_URL}/api/maker/orders/{SID_1}/cancel",
                          headers=_hdr(MAKER_JWT),
                          json={"reason": "other", "explanation": "x"}, timeout=15)
        assert r.status_code == 400

    def test_order_not_found(self):
        r = requests.post(f"{BASE_URL}/api/maker/orders/cs_test_missing_xyz/cancel",
                          headers=_hdr(MAKER_JWT),
                          json={"reason": "buyer-requested"}, timeout=15)
        assert r.status_code == 404

    def test_other_maker_forbidden(self):
        r = requests.post(f"{BASE_URL}/api/maker/orders/{SID_1}/cancel",
                          headers=_hdr(OTHER_MAKER_JWT),
                          json={"reason": "buyer-requested"}, timeout=15)
        assert r.status_code == 403

    def test_shipped_order_409(self):
        _set_tx(SID_1, {"order_status": "fulfilled"})
        try:
            r = requests.post(f"{BASE_URL}/api/maker/orders/{SID_1}/cancel",
                              headers=_hdr(MAKER_JWT),
                              json={"reason": "buyer-requested"}, timeout=15)
            assert r.status_code == 409
        finally:
            _set_tx(SID_1, {"order_status": "pending"})


# ─── 3. Refund-failure path (fake Stripe session) ────────────────────────────
class TestRefundFailure:
    def test_refund_fails_and_keeps_open(self):
        # ensure clean state
        _set_tx(SID_1, {"cancellation": None, "order_status": "pending"})
        r = requests.post(f"{BASE_URL}/api/maker/orders/{SID_1}/cancel",
                          headers=_hdr(MAKER_JWT),
                          json={"reason": "equipment-failure",
                                "note_to_buyer": "Sorry"}, timeout=30)
        assert r.status_code == 409, f"expected 409 refund failed, got {r.status_code}: {r.text[:200]}"
        assert "refund" in r.text.lower()

        tx = _get_tx(SID_1)
        cxl = tx.get("cancellation") or {}
        assert cxl.get("status") == "refund_failed", f"cxl.status={cxl.get('status')}"
        events = [t.get("event") for t in cxl.get("timeline") or []]
        assert "cancel_requested" in events
        assert "refund_failed" in events
        # Order stays open
        assert tx.get("order_status") != "canceled"

    def test_duplicate_cancel_guarded(self):
        r = requests.post(f"{BASE_URL}/api/maker/orders/{SID_1}/cancel",
                          headers=_hdr(MAKER_JWT),
                          json={"reason": "equipment-failure"}, timeout=15)
        # refund_failed is in ACTIVE_STATUSES so lock rejects
        assert r.status_code == 409


# ─── 4. Admin reopen ─────────────────────────────────────────────────────────
class TestAdminReopen:
    def test_reopen_from_refund_failed(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/orders/{SID_1}/cancellation/reopen",
            headers=_hdr(ADMIN_JWT), timeout=15)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data["ok"] is True
        assert data["order_status"] == "pending"
        tx = _get_tx(SID_1)
        assert tx.get("cancellation") in (None, {}), tx.get("cancellation")

    def test_reopen_canceled_refunded_rejected(self):
        # simulate a successful refund state via direct DB write
        _set_tx(SID_1, {
            "cancellation": {"status": "canceled_refunded",
                             "reason": "buyer-requested",
                             "timeline": []},
            "order_status": "canceled",
        })
        try:
            r = requests.post(
                f"{BASE_URL}/api/admin/orders/{SID_1}/cancellation/reopen",
                headers=_hdr(ADMIN_JWT), timeout=15)
            assert r.status_code == 409
        finally:
            _set_tx(SID_1, {"cancellation": None, "order_status": "pending"})


# ─── 5. Admin no-refund cancel ───────────────────────────────────────────────
class TestAdminNoRefund:
    def test_note_required_400(self):
        r = requests.post(f"{BASE_URL}/api/admin/orders/{SID_1}/cancel",
                          headers=_hdr(ADMIN_JWT),
                          json={"reason": "other",
                                "explanation": "chargeback dispute",
                                "mode": "no_refund",
                                "internal_note": ""}, timeout=15)
        assert r.status_code == 400

    def test_no_refund_success_restores_inventory(self):
        _reset_product_stock(4)
        stock_before = _get_stock()
        assert stock_before == 4

        r = requests.post(f"{BASE_URL}/api/admin/orders/{SID_1}/cancel",
                          headers=_hdr(ADMIN_JWT),
                          json={"reason": "other",
                                "explanation": "chargeback dispute",
                                "mode": "no_refund",
                                "internal_note": "resolved via chargeback"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        tx = _get_tx(SID_1)
        cxl = tx.get("cancellation") or {}
        assert cxl.get("status") == "canceled_no_refund", cxl.get("status")
        assert tx.get("order_status") == "canceled"
        events = [t.get("event") for t in cxl.get("timeline") or []]
        for expected in ("cancel_requested", "inventory_restored", "buyer_notified", "closed"):
            assert expected in events, f"missing {expected} in {events}"
        # Stock 4 → 6 (qty 2)
        assert _get_stock() == 6, f"stock is {_get_stock()}, expected 6"

    def test_duplicate_cancel_after_success_409(self):
        r = requests.post(f"{BASE_URL}/api/admin/orders/{SID_1}/cancel",
                          headers=_hdr(ADMIN_JWT),
                          json={"reason": "buyer-requested",
                                "mode": "no_refund",
                                "internal_note": "again"}, timeout=15)
        assert r.status_code == 409


# ─── 6. restore_inventory:false path ─────────────────────────────────────────
class TestNoRestore:
    def test_inventory_unchanged(self):
        _reset_product_stock(4)
        _seed_paid_order(SID_2)
        stock_before = _get_stock()
        r = requests.post(f"{BASE_URL}/api/admin/orders/{SID_2}/cancel",
                          headers=_hdr(ADMIN_JWT),
                          json={"reason": "damaged-before-shipment",
                                "mode": "no_refund",
                                "internal_note": "item destroyed",
                                "restore_inventory": False}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        tx = _get_tx(SID_2)
        events = [t.get("event") for t in (tx.get("cancellation") or {}).get("timeline") or []]
        assert "inventory_not_restored" in events, events
        assert "inventory_restored" not in events
        assert _get_stock() == stock_before


# ─── 7. Reason edit ──────────────────────────────────────────────────────────
class TestReasonEdit:
    def test_edit_reason_ok(self):
        r = requests.patch(f"{BASE_URL}/api/admin/orders/{SID_1}/cancellation",
                           headers=_hdr(ADMIN_JWT),
                           json={"reason": "buyer-requested"}, timeout=15)
        assert r.status_code == 200
        tx = _get_tx(SID_1)
        cxl = tx.get("cancellation") or {}
        assert cxl.get("reason") == "buyer-requested"
        events = [t.get("event") for t in cxl.get("timeline") or []]
        assert "reason_edited" in events

    def test_edit_invalid_reason(self):
        r = requests.patch(f"{BASE_URL}/api/admin/orders/{SID_1}/cancellation",
                           headers=_hdr(ADMIN_JWT),
                           json={"reason": "not-a-reason"}, timeout=15)
        assert r.status_code == 400

    def test_edit_no_cancellation_404(self):
        # SID_2 was cancelled too — pick a truly unknown sid
        r = requests.patch(f"{BASE_URL}/api/admin/orders/cs_test_agent_missing/cancellation",
                           headers=_hdr(ADMIN_JWT),
                           json={"reason": "buyer-requested"}, timeout=15)
        assert r.status_code == 404


# ─── 8. Stats endpoint ──────────────────────────────────────────────────────
class TestStats:
    def test_admin_required(self):
        r = requests.get(f"{BASE_URL}/api/admin/orders/cancellation-stats", timeout=15)
        assert r.status_code in (401, 403)

    def test_stats_shape(self):
        r = requests.get(f"{BASE_URL}/api/admin/orders/cancellation-stats",
                         headers=_hdr(ADMIN_JWT), timeout=20)
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        for k in ("paid_orders", "canceled_orders", "cancellation_rate",
                  "top_reasons", "refund_total", "avg_hours_to_cancel",
                  "initiators", "by_maker"):
            assert k in data, f"missing key {k}"
        assert isinstance(data["top_reasons"], list)
        if data["top_reasons"]:
            assert "label" in data["top_reasons"][0]
        assert isinstance(data["initiators"], dict)
        assert isinstance(data["by_maker"], list)


# ─── 9. Maker orders list carries cancellation + order_total ────────────────
class TestMakerOrdersList:
    def test_row_has_cancellation_and_total(self):
        r = requests.get(f"{BASE_URL}/api/maker/orders",
                         headers=_hdr(MAKER_JWT), timeout=20)
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        # rows may be a list or dict — normalize
        items = rows if isinstance(rows, list) else rows.get("orders") or rows.get("items") or []
        assert items, "maker orders list is empty"
        row = next((row for row in items if row.get("session_id") == SID_1), items[0])
        assert "cancellation" in row
        assert "order_total" in row
        assert isinstance(row["order_total"], (int, float))
