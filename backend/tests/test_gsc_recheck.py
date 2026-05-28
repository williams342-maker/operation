"""Tests for the per-listing GSC recheck endpoint (iter276)."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from core import db


pytestmark = pytest.mark.asyncio


TEST_SLUG = "_pytest_gsc_recheck"


async def _cleanup():
    await db.products.delete_many({"slug": TEST_SLUG})


async def _seed_product(*, status: str = "published") -> None:
    await db.products.update_one(
        {"slug": TEST_SLUG},
        {"$set": {
            "id": TEST_SLUG, "slug": TEST_SLUG, "title": "Recheck Test",
            "status": status, "deleted_at": None,
            "maker_slug": "_pytest_recheck_maker",
            "price": 25.0, "images": [],
        }},
        upsert=True,
    )


async def test_recheck_persists_tier_when_inspect_returns_pass():
    """A PASS+indexed verdict must land as gsc_tier="established" + stamp the row."""
    from routers.gsc_admin import gsc_recheck_product
    await _cleanup()
    await _seed_product(status="published")
    fake_result = {
        "indexStatusResult": {
            "verdict": "PASS",
            "coverageState": "Submitted and indexed",
            "lastCrawlTime": "2026-05-27T10:00:00Z",
        }
    }
    with patch("routers.gsc_admin.inspect_url",
               new_callable=AsyncMock, return_value=fake_result):
        r = await gsc_recheck_product(TEST_SLUG, _={"sub": "admin"})  # type: ignore
    assert r["ok"] is True
    assert r["tier"] == "established"
    assert r["slug"] == TEST_SLUG
    # Persistence check
    row = await db.products.find_one({"slug": TEST_SLUG}, {"_id": 0})
    assert row["gsc_tier"] == "established"
    assert row["gsc_coverage"] == "Submitted and indexed"
    assert row["gsc_checked_at"]
    await _cleanup()


async def test_recheck_404_when_listing_missing():
    from routers.gsc_admin import gsc_recheck_product
    await _cleanup()
    with pytest.raises(HTTPException) as exc:
        await gsc_recheck_product("_does_not_exist", _={"sub": "admin"})  # type: ignore
    assert exc.value.status_code == 404


async def test_recheck_409_when_listing_is_draft():
    """Drafts have no public URL — GSC can't index them, so we reject the click."""
    from routers.gsc_admin import gsc_recheck_product
    await _cleanup()
    await _seed_product(status="draft")
    with pytest.raises(HTTPException) as exc:
        await gsc_recheck_product(TEST_SLUG, _={"sub": "admin"})  # type: ignore
    assert exc.value.status_code == 409
    await _cleanup()


async def test_recheck_handles_no_result_from_gsc():
    """When inspect_url returns None (GSC unreachable / disconnected), we
    surface a clear soft-failure without 500ing or polluting the product row."""
    from routers.gsc_admin import gsc_recheck_product
    await _cleanup()
    await _seed_product(status="published")
    with patch("routers.gsc_admin.inspect_url",
               new_callable=AsyncMock, return_value=None):
        r = await gsc_recheck_product(TEST_SLUG, _={"sub": "admin"})  # type: ignore
    assert r["ok"] is False
    assert "no result" in r["reason"]
    # Row should NOT have been stamped on a soft-failure
    row = await db.products.find_one({"slug": TEST_SLUG}, {"_id": 0})
    assert "gsc_tier" not in row or row.get("gsc_tier") is None
    await _cleanup()


async def test_recheck_maps_fail_verdict_to_not_in_sitemap():
    """A FAIL verdict means the URL is excluded; UI shows red badge."""
    from routers.gsc_admin import gsc_recheck_product
    await _cleanup()
    await _seed_product(status="published")
    fake = {"indexStatusResult": {
        "verdict": "FAIL",
        "coverageState": "Excluded by noindex tag",
        "lastCrawlTime": "",
    }}
    with patch("routers.gsc_admin.inspect_url",
               new_callable=AsyncMock, return_value=fake):
        r = await gsc_recheck_product(TEST_SLUG, _={"sub": "admin"})  # type: ignore
    assert r["tier"] == "not_in_sitemap"
    row = await db.products.find_one({"slug": TEST_SLUG}, {"_id": 0})
    assert row["gsc_tier"] == "not_in_sitemap"
    await _cleanup()
