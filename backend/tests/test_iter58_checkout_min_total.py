"""Iter58 — verify POST /api/checkout/session handles <$0.50 totals + Stripe
InvalidRequestError split (tax-config -> silent retry, others -> friendly 400).
"""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
    open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[-1].splitlines()[0].strip()

LOW_PRICE_PID = "910b1738-03b4-4f8d-8422-a27a12e42f83"  # $0.10
# iter413au — Old HIGH_PRICE_PID was removed from catalog; use a real
# in-catalog product (mountain-range-silhouette $149).
HIGH_PRICE_PID = "ff5904b2-d0ba-4440-b09d-a442ea763213"


def _post(items, **extra):
    body = {
        "items": items,
        "origin_url": "https://example.com",
        "customer_email": "test@example.com",
        "policy_accepted": True,
        **extra,
    }
    return requests.post(f"{BASE_URL}/api/checkout/session", json=body, timeout=30)


# --- Below-min total ---
def test_below_min_total_returns_400_with_friendly_msg():
    r = _post([{"product_id": LOW_PRICE_PID, "quantity": 1}])
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:300]}"
    detail = r.json().get("detail", "")
    assert "at least $0.50" in detail.lower() or "0.50" in detail, detail


# --- Quantity stacking pushes above the $0.50 floor ---
def test_qty_stack_above_min_returns_200():
    r = _post([{"product_id": LOW_PRICE_PID, "quantity": 10}])  # $1.00
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:500]}"
    j = r.json()
    assert "url" in j and j["url"].startswith("https://checkout.stripe.com/"), j


# --- Higher-priced product → automatic_tax fallback path must succeed ---
def test_high_price_returns_stripe_url():
    r = _post([{"product_id": HIGH_PRICE_PID, "quantity": 1}])
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:500]}"
    j = r.json()
    assert "url" in j and "checkout.stripe.com" in j["url"]
    assert "session_id" in j


# --- Legacy validation regression ---
def test_empty_cart_returns_400():
    r = _post([])
    assert r.status_code == 400
    assert "empty" in r.json().get("detail", "").lower()


def test_policy_not_accepted_returns_400():
    r = _post([{"product_id": HIGH_PRICE_PID, "quantity": 1}], policy_accepted=False)
    assert r.status_code == 400
    assert "polic" in r.json().get("detail", "").lower()


def test_invalid_discount_code_returns_400():
    r = _post(
        [{"product_id": HIGH_PRICE_PID, "quantity": 1}],
        discount_code="THIS_CODE_DOES_NOT_EXIST_XYZ",
    )
    assert r.status_code == 400
    assert "discount code rejected" in r.json().get("detail", "").lower()
