"""iter326 regression: `founder_counter` must only bump when a maker
truly needs a new number. Prior behaviour incremented the counter on
every /promote call and then reused the maker's existing
`founder_number`, burning slots on demote/re-promote loops and creating
gaps in the announced sequence (#20, #21, #23–27, #29, #31, #33 …).

These tests drive the real Motor-backed helpers so we catch regressions
that a pure-mock test would miss (e.g. someone accidentally moving the
`$inc` back above the existence check).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


async def _read_counter() -> int:
    from core import db
    doc = await db.platform_meta.find_one({"key": "founder_counter"}) or {}
    return int(doc.get("value") or 0)


async def _reset_counter(value: int) -> None:
    from core import db
    await db.platform_meta.update_one(
        {"key": "founder_counter"},
        {"$set": {"value": value}},
        upsert=True,
    )


async def _mk_maker(slug: str, *, founder_number: int | None = None,
                   tier: str = "regular") -> None:
    from core import db
    doc = {
        "slug": slug,
        "email": f"{slug}@example.test",
        "name": f"Test {slug}",
        "shop_name": f"{slug} Studio",
        "tier": tier,
    }
    if founder_number is not None:
        doc["founder_number"] = founder_number
    await db.makers.update_one({"slug": slug}, {"$set": doc}, upsert=True)


async def _cleanup(slug: str) -> None:
    from core import db
    await db.makers.delete_one({"slug": slug})


@pytest.mark.asyncio
async def test_promote_bumps_counter_only_for_new_maker():
    """First-time promote of a maker without a founder_number MUST bump
    the counter by exactly 1."""
    from routers.founders import admin_promote, PromoteRequest

    slug = "iter326-fresh-maker"
    await _reset_counter(100)
    await _mk_maker(slug)
    try:
        before = await _read_counter()
        await admin_promote(PromoteRequest(slug=slug), _={"role": "admin"})
        after = await _read_counter()
        assert after == before + 1, (
            f"First promote should bump counter exactly once. "
            f"before={before} after={after}"
        )
    finally:
        await _cleanup(slug)


@pytest.mark.asyncio
async def test_repromote_does_not_burn_counter():
    """Re-promoting a maker who already owns a founder_number MUST NOT
    touch the counter — that was the iter326 bug (slots burned on every
    admin QA demote → re-promote loop)."""
    from routers.founders import admin_promote, PromoteRequest

    slug = "iter326-repromote-maker"
    await _reset_counter(200)
    await _mk_maker(slug, founder_number=42, tier="founder")
    try:
        before = await _read_counter()
        # Simulate a demote → re-promote QA cycle: the maker keeps their
        # founder_number even after a tier flip.
        await admin_promote(PromoteRequest(slug=slug), _={"role": "admin"})
        await admin_promote(PromoteRequest(slug=slug), _={"role": "admin"})
        await admin_promote(PromoteRequest(slug=slug), _={"role": "admin"})
        after = await _read_counter()
        assert after == before, (
            f"Re-promote must NOT bump the counter. "
            f"before={before} after={after} (delta={after-before})"
        )
        # And their number stayed put.
        from core import db
        m = await db.makers.find_one({"slug": slug}, {"_id": 0, "founder_number": 1})
        assert m and m["founder_number"] == 42, (
            f"Re-promote must reuse the existing founder_number. Got: {m}"
        )
    finally:
        await _cleanup(slug)


@pytest.mark.asyncio
async def test_promote_sequence_no_gaps():
    """Three fresh makers promoted back-to-back must claim three
    consecutive founder_numbers (proves no burnt slots in the happy
    path)."""
    from routers.founders import admin_promote, PromoteRequest
    from core import db

    slugs = [f"iter326-seq-{i}" for i in range(3)]
    await _reset_counter(500)
    for s in slugs:
        await _mk_maker(s)
    try:
        for s in slugs:
            await admin_promote(PromoteRequest(slug=s), _={"role": "admin"})
        numbers = []
        for s in slugs:
            m = await db.makers.find_one({"slug": s}, {"_id": 0, "founder_number": 1})
            numbers.append(m["founder_number"])
        assert numbers == [501, 502, 503], (
            f"Sequential promotes must be gap-free. Got: {numbers}"
        )
    finally:
        for s in slugs:
            await _cleanup(s)
