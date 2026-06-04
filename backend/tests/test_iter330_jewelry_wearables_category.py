"""iter330 — Jewelry & Wearables category mapping.

Verifies:
  1. _category_for routes "Jewelry & Wearables" → GPC 188 (Apparel
     & Accessories > Jewelry).
  2. Legacy "Jewelry" category still maps to the same id (back-compat).
  3. The Wearables-flavoured variants (e.g., apparel-ish keywords) also
     route to 188 so makers don't fall back to the default outdoor bucket.
  4. The constants.js front-end array no longer ships the bare "Jewelry"
     label — sanity check that the rename happened on both sides.
"""
from __future__ import annotations

from pathlib import Path


def test_category_for_routes_jewelry_and_wearables_to_188():
    from routers.feeds import _category_for
    assert _category_for("Jewelry & Wearables", "PLASMA") == "188"


def test_category_for_back_compat_jewelry_still_188():
    from routers.feeds import _category_for
    assert _category_for("Jewelry", "PLASMA") == "188"


def test_category_for_routes_apparel_and_wearable_keywords_to_188():
    from routers.feeds import _category_for
    assert _category_for("Apparel", "") == "188"
    assert _category_for("Wearable accessories", "") == "188"


def test_category_for_unrelated_categories_unchanged():
    """Make sure the new jewelry branch didn't poison existing routes."""
    from routers.feeds import _category_for
    assert _category_for("Custom Signs", "ROUTER") == "499831"
    assert _category_for("Wall Art", "PLASMA") == "500044"
    assert _category_for("Kitchen & Cutting Boards", "ROUTER") == "638"
    # Default fallback.
    assert _category_for("Furniture", "ROUTER") == "696"


def test_frontend_constants_renamed_to_wearables():
    src = Path("/app/frontend/src/pages/MakerListingEditor/constants.js").read_text()
    assert '"Jewelry & Wearables"' in src
    # Bare "Jewelry" should no longer appear as a standalone array entry.
    # (Inline comments mentioning the rename are fine — they sit on `//`
    # lines, not as quoted strings.)
    quoted_jewelry_lines = [
        line for line in src.splitlines()
        if '"Jewelry"' in line and not line.lstrip().startswith("//")
    ]
    assert not quoted_jewelry_lines, (
        f"Expected the bare \"Jewelry\" array entry to be replaced; still found: {quoted_jewelry_lines}"
    )


def test_shipping_default_covers_both_labels():
    """checkout.py keeps both keys so existing listings keep their flat
    $8 ship rate and the broadened label inherits the same default."""
    from routers.checkout import SHIPPING_BY_CATEGORY
    assert SHIPPING_BY_CATEGORY.get("Jewelry") == 8.0
    assert SHIPPING_BY_CATEGORY.get("Jewelry & Wearables") == 8.0
