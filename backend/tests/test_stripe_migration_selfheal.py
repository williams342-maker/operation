"""Regression: Stripe platform migration self-healing (iter275).

When the Crafters Market Stripe platform was migrated, cached IDs in
both MongoDB (`platform_meta.plus_subscription.price_id`) and on each
maker doc (`stripe_customer_id`) suddenly referenced resources on the
OLD platform. The new platform's API key can't see them → Stripe raises
`InvalidRequestError: No such ...` → 500 → frontend's generic
"Couldn't start upgrade" fallback.

iter275 wraps `Price.retrieve` and `Customer.retrieve` in try/except,
drops the bad cache, and recreates the missing resource transparently
on the first upgrade attempt. These tests stub Stripe and verify the
recreation paths fire under the migration scenario.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import stripe as _stripe_sdk

from core import db


TEST_MAKER_SLUG = "_pytest_plus_migration"
TEST_EMAIL = "_pytest_plus_migration@example.com"


async def _cleanup():
    await db.makers.delete_many({"slug": TEST_MAKER_SLUG})
    await db.platform_meta.delete_many({"key": "plus_subscription"})


async def _seed_maker(*, stripe_customer_id=None):
    await db.makers.update_one(
        {"slug": TEST_MAKER_SLUG},
        {"$set": {
            "slug": TEST_MAKER_SLUG, "name": "Pytest Plus",
            "email": TEST_EMAIL,
            "tier": "standard", "subscription_status": "free",
            "stripe_customer_id": stripe_customer_id,
            "deleted_at": None,
            "plus_trial_used": False,
        }},
        upsert=True,
    )


def _stripe_stub(*, valid_price=True, valid_customer=True):
    """Build a fake `stripe` module that simulates the platform migration.

    `valid_price=False`  → Price.retrieve raises InvalidRequestError;
                            Price.create returns a fresh ID.
    `valid_customer=False` → Customer.retrieve raises; Customer.create
                              returns a fresh ID.
    """
    fake = MagicMock()

    def price_retrieve(price_id):
        if valid_price:
            return MagicMock(id=price_id)
        raise _stripe_sdk.error.InvalidRequestError(
            f"No such price: '{price_id}'", "id")
    fake.Price.retrieve = MagicMock(side_effect=price_retrieve)
    fake.Price.create = MagicMock(return_value=MagicMock(id="price_NEW_AUTO"))
    fake.Product.create = MagicMock(return_value=MagicMock(id="prod_NEW_AUTO"))

    def customer_retrieve(cust_id):
        if valid_customer:
            return MagicMock(id=cust_id)
        raise _stripe_sdk.error.InvalidRequestError(
            f"No such customer: '{cust_id}'", "id")
    fake.Customer.retrieve = MagicMock(side_effect=customer_retrieve)
    fake.Customer.create = MagicMock(return_value=MagicMock(id="cus_NEW_AUTO"))
    return fake


@pytest.mark.asyncio
async def test_stale_cached_price_id_is_replaced():
    """`platform_meta` has a price_id from the OLD platform → new key
    can't see it → we drop the meta row, create a new product+price,
    and persist the new IDs."""
    from routers.subscriptions import _get_or_create_plus_price
    import routers.subscriptions as subs
    subs.PLUS_PRICE_ID_CACHE = None  # bust in-process cache
    subs.PLUS_PRODUCT_ID_CACHE = None
    await _cleanup()
    # Seed a stale meta row pointing at an OLD platform price ID.
    await db.platform_meta.update_one(
        {"key": "plus_subscription"},
        {"$set": {
            "key": "plus_subscription",
            "product_id": "prod_OLD_STALE",
            "price_id":   "price_OLD_STALE",
        }},
        upsert=True,
    )
    stub = _stripe_stub(valid_price=False, valid_customer=True)
    with patch("routers.subscriptions._stripe", return_value=stub):
        new_id = await _get_or_create_plus_price()
    assert new_id == "price_NEW_AUTO"
    # Stale meta should be wiped + replaced
    meta = await db.platform_meta.find_one({"key": "plus_subscription"}, {"_id": 0})
    assert meta["price_id"] == "price_NEW_AUTO"
    assert meta["product_id"] == "prod_NEW_AUTO"
    # Sanity: Stripe.create was actually called
    assert stub.Product.create.called
    assert stub.Price.create.called
    await _cleanup()


@pytest.mark.asyncio
async def test_valid_cached_price_id_is_reused_no_create():
    """When the cached price IS valid on the current platform, no new
    product/price gets created — we just return the cached ID."""
    from routers.subscriptions import _get_or_create_plus_price
    import routers.subscriptions as subs
    subs.PLUS_PRICE_ID_CACHE = None
    subs.PLUS_PRODUCT_ID_CACHE = None
    await _cleanup()
    await db.platform_meta.update_one(
        {"key": "plus_subscription"},
        {"$set": {
            "key": "plus_subscription",
            "product_id": "prod_GOOD", "price_id": "price_GOOD",
        }},
        upsert=True,
    )
    stub = _stripe_stub(valid_price=True, valid_customer=True)
    with patch("routers.subscriptions._stripe", return_value=stub):
        returned = await _get_or_create_plus_price()
    assert returned == "price_GOOD"
    assert not stub.Product.create.called
    assert not stub.Price.create.called
    await _cleanup()


@pytest.mark.asyncio
async def test_stale_stripe_customer_id_is_recreated():
    """Maker doc has a stripe_customer_id from the OLD platform → the
    new key can't retrieve it → we create a fresh customer + update the
    maker doc transparently."""
    from routers.subscriptions import _ensure_stripe_customer
    await _cleanup()
    await _seed_maker(stripe_customer_id="cus_OLD_PLATFORM")
    maker = await db.makers.find_one({"slug": TEST_MAKER_SLUG}, {"_id": 0})

    stub = _stripe_stub(valid_price=True, valid_customer=False)
    with patch("routers.subscriptions._stripe", return_value=stub):
        cust_id = await _ensure_stripe_customer(maker)
    assert cust_id == "cus_NEW_AUTO"
    # Verify the maker doc got rewritten
    updated = await db.makers.find_one({"slug": TEST_MAKER_SLUG}, {"_id": 0})
    assert updated["stripe_customer_id"] == "cus_NEW_AUTO"
    assert stub.Customer.create.called
    await _cleanup()


@pytest.mark.asyncio
async def test_valid_stripe_customer_is_reused_no_create():
    """When the maker's stored customer_id is still valid, we reuse it."""
    from routers.subscriptions import _ensure_stripe_customer
    await _cleanup()
    await _seed_maker(stripe_customer_id="cus_GOOD_EXISTING")
    maker = await db.makers.find_one({"slug": TEST_MAKER_SLUG}, {"_id": 0})

    stub = _stripe_stub(valid_price=True, valid_customer=True)
    with patch("routers.subscriptions._stripe", return_value=stub):
        cust_id = await _ensure_stripe_customer(maker)
    assert cust_id == "cus_GOOD_EXISTING"
    assert not stub.Customer.create.called
    await _cleanup()


@pytest.mark.asyncio
async def test_first_signup_creates_customer_when_no_id_stored():
    """No prior stripe_customer_id → straight to Create (no retrieve attempt)."""
    from routers.subscriptions import _ensure_stripe_customer
    await _cleanup()
    await _seed_maker(stripe_customer_id=None)
    maker = await db.makers.find_one({"slug": TEST_MAKER_SLUG}, {"_id": 0})

    stub = _stripe_stub(valid_price=True, valid_customer=True)
    with patch("routers.subscriptions._stripe", return_value=stub):
        cust_id = await _ensure_stripe_customer(maker)
    assert cust_id == "cus_NEW_AUTO"
    assert stub.Customer.create.called
    # Retrieve should NOT have been called since stored ID was None
    assert not stub.Customer.retrieve.called
    await _cleanup()
