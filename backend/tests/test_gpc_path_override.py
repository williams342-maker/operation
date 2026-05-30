"""Unit tests for the maker-supplied Google Product Category (GPC) override
introduced in iter297.

Covers:
  • `_resolve_gpc` returns the maker override verbatim when set.
  • `_resolve_gpc` falls back to the auto-derived path when override empty.
  • Pinterest, Google Merchant, and Meta feeds all surface the override
    via the shared resolver.
  • `feeds.py` (the EnrichLabs / Ads CSV) honors `gpc_path` over its own
    numeric-ID mapper when set.

These are pure-function tests — no DB, no event loop, no HTTP — so they
run cleanly even when the global pytest suite has loop-pollution issues
(see handoff notes).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.pinterest_feed import _resolve_gpc, _google_product_category  # noqa: E402
from routers.feeds import _row_for_product  # noqa: E402


def test_resolve_gpc_uses_override_when_set():
    p = {
        "category": "Wall Art",
        "technique": "PLASMA",
        "gpc_path": "Home & Garden > Decor > Signs",
    }
    assert _resolve_gpc(p) == "Home & Garden > Decor > Signs"


def test_resolve_gpc_strips_whitespace_in_override():
    p = {
        "category": "Wall Art",
        "technique": "PLASMA",
        "gpc_path": "  Home & Garden > Decor > Wreaths  ",
    }
    assert _resolve_gpc(p) == "Home & Garden > Decor > Wreaths"


def test_resolve_gpc_falls_back_when_override_empty():
    p = {"category": "Custom Signs", "technique": "PLASMA", "gpc_path": ""}
    assert _resolve_gpc(p) == _google_product_category("Custom Signs", "PLASMA")
    assert _resolve_gpc(p) == "Home & Garden > Decor > Signs"


def test_resolve_gpc_falls_back_when_override_missing():
    p = {"category": "Wall Art", "technique": "LASER"}
    # No `gpc_path` key at all — must auto-derive.
    expected = _google_product_category("Wall Art", "LASER")
    assert _resolve_gpc(p) == expected


def test_resolve_gpc_rejects_single_level_override():
    """If the maker accidentally pastes a 1-level path (no '>'), fall back
    to the auto-mapper rather than ship something Pinterest will reject."""
    p = {"category": "Wall Art", "technique": "PLASMA", "gpc_path": "Furniture"}
    assert _resolve_gpc(p) == _google_product_category("Wall Art", "PLASMA")


def test_enrich_feed_row_uses_gpc_override():
    """`/api/enrich/v1/feed.csv` (routers/feeds.py) honors the override
    too — it accepts either a numeric ID or a breadcrumb path per
    Google's spec."""
    p = {
        "slug": "x", "title": "X", "description": "D",
        "category": "Wall Art", "technique": "PLASMA",
        "price": 50.0, "in_stock": 1, "images": [],
        "gpc_path": "Home & Garden > Decor > Wall Decor",
    }
    row = _row_for_product(p, {"name": "M", "slug": "m"})
    assert row["google_product_category"] == "Home & Garden > Decor > Wall Decor"


def test_enrich_feed_row_falls_back_to_numeric_id():
    """No override ⇒ feeds.py keeps its legacy numeric-ID behaviour."""
    p = {
        "slug": "y", "title": "Y", "description": "D",
        "category": "Wall Art", "technique": "PLASMA",
        "price": 50.0, "in_stock": 1, "images": [],
    }
    row = _row_for_product(p, {"name": "M", "slug": "m"})
    # The numeric ID for Wall Art is "500044" (see _category_for).
    assert row["google_product_category"] == "500044"
