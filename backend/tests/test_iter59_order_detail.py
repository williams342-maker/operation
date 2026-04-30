"""iter59 — Maker order detail endpoint + Mark-as-shipped flow.

Covers:
- GET /api/maker/orders → new fields (buyer_name, order_status, shipped_at, tracking_*)
- GET /api/maker/orders/{session_id} → full detail with shipping, items[image], buyer_note
- POST /api/maker/orders/{session_id}/ship → moves order from pending to fulfilled
- Cross-maker isolation → 404 for makers who own no items in the order
"""
import os
import sys
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
from maker_auth import issue_magic_token  # noqa: E402

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
IRON = "iron-and-oak@craftersmarket.org"
METAL = "metalart-pro@craftersmarket.org"


def _auth(email: str) -> str:
    tok = issue_magic_token(email)
    r = requests.post(f"{BASE}/api/maker/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _headers(jwt: str) -> dict:
    return {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}


# Module-level cache so we don't re-auth in every test.
class _State:
    iron_jwt: str | None = None
    metal_jwt: str | None = None
    pending_session: str | None = None
    fulfilled_session: str | None = None


def setup_module(module):  # noqa: ARG001
    _State.iron_jwt = _auth(IRON)
    _State.metal_jwt = _auth(METAL)


# ---------------------------------------------------------------------------
# List endpoint — new fields
# ---------------------------------------------------------------------------
def test_orders_list_has_new_fields():
    r = requests.get(f"{BASE}/api/maker/orders", headers=_headers(_State.iron_jwt), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1, "iron-and-oak should have ≥1 seeded order"
    for row in data:
        # Required new fields
        for k in ("buyer_name", "order_status", "shipped_at", "tracking_carrier", "tracking_number"):
            assert k in row, f"missing field {k} in {row}"
    # Stash one pending + one fulfilled session id
    pending = next((r_["session_id"] for r_ in data if r_.get("order_status") == "pending"), None)
    fulfilled = next((r_["session_id"] for r_ in data if r_.get("order_status") == "fulfilled"), None)
    assert pending is not None, "expected at least one pending seeded order"
    _State.pending_session = pending
    _State.fulfilled_session = fulfilled  # may stay None if seed has none


# ---------------------------------------------------------------------------
# Detail endpoint — happy path
# ---------------------------------------------------------------------------
def test_order_detail_full_payload():
    sid = _State.pending_session
    assert sid, "previous test did not stash a pending session"
    r = requests.get(f"{BASE}/api/maker/orders/{sid}", headers=_headers(_State.iron_jwt), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    # Shape
    assert d["session_id"] == sid
    assert "buyer_email" in d
    assert "buyer_name" in d
    assert "items" in d and isinstance(d["items"], list) and len(d["items"]) >= 1
    for item in d["items"]:
        for k in ("product_slug", "title", "price", "quantity", "subtotal"):
            assert k in item
        assert "image" in item, "image field required in detail line items"
    assert "shipping" in d
    assert "buyer_note" in d
    assert "shipped_at" in d
    assert "tracking_carrier" in d
    assert "tracking_number" in d


# ---------------------------------------------------------------------------
# Detail — auth required
# ---------------------------------------------------------------------------
def test_order_detail_requires_auth():
    sid = _State.pending_session
    r = requests.get(f"{BASE}/api/maker/orders/{sid}", timeout=15)
    assert r.status_code in (401, 403), r.text


# ---------------------------------------------------------------------------
# Cross-maker isolation — different maker should get 404
# ---------------------------------------------------------------------------
def test_order_detail_cross_maker_isolation():
    sid = _State.pending_session
    r = requests.get(f"{BASE}/api/maker/orders/{sid}", headers=_headers(_State.metal_jwt), timeout=15)
    assert r.status_code == 404, f"metalart-pro should not see iron-and-oak orders, got {r.status_code}"


# ---------------------------------------------------------------------------
# Detail — bogus session id → 404
# ---------------------------------------------------------------------------
def test_order_detail_bogus_session_404():
    r = requests.get(
        f"{BASE}/api/maker/orders/cs_test_does_not_exist_999",
        headers=_headers(_State.iron_jwt), timeout=15,
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Mark shipped — happy path → fulfilled + tracking persisted
# ---------------------------------------------------------------------------
def test_mark_shipped_moves_pending_to_fulfilled():
    sid = _State.pending_session
    body = {"tracking_carrier": "USPS", "tracking_number": "TEST_TRK_9X8Y7"}
    r = requests.post(
        f"{BASE}/api/maker/orders/{sid}/ship",
        json=body, headers=_headers(_State.iron_jwt), timeout=15,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    assert j.get("order_status") == "fulfilled"
    assert j.get("shipped_at")

    # Verify persistence via detail GET
    r2 = requests.get(f"{BASE}/api/maker/orders/{sid}", headers=_headers(_State.iron_jwt), timeout=15)
    assert r2.status_code == 200
    d = r2.json()
    assert d["order_status"] == "fulfilled"
    assert d["shipped_at"]
    assert d["tracking_carrier"] == "USPS"
    assert d["tracking_number"] == "TEST_TRK_9X8Y7"


# ---------------------------------------------------------------------------
# Mark shipped — cross-maker isolation
# ---------------------------------------------------------------------------
def test_mark_shipped_cross_maker_404():
    # Use the same session — metalart-pro doesn't own its items → 404
    sid = _State.pending_session
    r = requests.post(
        f"{BASE}/api/maker/orders/{sid}/ship",
        json={}, headers=_headers(_State.metal_jwt), timeout=15,
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Mark shipped — bogus session id → 404
# ---------------------------------------------------------------------------
def test_mark_shipped_bogus_session_404():
    r = requests.post(
        f"{BASE}/api/maker/orders/cs_test_does_not_exist_999/ship",
        json={}, headers=_headers(_State.iron_jwt), timeout=15,
    )
    assert r.status_code == 404
