"""iter228 regression — "From the Workshop" maker intros.

Locks the 4 starter-pack makers each carry a workshop_intro that meets
the voice + length contract, so a future field rename or seed re-run
can't silently strip the differentiated maker pages back to one-liner
bios.
"""
import asyncio
import pytest

from core import db


TARGET_SLUGS = [
    "cascade-iron-works",
    "hill-country-forge",
    "appalachian-steel-slab",
    "great-lakes-fabworks",
]


@pytest.fixture(scope="module")
def intros():
    loop = asyncio.new_event_loop()
    try:
        async def _load():
            rows = await db.makers.find(
                {"slug": {"$in": TARGET_SLUGS}},
                {"_id": 0, "slug": 1, "workshop_intro": 1, "location": 1, "bio": 1},
            ).to_list(None)
            return {r["slug"]: r for r in rows}
        return loop.run_until_complete(_load())
    finally:
        loop.close()


def test_every_starter_maker_has_workshop_intro(intros):
    missing = [s for s in TARGET_SLUGS if not intros.get(s, {}).get("workshop_intro")]
    assert not missing, f"missing workshop_intro: {missing}"


def test_intro_word_count_in_range(intros):
    """The brief is 120-180 words. Anything < 80 is a stub, anything
    > 280 is rambling — both fail the documentary-tight-prose target."""
    for slug, m in intros.items():
        wc = len(m["workshop_intro"].split())
        assert 80 <= wc <= 280, f"{slug}: workshop_intro is {wc} words, target 120-180 (±60)"


def test_intro_uses_first_person_plural(intros):
    """Documentary voice — 'we'/'our'/'us' should appear. Singular 'I'
    would mean the model drifted to first-person-singular which reads
    like a personal essay, not a shop intro."""
    for slug, m in intros.items():
        text = m["workshop_intro"].lower()
        assert " we " in f" {text} " or text.startswith("we "), (
            f"{slug}: workshop_intro doesn't use first-person plural"
        )


def test_intro_avoids_marketing_fluff(intros):
    """Locked banlist of words that signal the model fell back to
    e-commerce-speak. If any of these slip in, the documentary feel is
    ruined."""
    banned = [
        "world-class", "state-of-the-art", "passionate about",
        "we strive", "we believe", "premium quality", "luxury",
        "discover the", "explore our", "delivered to your door",
        "amazing", "exclusive",
    ]
    for slug, m in intros.items():
        text = m["workshop_intro"].lower()
        hits = [w for w in banned if w in text]
        assert not hits, f"{slug}: marketing-fluff phrase(s) leaked: {hits}"


def test_intro_avoids_emoji_and_exclamation(intros):
    """Voice contract — neither belongs in documentary copy."""
    import re
    emoji_re = re.compile(r"[\U0001F300-\U0001FAFF\U0001F600-\U0001F64F\U0001F680-\U0001F6FF]")
    for slug, m in intros.items():
        text = m["workshop_intro"]
        assert "!" not in text, f"{slug}: exclamation mark present"
        assert not emoji_re.search(text), f"{slug}: emoji present"


def test_intro_references_region(intros):
    """The whole point of regional founders is that the place is part
    of the brand. The intro must mention the location (city, state, or
    a regional landmark) somewhere."""
    regional_keywords = {
        "cascade-iron-works": ["hood river", "mt hood", "mt. hood", "pacific northwest", "oregon", "cascade"],
        "hill-country-forge": ["fredericksburg", "texas", "hill country", "lone star"],
        "appalachian-steel-slab": ["asheville", "north carolina", "appalachia", "appalachian", "blue ridge", "smokies"],
        "great-lakes-fabworks": ["marquette", "michigan", "upper peninsula", "u.p.", "great lakes", "lake superior"],
    }
    for slug, anchors in regional_keywords.items():
        text = intros[slug]["workshop_intro"].lower()
        hits = [a for a in anchors if a in text]
        assert hits, f"{slug}: no regional anchor found (expected one of {anchors})"


def test_maker_model_field_persists():
    """Model migration sanity — Maker.workshop_intro field MUST be
    declared so future serializations don't drop the value."""
    from models import Maker
    assert "workshop_intro" in Maker.model_fields, (
        "Maker.workshop_intro field missing from models.py"
    )
