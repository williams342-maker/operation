"""iter385 — Estimated delivery window in cart quote.

Covers `_eta_window` + `_quote_for` eta fields:
  • "3-5 business days" → calendar-stretched window with handling padding
  • missing copy → platform default 4–8 (+1/+2)
  • digital-only carts → no eta
  • multi-item cart → slowest item gates the window
"""
import os
import sys
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

from routers.checkout import _eta_window, _quote_for  # noqa: E402

TODAY = datetime.now(timezone.utc).date()


def _days_out(iso):
    return (datetime.fromisoformat(iso).date() - TODAY).days


def test_eta_business_days_stretched():
    lo, hi = _eta_window([{"product": {"shipping_est_delivery": "3-5 business days"}, "quantity": 1}])
    # 3,5 biz → ceil(3*7/5)=5, ceil(5*7/5)=7 → +1/+2 → 6, 9
    assert _days_out(lo) == 6 and _days_out(hi) == 9


def test_eta_default_window():
    lo, hi = _eta_window([{"product": {}, "quantity": 1}])
    assert _days_out(lo) == 5 and _days_out(hi) == 10


def test_eta_digital_only_none():
    assert _eta_window([{"product": {"listing_type": "digital"}, "quantity": 1}]) == (None, None)


def test_eta_slowest_item_gates():
    lo, hi = _eta_window([
        {"product": {"shipping_est_delivery": "2-3 days"}, "quantity": 1},
        {"product": {"shipping_est_delivery": "10-14 days"}, "quantity": 1},
    ])
    assert _days_out(lo) == 11 and _days_out(hi) == 16


def test_quote_includes_eta_fields():
    q = _quote_for([{"product": {"price": 20.0, "category": "Wall Art"}, "quantity": 1}])
    assert q["eta_start"] and q["eta_end"]
    qd = _quote_for([{"product": {"price": 5.0, "listing_type": "digital"}, "quantity": 1}])
    assert qd["digital_only"] is True and qd["eta_start"] is None
