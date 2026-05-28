"""Regression: Stripe Connect self-heal after platform migration (iter276).

Symmetric to iter275's price/customer self-heal. When the Crafters
Market Stripe platform was migrated, maker rows still carried
`stripe_account_id` values from the OLD platform. Our new API key can't
see them → `Account.retrieve` raises `InvalidRequestError: No such
account` → status route used to return `connected=True` + `error=
stripe-unreachable`, which made the dashboard show a broken-connected
state forever.

Now, on `No such account` the status route drops the stale fields from
the maker doc and returns `connected=False, stale_id_cleared=True` so
the UI immediately surfaces the "Link Stripe" CTA.
"""
from unittest.mock import MagicMock, patch

import httpx
import pytest
import stripe as _stripe_sdk

from core import db


API = "http://localhost:8001"
TEST_SLUG = "_pytest_connect_selfheal"


async def _cleanup():
    await db.makers.delete_many({"slug": TEST_SLUG})


async def _seed(*, stripe_account_id=None, charges=False, payouts=False, details=False):
    await db.makers.update_one(
        {"slug": TEST_SLUG},
        {"$set": {
            "slug": TEST_SLUG, "name": "Pytest Connect",
            "email": "_pytest_connect@example.com",
            "deleted_at": None,
            "stripe_account_id": stripe_account_id,
            "stripe_charges_enabled": charges,
            "stripe_payouts_enabled": payouts,
            "stripe_details_submitted": details,
        }},
        upsert=True,
    )


def _mock_session_jwt():
    """Build a session JWT for the test maker so we can hit the route."""
    from maker_auth import issue_session_jwt
    return issue_session_jwt(TEST_SLUG, "_pytest_connect@example.com", "maker")


@pytest.mark.asyncio
async def test_stale_account_id_is_cleared_on_status_call():
    """Stale Connect ID → 404 from Stripe → fields are wiped from maker doc."""
    from routers.stripe_connect import connect_status
    await _cleanup()
    await _seed(stripe_account_id="acct_OLD_PLATFORM",
                charges=True, payouts=True, details=True)

    fake_stripe = MagicMock()
    fake_stripe.Account.retrieve = MagicMock(side_effect=_stripe_sdk.error.InvalidRequestError(
        "No such account: 'acct_OLD_PLATFORM'", "id"))
    with patch("routers.stripe_connect._stripe", return_value=fake_stripe), \
         patch("routers.stripe_connect.STRIPE_API_KEY", "sk_test_dummy"):
        r = await connect_status(slug=TEST_SLUG)
    assert r["connected"] is False, r
    assert r["stripe_account_id"] is None
    assert r["stale_id_cleared"] is True
    # Maker doc rewritten
    after = await db.makers.find_one({"slug": TEST_SLUG}, {"_id": 0})
    assert after.get("stripe_account_id") is None
    assert after.get("stripe_charges_enabled") is None
    await _cleanup()


@pytest.mark.asyncio
async def test_valid_account_returns_connected_state():
    """When Stripe responds normally, the route returns the live status."""
    from routers.stripe_connect import connect_status
    await _cleanup()
    await _seed(stripe_account_id="acct_GOOD_LIVE")

    fake_account = MagicMock(
        charges_enabled=True, payouts_enabled=True, details_submitted=True)
    fake_stripe = MagicMock()
    fake_stripe.Account.retrieve = MagicMock(return_value=fake_account)
    with patch("routers.stripe_connect._stripe", return_value=fake_stripe), \
         patch("routers.stripe_connect.STRIPE_API_KEY", "sk_test_dummy"):
        r = await connect_status(slug=TEST_SLUG)
    assert r["connected"] is True
    assert r["stripe_account_id"] == "acct_GOOD_LIVE"
    assert r["charges_enabled"] is True
    assert r["payouts_enabled"] is True
    await _cleanup()


@pytest.mark.asyncio
async def test_network_error_does_NOT_clear_account_id():
    """Stripe-unreachable network error must NOT wipe the maker's
    stored account_id — that would lock them out during a transient
    Stripe outage."""
    from routers.stripe_connect import connect_status
    await _cleanup()
    await _seed(stripe_account_id="acct_NETWORK_TEST",
                charges=True, payouts=True, details=True)

    fake_stripe = MagicMock()
    # Generic connection error, NOT InvalidRequestError
    fake_stripe.Account.retrieve = MagicMock(
        side_effect=_stripe_sdk.error.APIConnectionError("Connection failed"))
    with patch("routers.stripe_connect._stripe", return_value=fake_stripe), \
         patch("routers.stripe_connect.STRIPE_API_KEY", "sk_test_dummy"):
        r = await connect_status(slug=TEST_SLUG)
    assert r["connected"] is True
    assert r["stripe_account_id"] == "acct_NETWORK_TEST"
    assert r.get("error") == "stripe-unreachable"
    # Stored DB state preserved
    after = await db.makers.find_one({"slug": TEST_SLUG}, {"_id": 0})
    assert after["stripe_account_id"] == "acct_NETWORK_TEST"
    assert after["stripe_charges_enabled"] is True
    await _cleanup()


@pytest.mark.asyncio
async def test_no_account_id_returns_disconnected_without_calling_stripe():
    """Maker who never linked → route returns disconnected without
    pinging Stripe at all."""
    from routers.stripe_connect import connect_status
    await _cleanup()
    await _seed(stripe_account_id=None)

    fake_stripe = MagicMock()
    fake_stripe.Account.retrieve = MagicMock(side_effect=AssertionError(
        "Stripe must NOT be called when no account_id is stored."))
    with patch("routers.stripe_connect._stripe", return_value=fake_stripe), \
         patch("routers.stripe_connect.STRIPE_API_KEY", "sk_test_dummy"):
        r = await connect_status(slug=TEST_SLUG)
    assert r["connected"] is False
    assert not fake_stripe.Account.retrieve.called
    await _cleanup()
