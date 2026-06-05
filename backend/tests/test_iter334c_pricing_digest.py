"""iter334c — Weekly AI pricing digest tests.

Covers:
  1. `_over_pct()` env parsing + bounds.
  2. Empty `price_comparisons` → status=skipped.
  3. All comparisons below threshold → status=skipped.
  4. Maker with one flagged listing → dry_run reports the right count.
  5. Idempotency — second dry_run after a recorded send → skipped.
  6. Opt-out flag honored.
  7. Listings dropped from email when CURRENT price was lowered below threshold.
  8. Admin manual endpoint authn (403 without admin token).
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone

import pytest
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

pytestmark = pytest.mark.asyncio


def test_over_pct_default():
    from routers.pricing_digest import _over_pct
    os.environ.pop("PRICING_DIGEST_OVER_PCT", None)
    assert _over_pct() == 20.0


def test_over_pct_env_override():
    from routers.pricing_digest import _over_pct
    os.environ["PRICING_DIGEST_OVER_PCT"] = "30"
    try:
        assert _over_pct() == 30.0
    finally:
        os.environ.pop("PRICING_DIGEST_OVER_PCT", None)


def test_over_pct_bounded():
    from routers.pricing_digest import _over_pct
    os.environ["PRICING_DIGEST_OVER_PCT"] = "999"
    try:
        assert _over_pct() == 200.0
    finally:
        os.environ.pop("PRICING_DIGEST_OVER_PCT", None)


async def _setup_maker_with_listing(*, opted_out=False, current_price=130.0, listing_slug=None):
    from core import db
    slug = f"test-maker-{uuid.uuid4().hex[:8]}"
    listing_slug = listing_slug or f"test-listing-{uuid.uuid4().hex[:8]}"
    doc = {
        "slug": slug, "name": "Pricing Test Maker",
        "email": f"{slug}@test.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if opted_out:
        doc["pricing_digest_opt_out"] = True
    await db.makers.insert_one(doc)
    await db.products.insert_one({
        "slug": listing_slug, "maker_slug": slug, "title": "Test Listing",
        "price": current_price, "status": "published",
        "category": "Wall Art", "technique": "PLASMA", "materials": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return slug, listing_slug


async def _seed_comparison(maker_slug, listing_slug, *, median=100.0, listed=130.0):
    from core import db
    await db.price_comparisons.insert_one({
        "maker_slug": maker_slug, "listing_slug": listing_slug,
        "listed_price": listed, "price_median": median,
        "price_low": median * 0.7, "price_high": median * 1.4,
        "currency": "USD", "comparables": [], "recommendation": "x",
        "from_cache": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    })


async def _cleanup(maker_slug, listing_slug):
    from core import db
    await db.makers.delete_one({"slug": maker_slug})
    await db.products.delete_one({"slug": listing_slug})
    await db.price_comparisons.delete_many({"maker_slug": maker_slug})
    await db.pricing_digest_log.delete_many({"maker_slug": maker_slug})


async def test_no_comparisons_returns_skipped():
    from routers.pricing_digest import run_weekly_pricing_digest
    bogus_slug = f"non-existent-maker-{uuid.uuid4().hex[:8]}"
    r = await run_weekly_pricing_digest(only_maker=bogus_slug, dry_run=True)
    assert r["status"] == "skipped"
    assert r["reason"] == "no_recent_comparisons"


async def test_below_threshold_returns_skipped():
    from routers.pricing_digest import run_weekly_pricing_digest
    slug, listing = await _setup_maker_with_listing(current_price=105.0)
    # listed=105, median=100 → +5% which is < 20% threshold
    await _seed_comparison(slug, listing, median=100.0, listed=105.0)
    r = await run_weekly_pricing_digest(only_maker=slug, dry_run=True)
    assert r["status"] == "skipped"
    assert r["reason"] == "no_flagged_listings"
    await _cleanup(slug, listing)


async def test_flagged_listing_dry_run():
    from routers.pricing_digest import run_weekly_pricing_digest
    # current_price = 150, median = 100 → +50% which is well above 20%
    slug, listing = await _setup_maker_with_listing(current_price=150.0)
    await _seed_comparison(slug, listing, median=100.0, listed=140.0)
    r = await run_weekly_pricing_digest(only_maker=slug, dry_run=True)
    assert r["status"] == "ok"
    assert r["sent"] == 0
    assert r["would_send"] == 1
    assert r["details"][0]["flagged_count"] == 1
    await _cleanup(slug, listing)


async def test_opt_out_skips_maker():
    from routers.pricing_digest import run_weekly_pricing_digest
    slug, listing = await _setup_maker_with_listing(current_price=150.0, opted_out=True)
    await _seed_comparison(slug, listing, median=100.0, listed=140.0)
    r = await run_weekly_pricing_digest(only_maker=slug, dry_run=True)
    assert r["status"] == "ok"
    assert r["skipped_opted_out"] == 1
    assert r["sent"] == 0
    assert r["would_send"] == 0
    await _cleanup(slug, listing)


async def test_idempotency_blocks_second_send():
    """If `pricing_digest_log` already has this week's row, a second
    run for the same maker should be silently skipped."""
    from core import db
    from routers.pricing_digest import run_weekly_pricing_digest, _iso_week_key

    slug, listing = await _setup_maker_with_listing(current_price=150.0)
    await _seed_comparison(slug, listing, median=100.0, listed=140.0)

    # Pre-seed a "already sent" log row for THIS ISO week.
    week_key = _iso_week_key(datetime.now(timezone.utc))
    await db.pricing_digest_log.insert_one({
        "_id": f"{week_key}:{slug}",
        "maker_slug": slug, "sent_at": datetime.now(timezone.utc).isoformat(),
        "status": "sent", "flagged_count": 1, "flagged_slugs": [listing],
    })

    r = await run_weekly_pricing_digest(only_maker=slug, dry_run=False)
    assert r["status"] == "ok"
    assert r["skipped_already_sent"] == 1
    assert r["sent"] == 0
    await _cleanup(slug, listing)


async def test_dropped_when_current_price_lowered():
    """Maker may have lowered the price after the comparison was generated.
    The digest should re-check against CURRENT product.price and drop the
    listing if it's no longer above threshold."""
    from routers.pricing_digest import run_weekly_pricing_digest
    # Stored comparison says listed=150 vs median=100 (+50%).
    # But the live product.price is now 110 → only +10%, should NOT flag.
    slug, listing = await _setup_maker_with_listing(current_price=110.0)
    await _seed_comparison(slug, listing, median=100.0, listed=150.0)
    r = await run_weekly_pricing_digest(only_maker=slug, dry_run=True)
    assert r["status"] == "skipped" or r["sent"] + r.get("would_send", 0) == 0
    await _cleanup(slug, listing)


async def test_only_published_listings_are_counted():
    """If the maker paused / drafted the listing since the comparison ran,
    drop it from the digest — they don't need a nag about a hidden listing."""
    from core import db
    from routers.pricing_digest import run_weekly_pricing_digest
    slug, listing = await _setup_maker_with_listing(current_price=150.0)
    await _seed_comparison(slug, listing, median=100.0, listed=140.0)
    # Flip status to paused.
    await db.products.update_one({"slug": listing}, {"$set": {"status": "paused"}})
    r = await run_weekly_pricing_digest(only_maker=slug, dry_run=True)
    assert r["sent"] + r.get("would_send", 0) == 0
    await _cleanup(slug, listing)


async def test_email_sends_real_when_not_dry_run():
    """Confirms send_maker_pricing_digest is called and log row is written."""
    from core import db
    from routers.pricing_digest import run_weekly_pricing_digest

    slug, listing = await _setup_maker_with_listing(current_price=150.0)
    await _seed_comparison(slug, listing, median=100.0, listed=140.0)

    with patch("routers.pricing_digest.send_maker_pricing_digest", return_value=None) as mock_send:
        r = await run_weekly_pricing_digest(only_maker=slug, dry_run=False)

    assert r["status"] == "ok"
    assert r["sent"] == 1
    assert mock_send.called
    # Verify the email payload — iter334g now passes both `flagged` (above) and `underpriced` (below).
    call_kwargs = mock_send.call_args.kwargs
    assert call_kwargs["maker_email"] == f"{slug}@test.com"
    assert len(call_kwargs["flagged"]) == 1
    assert call_kwargs.get("underpriced") == []  # no below-market items here
    f = call_kwargs["flagged"][0]
    assert f["slug"] == listing
    assert f["title"] == "Test Listing"
    assert f["listed_price"] == 150.0
    assert f["market_median"] == 100.0
    assert f["delta_pct"] == 50.0

    # Log row was written
    log = await db.pricing_digest_log.find_one({"maker_slug": slug})
    assert log is not None
    assert log["status"] == "sent"

    await _cleanup(slug, listing)


# iter334g — Underpriced (below-market) detection.
async def test_underpriced_listing_is_flagged_below():
    """A listing priced 25% below median should land in the `underpriced` bucket."""
    from routers.pricing_digest import run_weekly_pricing_digest
    # current_price=75, median=100 → -25% → below 20% threshold
    slug, listing = await _setup_maker_with_listing(current_price=75.0)
    await _seed_comparison(slug, listing, median=100.0, listed=75.0)

    with patch("routers.pricing_digest.send_maker_pricing_digest", return_value=None) as mock_send:
        r = await run_weekly_pricing_digest(only_maker=slug, dry_run=False)

    assert r["status"] == "ok"
    assert r["sent"] == 1
    kwargs = mock_send.call_args.kwargs
    assert kwargs["flagged"] == []
    assert len(kwargs["underpriced"]) == 1
    u = kwargs["underpriced"][0]
    assert u["slug"] == listing
    assert u["delta_pct"] == -25.0  # 25% below market
    await _cleanup(slug, listing)


async def test_both_above_and_below_listings_sent_in_one_email():
    """A maker with one above-market AND one below-market listing should get
    ONE email containing BOTH sections — single weekly inbox footprint."""
    from core import db
    from routers.pricing_digest import run_weekly_pricing_digest

    # Re-use the helper to set up the maker + one listing, then add a 2nd.
    slug, above_slug = await _setup_maker_with_listing(current_price=150.0)
    below_slug = f"test-listing-{uuid.uuid4().hex[:8]}"
    await db.products.insert_one({
        "slug": below_slug, "maker_slug": slug, "title": "Underpriced",
        "price": 70.0, "status": "published",
        "category": "Wall Art", "technique": "PLASMA", "materials": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await _seed_comparison(slug, above_slug, median=100.0, listed=145.0)  # +45% above
    await _seed_comparison(slug, below_slug, median=100.0, listed=70.0)   # -30% below

    with patch("routers.pricing_digest.send_maker_pricing_digest", return_value=None) as mock_send:
        r = await run_weekly_pricing_digest(only_maker=slug, dry_run=False)

    assert r["status"] == "ok"
    assert r["sent"] == 1
    kwargs = mock_send.call_args.kwargs
    assert len(kwargs["flagged"]) == 1
    assert len(kwargs["underpriced"]) == 1
    assert kwargs["flagged"][0]["slug"] == above_slug
    assert kwargs["underpriced"][0]["slug"] == below_slug

    # Log row should record both slugs separately.
    log = await db.pricing_digest_log.find_one({"maker_slug": slug})
    assert above_slug in log["flagged_slugs"]
    assert below_slug in log["underpriced_slugs"]
    assert log["flagged_count"] == 2

    await db.makers.delete_one({"slug": slug})
    await db.products.delete_many({"maker_slug": slug})
    await db.price_comparisons.delete_many({"maker_slug": slug})
    await db.pricing_digest_log.delete_many({"maker_slug": slug})


async def test_underpriced_below_threshold_not_flagged():
    """A listing 10% below market (within tolerance) should NOT be flagged."""
    from routers.pricing_digest import run_weekly_pricing_digest
    # current_price=90, median=100 → -10% → within tolerance
    slug, listing = await _setup_maker_with_listing(current_price=90.0)
    await _seed_comparison(slug, listing, median=100.0, listed=90.0)
    r = await run_weekly_pricing_digest(only_maker=slug, dry_run=True)
    assert r["status"] == "skipped"
    assert r["reason"] == "no_flagged_listings"
    await _cleanup(slug, listing)


def test_under_pct_default_and_bounds():
    from routers.pricing_digest import _under_pct
    os.environ.pop("PRICING_DIGEST_UNDER_PCT", None)
    assert _under_pct() == 20.0
    os.environ["PRICING_DIGEST_UNDER_PCT"] = "30"
    try:
        assert _under_pct() == 30.0
    finally:
        os.environ.pop("PRICING_DIGEST_UNDER_PCT", None)
    # Upper bound = 80 (can't be "100% below")
    os.environ["PRICING_DIGEST_UNDER_PCT"] = "99"
    try:
        assert _under_pct() == 80.0
    finally:
        os.environ.pop("PRICING_DIGEST_UNDER_PCT", None)


async def test_admin_endpoint_requires_admin_jwt():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/admin/pricing-digest/run", json={"dry_run": True})
    # No auth → 401, non-admin → 403
    assert r.status_code in (401, 403)


# iter334f — Maker-facing opt-out endpoints.
async def test_maker_opt_out_get_default_false():
    """A fresh maker with no `pricing_digest_opt_out` field should return
    opt_out=False so the toggle defaults to ON in the UI."""
    from server import app
    from core import db
    from maker_auth import issue_session_jwt

    slug = f"test-maker-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "T", "email": f"{slug}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    token = issue_session_jwt(slug, f"{slug}@t.com")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/maker/pricing-digest/preference",
                         headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json() == {"opt_out": False}
    await db.makers.delete_one({"slug": slug})


async def test_maker_opt_out_set_and_round_trip():
    """POST → GET round trip persists the opt-out flag."""
    from server import app
    from core import db
    from maker_auth import issue_session_jwt

    slug = f"test-maker-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "T", "email": f"{slug}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    token = issue_session_jwt(slug, f"{slug}@t.com")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Opt out
        r = await ac.post("/api/maker/pricing-digest/preference",
                          json={"opt_out": True},
                          headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json() == {"ok": True, "opt_out": True}
        # Read back
        r = await ac.get("/api/maker/pricing-digest/preference",
                         headers={"Authorization": f"Bearer {token}"})
        assert r.json()["opt_out"] is True
        # Opt back in
        r = await ac.post("/api/maker/pricing-digest/preference",
                          json={"opt_out": False},
                          headers={"Authorization": f"Bearer {token}"})
        assert r.json() == {"ok": True, "opt_out": False}

    # Confirm the DB really has the right value (not a stale cached doc).
    saved = await db.makers.find_one({"slug": slug}, {"_id": 0, "pricing_digest_opt_out": 1})
    assert saved.get("pricing_digest_opt_out") is False
    await db.makers.delete_one({"slug": slug})


async def test_maker_opt_out_requires_maker_jwt():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/maker/pricing-digest/preference")
        assert r.status_code in (401, 403)
        r = await ac.post("/api/maker/pricing-digest/preference", json={"opt_out": True})
        assert r.status_code in (401, 403)
