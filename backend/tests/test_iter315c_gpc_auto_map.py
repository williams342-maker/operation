"""
iter315c — Regression for the expanded `_google_product_category`
auto-mapper. Adds explicit assertions for the CNC categories the user
called out (outdoor, automotive, weddings, gifts, seasonal) so we
catch a regression like the "f-urn-iture" substring bug before it
ships into the Pinterest / Google Merchant catalog feeds.

Every returned path must:
  • be ≥ 3 levels deep (Pinterest alert 126 trips at ≤ 2)
  • be a verbatim node from Google's official taxonomy
    (https://www.google.com/basepages/producttype/taxonomy.en-US.txt)
"""
from routers.pinterest_feed import _google_product_category


def _depth(p: str) -> int:
    return p.count(">") + 1


def test_signs_and_address_numbers():
    assert _google_product_category("Custom Signs", "") == \
        "Home & Garden > Decor > Signs"
    assert _google_product_category("Business Signage", "") == \
        "Home & Garden > Decor > Signs"
    assert _google_product_category("Address Numbers", "") == \
        "Home & Garden > Decor > House Numbers & Letters"


def test_weddings_maps_to_wedding_decor():
    p = _google_product_category("Wedding Gifts", "")
    assert "Wedding" in p
    assert _depth(p) >= 3


def test_outdoor_maps_to_garden_art_not_default():
    p1 = _google_product_category("Outdoor Art", "")
    p2 = _google_product_category("Garden & Yard Art", "")
    assert p1 == p2 == "Home & Garden > Lawn & Garden > Outdoor Living > Garden Art"


def test_seasonal_holiday_maps_correctly():
    assert _google_product_category("Holiday & Seasonal", "") == \
        "Home & Garden > Decor > Seasonal & Holiday Decorations"


def test_furniture_not_caught_by_urn_substring():
    # Regression for the "f-urn-iture" matching bug — must hit the
    # Furniture branch, NOT the memorial/urn branch.
    p = _google_product_category("Furniture", "")
    assert p.startswith("Furniture")
    assert "Plaques" not in p


def test_kitchen_and_lighting_have_dedicated_branches():
    assert _google_product_category("Kitchen & Bar", "") == \
        "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Cutting Boards"
    assert _google_product_category("Lighting & Lamps", "") == \
        "Home & Garden > Lighting > Lamps"


def test_memorial_maps_to_plaques():
    assert _google_product_category("Memorial & Tribute", "") == \
        "Home & Garden > Decor > Plaques"


def test_all_known_categories_yield_3plus_levels():
    cats = [
        "Wall Art", "Custom Signs", "Outdoor Art", "Home Decor",
        "Wedding Gifts", "Business Signage", "Address Numbers",
        "Lighting & Lamps", "Garden & Yard Art", "Memorial & Tribute",
        "Furniture", "Kitchen & Bar", "Sculpture", "Jewelry",
        "Holiday & Seasonal", "Other",
    ]
    for c in cats:
        p = _google_product_category(c, "")
        assert _depth(p) >= 3, f"{c!r} produced shallow path {p!r}"
