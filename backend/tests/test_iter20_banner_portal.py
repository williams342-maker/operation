"""Iter20 — Plus banner upload + Stripe Customer Portal."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_banner_upload_blocks_free_tier_makers():
    """Non-Plus makers hitting POST /maker/uploads/banner get a 403."""
    from fastapi import HTTPException
    from routers.maker import maker_upload_banner
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={
        "slug": "free-maker", "subscription_status": "free",
    })
    with patch("routers.maker.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await maker_upload_banner(
                file=MagicMock(), slug="free-maker",
            )
    assert exc.value.status_code == 403
    assert "Crafters Plus" in exc.value.detail


@pytest.mark.asyncio
async def test_customer_portal_requires_existing_stripe_customer():
    from fastapi import HTTPException
    from routers.subscriptions import customer_portal
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={
        "slug": "x", "stripe_customer_id": None,
    })
    fake_req = MagicMock()
    with patch("routers.subscriptions.db", fake_db), \
         patch("routers.subscriptions.STRIPE_API_KEY", "sk_test_xxx"):
        with pytest.raises(HTTPException) as exc:
            await customer_portal(request=fake_req, slug="x")
    assert exc.value.status_code == 400
    assert "Subscribe first" in exc.value.detail
