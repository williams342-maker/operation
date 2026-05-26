"""iter227 regression — starter pack seed integrity.

Locks the 20-product / 4-maker seed pass so a future schema refactor or
purge bug can't silently delete the marketplace-density baseline. If a
test here fails, the public /shop has lost its starter inventory and
visitors are seeing a thin catalog again.
"""
import asyncio
import pytest

from core import db


# ─────────────────────────────────────────────────────────────────────
# Pull the live state once per test session — avoids 20 separate trips.
# ─────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def starter_pack_state():
    loop = asyncio.new_event_loop()
    try:
        async def _load():
            new_maker_slugs = [
                "cascade-iron-works", "hill-country-forge",
                "appalachian-steel-slab", "great-lakes-fabworks",
            ]
            makers = await db.makers.find(
                {"slug": {"$in": new_maker_slugs}},
                {"_id": 0},
            ).to_list(None)
            products = await db.products.find(
                {"maker_slug": {"$in": new_maker_slugs}},
                {"_id": 0},
            ).to_list(None)
            return makers, products
        return loop.run_until_complete(_load())
    finally:
        loop.close()


def test_starter_pack_seeded_four_makers(starter_pack_state):
    makers, _ = starter_pack_state
    assert len(makers) == 4, f"expected 4 starter-pack makers, found {len(makers)}"


def test_starter_pack_seeded_twenty_products(starter_pack_state):
    _, products = starter_pack_state
    assert len(products) == 20, f"expected 20 starter-pack products, found {len(products)}"


def test_each_maker_owns_five_products(starter_pack_state):
    _, products = starter_pack_state
    by_maker = {}
    for p in products:
        by_maker.setdefault(p["maker_slug"], 0)
        by_maker[p["maker_slug"]] += 1
    for slug, count in by_maker.items():
        assert count == 5, f"{slug} has {count} products, expected 5"


def test_every_product_has_hero_and_process_images(starter_pack_state):
    """Each product MUST carry exactly 2 images (hero + process). User
    spec called for process imagery explicitly — that's the whole point
    of the seed pass, so we lock it."""
    _, products = starter_pack_state
    bad = [p for p in products if not p.get("images") or len(p["images"]) != 2]
    assert not bad, f"products missing hero+process pair: {[p['slug'] for p in bad]}"


def test_every_product_image_points_at_starter_pack_dir(starter_pack_state):
    _, products = starter_pack_state
    for p in products:
        for url in p["images"]:
            assert url.startswith("/seed-images/starter-pack/"), (
                f"product {p['slug']} has image outside starter-pack dir: {url}"
            )


def test_every_maker_is_a_founding_maker(starter_pack_state):
    """All 4 must be tier=founder + inaugural so they appear on /founders
    with a permanent badge."""
    makers, _ = starter_pack_state
    for m in makers:
        assert m.get("tier") == "founder", f"{m['slug']} is not tier=founder"
        assert m.get("founder_status") == "inaugural", f"{m['slug']} is not inaugural"
        assert m.get("founder_number") is not None, f"{m['slug']} missing founder_number"


def test_founder_numbers_are_unique(starter_pack_state):
    """Stable, monotonic founder numbers — collisions would corrupt the
    /founders sort + the activity-ticker copy."""
    makers, _ = starter_pack_state
    numbers = [m["founder_number"] for m in makers]
    assert len(set(numbers)) == len(numbers), f"duplicate founder_number: {numbers}"


def test_every_product_published_and_is_seed_tagged(starter_pack_state):
    """Live in /shop AND tagged with both flags so the existing purge
    endpoint can clean them in a single sweep."""
    _, products = starter_pack_state
    for p in products:
        assert p.get("status") == "published", f"{p['slug']} not published"
        assert p.get("is_seed") is True, f"{p['slug']} missing is_seed flag"
        assert p.get("featured_example") is True, f"{p['slug']} missing featured_example flag"


def test_realism_blurbs_present(starter_pack_state):
    """The user's brief specifically called for workshop-context realism
    language. Lock that ≥ 1/3 of the catalog carries that voice so a
    future 'shorten descriptions' refactor can't strip it down to
    sterile spec sheets."""
    _, products = starter_pack_state
    # Broad phrase set — catches the various ways realism shows up
    # ("hand-finished edges", "small variation", "no two are alike", etc).
    realism_phrases = [
        "small fabrication workshop", "hand-finished", "hand-rubbed",
        "small variation", "individually cut", "no two are alike",
        "no two pieces", "slight variation", "each piece", "each one's",
        "Hand-rub", "hand rub",
    ]
    carrying = [
        p["slug"] for p in products
        if any(phrase.lower() in p.get("description", "").lower() for phrase in realism_phrases)
    ]
    assert len(carrying) >= 7, (
        f"only {len(carrying)}/20 products carry workshop-context realism "
        f"language — the catalog risks feeling stamped. Carrying: {carrying}"
    )


def test_purge_endpoint_path_still_targets_starter_pack(starter_pack_state):
    """Sanity check: the existing /admin/seed/featured-content/purge
    endpoint filters on `featured_example: True`. Our starter pack must
    set that flag so the operator's one-click cleanup actually works."""
    _, products = starter_pack_state
    flagged = [p for p in products if p.get("featured_example") is True]
    assert len(flagged) == 20, (
        f"only {len(flagged)}/20 products carry featured_example=True — "
        f"the existing purge endpoint can't clean them all."
    )
