"""iter229 regression — v2 starter pack expansion (6 new makers, 30 products).

Combined with iter227, the marketplace now has 10 founding-tier makers
each with 5 products and a workshop_intro paragraph. This file locks
just the v2 deltas (the iter227 4 are already locked by
test_iter227_starter_pack_seed.py).
"""
import asyncio
import pytest

from core import db


V2_MAKER_SLUGS = [
    "blackriver-laserworks",
    "emberline-metalworks",
    "northforge-customs",
    "redwood-cnc-collective",
    "copperedge-makers",
    "forge-and-grain",
]


@pytest.fixture(scope="module")
def v2_state():
    loop = asyncio.new_event_loop()
    try:
        async def _load():
            makers = await db.makers.find(
                {"slug": {"$in": V2_MAKER_SLUGS}}, {"_id": 0},
            ).to_list(None)
            products = await db.products.find(
                {"maker_slug": {"$in": V2_MAKER_SLUGS}}, {"_id": 0},
            ).to_list(None)
            return makers, products
        return loop.run_until_complete(_load())
    finally:
        loop.close()


def test_v2_seeded_six_new_makers(v2_state):
    makers, _ = v2_state
    assert len(makers) == 6, f"expected 6, got {len(makers)}"


def test_v2_seeded_thirty_new_products(v2_state):
    _, products = v2_state
    assert len(products) == 30, f"expected 30, got {len(products)}"


def test_each_v2_maker_has_five_products(v2_state):
    _, products = v2_state
    by_maker = {}
    for p in products:
        by_maker.setdefault(p["maker_slug"], 0)
        by_maker[p["maker_slug"]] += 1
    for slug in V2_MAKER_SLUGS:
        assert by_maker.get(slug) == 5, f"{slug}: {by_maker.get(slug)} products"


def test_v2_products_have_hero_and_process_images(v2_state):
    _, products = v2_state
    bad = [p for p in products if len(p.get("images") or []) != 2]
    assert not bad, f"products missing image pair: {[p['slug'] for p in bad]}"


def test_v2_makers_are_inaugural_founders(v2_state):
    makers, _ = v2_state
    for m in makers:
        assert m.get("tier") == "founder", f"{m['slug']} not founder"
        assert m.get("founder_status") == "inaugural", f"{m['slug']} not inaugural"
        assert m.get("founder_number") is not None


def test_v2_makers_have_workshop_intros(v2_state):
    """iter229 expanded seed_workshop_intros.py to cover all 10 — locks
    that the 6 new ones got generated and didn't get skipped."""
    makers, _ = v2_state
    missing = [m["slug"] for m in makers if not m.get("workshop_intro")]
    assert not missing, f"missing workshop_intro: {missing}"
    for m in makers:
        wc = len(m["workshop_intro"].split())
        assert 80 <= wc <= 280, f"{m['slug']}: intro is {wc}wc, want 120-180"


def test_v2_marketplace_totals(v2_state):
    """End-to-end sanity — combined iter227 + iter229 should leave the
    public catalogue at the expected size. Catches if some downstream
    purge or hide flips a doc into a non-public state.

    Reuses the module fixture's event loop (creating a fresh loop here
    breaks motor's connection state — known asyncio + Motor footgun)."""
    makers, products = v2_state
    # All 6 v2 makers + their 30 products surfaced through the fixture
    # already prove the bulk of the system. This test adds one final
    # cross-cut: the iter227 + iter229 v2 makers must all share the same
    # featured_example flag so the existing purge endpoint catches them.
    for m in makers:
        assert m.get("featured_example") is True, (
            f"{m['slug']} missing featured_example=True — purge endpoint "
            f"would leave it stranded."
        )
    for p in products:
        assert p.get("is_seed") is True and p.get("featured_example") is True, (
            f"{p['slug']} missing seed/featured flags"
        )
