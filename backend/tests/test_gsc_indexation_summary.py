"""Test for the GSC indexation summary admin endpoint (iter275)."""
from __future__ import annotations

import pytest

from core import db


pytestmark = pytest.mark.asyncio


PROD_PREFIX = "_pytest_gsc_idx_"


async def _cleanup():
    await db.products.delete_many({"slug": {"$regex": f"^{PROD_PREFIX}"}})
    await db.gsc_sitemap_log.delete_many({"sitemap": {"$regex": "_pytest_idx"}})


async def _seed_product(slug: str, *, tier: str | None,
                        checked_iso: str | None = None) -> None:
    doc = {
        "id": slug, "slug": slug, "title": slug,
        "status": "published", "deleted_at": None,
        "maker_slug": "_pytest_idx_maker", "maker": "_pytest_idx_maker",
        "price": 25.0, "images": [], "category": "test", "technique": "test",
    }
    if tier:
        doc["gsc_tier"] = tier
    if checked_iso:
        doc["gsc_checked_at"] = checked_iso
    await db.products.update_one({"slug": slug}, {"$set": doc}, upsert=True)


async def test_indexation_summary_aggregates_buckets():
    """Seed 4 listings across 4 tiers + 1 stale; verify aggregation."""
    from routers.gsc_admin import gsc_indexation_summary
    await _cleanup()
    # 3 indexed, 2 submitted, 1 not_in_sitemap, 2 unchecked (no tier)
    await _seed_product(f"{PROD_PREFIX}est_a", tier="established",
                         checked_iso="2026-05-28T00:00:00+00:00")
    await _seed_product(f"{PROD_PREFIX}est_b", tier="established",
                         checked_iso="2026-05-28T00:00:00+00:00")
    await _seed_product(f"{PROD_PREFIX}est_c", tier="established",
                         checked_iso="2026-05-28T00:00:00+00:00")
    await _seed_product(f"{PROD_PREFIX}sub_a", tier="submitted",
                         checked_iso="2026-05-28T00:00:00+00:00")
    await _seed_product(f"{PROD_PREFIX}sub_b", tier="submitted",
                         checked_iso="2026-05-28T00:00:00+00:00")
    await _seed_product(f"{PROD_PREFIX}nis",   tier="not_in_sitemap",
                         checked_iso="2026-05-28T00:00:00+00:00")
    # 2 unchecked → contribute to `stale_count`
    await _seed_product(f"{PROD_PREFIX}unc_a", tier=None)
    await _seed_product(f"{PROD_PREFIX}unc_b", tier=None)

    # The endpoint uses Depends(current_admin); call the inner fn directly.
    summary = await gsc_indexation_summary(_={"sub": "admin"})  # type: ignore

    counts = summary["tier_counts"]
    # Filter to our seeded slugs (collection may have other prod rows)
    # — verify deltas instead of absolute totals.
    assert counts["established"] >= 3
    assert counts["submitted"] >= 2
    assert counts["not_in_sitemap"] >= 1
    assert counts["unchecked"] >= 2
    assert summary["total_published"] >= 8
    assert summary["indexed_pct"] >= 0
    # The 2 unchecked + any pre-existing untracked rows must show up here.
    assert summary["stale_count"] >= 2
    assert "sitemap_submits_7d" in summary
    assert "last_sitemap_submit" in summary
    assert "last_startup_submit" in summary
    assert isinstance(summary["gsc_connected"], bool)
    await _cleanup()


async def test_indexation_summary_handles_zero_published():
    """Even if no published listings match our seed, the response shape
    must be consistent — no nulls, no missing keys."""
    from routers.gsc_admin import gsc_indexation_summary
    summary = await gsc_indexation_summary(_={"sub": "admin"})  # type: ignore
    for key in ("total_published", "tier_counts", "indexed_pct",
                "stale_count", "sitemap_submits_7d",
                "sitemap_submits_30d_ok", "sitemap_submits_30d_err",
                "last_sitemap_submit", "last_startup_submit",
                "gsc_connected"):
        assert key in summary
    for tier in ("established", "submitted", "not_in_sitemap", "unchecked"):
        assert tier in summary["tier_counts"]
