"""Iter27 — Listing credit packs + reviews POST + receipt review CTA."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ────────────────────────────────────────────────────────────────────────
# revenue.accrue_listing_charge — credits burn before cash fees
# ────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_accrue_burns_credit_before_cash_fee():
    """Maker past free quota with credits should burn 1 credit, not accrue cash."""
    from revenue import accrue_listing_charge
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={
        "slug": "maker-x", "subscription_status": "free",
        "listings_used_lifetime": 12,  # past 10 free
        "listings_by_month": {}, "listing_credits": 5,
    })
    fake_db.makers.update_one = AsyncMock()
    with patch("revenue.db", fake_db):
        r = await accrue_listing_charge("maker-x", "p-new")
    assert r["charged"] is False
    assert r["amount_cents"] == 0
    assert r["credits_burned"] is True
    assert r["credits_remaining"] == 4
    # Mongo update must $inc listing_credits by -1
    update_call = fake_db.makers.update_one.await_args[0][1]
    assert update_call["$inc"]["listing_credits"] == -1


@pytest.mark.asyncio
async def test_accrue_falls_back_to_cash_when_no_credits():
    """Maker past quota, zero credits: charges $0.20 to pending."""
    from revenue import accrue_listing_charge, LISTING_FEE_CENTS
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={
        "slug": "broke", "subscription_status": "free",
        "listings_used_lifetime": 12, "listings_by_month": {}, "listing_credits": 0,
    })
    fake_db.makers.update_one = AsyncMock()
    with patch("revenue.db", fake_db):
        r = await accrue_listing_charge("broke", "p-new")
    assert r["charged"] is True
    assert r["amount_cents"] == LISTING_FEE_CENTS
    update_call = fake_db.makers.update_one.await_args[0][1]
    assert update_call["$inc"]["pending_charges_cents"] == LISTING_FEE_CENTS


@pytest.mark.asyncio
async def test_accrue_within_free_quota_doesnt_touch_credits():
    """Free-tier maker still under the 10 free quota: no charge, no credit burn."""
    from revenue import accrue_listing_charge
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={
        "slug": "fresh", "subscription_status": "free",
        "listings_used_lifetime": 5, "listings_by_month": {}, "listing_credits": 0,
    })
    fake_db.makers.update_one = AsyncMock()
    with patch("revenue.db", fake_db):
        r = await accrue_listing_charge("fresh", "p-new")
    assert r["charged"] is False
    assert r["amount_cents"] == 0
    assert r.get("credits_burned") is None
    assert r["free_remaining"] == 4


# ────────────────────────────────────────────────────────────────────────
# /api/maker/credits/packs — listing endpoint
# ────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_credit_packs_lists_three_tiers_with_balance():
    from routers.credits import list_credit_packs
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={"slug": "m", "listing_credits": 25})
    with patch("routers.credits.db", fake_db):
        r = await list_credit_packs(slug="m")
    assert r["current_credits"] == 25
    assert len(r["packs"]) == 3
    pack_ids = {p["id"] for p in r["packs"]}
    assert pack_ids == {"small", "medium", "large"}
    # Per-credit cost should decrease with pack size (bulk discount)
    by_id = {p["id"]: p["per_credit_cents"] for p in r["packs"]}
    assert by_id["small"] >= by_id["medium"] >= by_id["large"]


@pytest.mark.asyncio
async def test_credit_packs_handles_missing_listing_credits_field():
    """Backward-compat: existing makers without `listing_credits` in DB."""
    from routers.credits import list_credit_packs
    fake_db = MagicMock()
    # Note: listing_credits absent from the doc — still should return 0
    fake_db.makers.find_one = AsyncMock(return_value={"slug": "old"})
    with patch("routers.credits.db", fake_db):
        r = await list_credit_packs(slug="old")
    assert r["current_credits"] == 0


# ────────────────────────────────────────────────────────────────────────
# /api/reviews — POST
# ────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_create_review_validates_required_fields():
    from fastapi import HTTPException
    from routers.catalog import create_review
    from models import ReviewCreate
    with pytest.raises(HTTPException) as exc:
        await create_review(ReviewCreate(name="", text="great"))
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_create_review_validates_rating_range():
    from fastapi import HTTPException
    from routers.catalog import create_review
    from models import ReviewCreate
    with pytest.raises(HTTPException) as exc:
        await create_review(ReviewCreate(
            name="A", text="nice", rating=6, maker_slug="x"))
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_create_review_requires_some_target():
    """Must specify either maker_slug or product_slug."""
    from fastapi import HTTPException
    from routers.catalog import create_review
    from models import ReviewCreate
    with pytest.raises(HTTPException) as exc:
        await create_review(ReviewCreate(name="A", text="great", rating=5))
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_create_review_persists_with_maker_slug():
    from routers.catalog import create_review
    from models import ReviewCreate
    fake_db = MagicMock()
    fake_db.reviews.insert_one = AsyncMock()
    with patch("routers.catalog.db", fake_db):
        review = await create_review(ReviewCreate(
            name="Cara", location="Austin, TX", rating=5,
            text="Stunning craftsmanship.", maker_slug="iron-and-oak",
        ))
    assert review.name == "Cara"
    assert review.maker_slug == "iron-and-oak"
    assert review.rating == 5
    assert fake_db.reviews.insert_one.await_count == 1


@pytest.mark.asyncio
async def test_create_review_derives_maker_from_product_when_missing():
    """Reviewing a product without specifying maker — auto-resolve from products."""
    from routers.catalog import create_review
    from models import ReviewCreate
    fake_db = MagicMock()
    fake_db.products.find_one = AsyncMock(return_value={"maker_slug": "iron-and-oak"})
    fake_db.reviews.insert_one = AsyncMock()
    with patch("routers.catalog.db", fake_db):
        review = await create_review(ReviewCreate(
            name="Sam", text="Great piece.", rating=4,
            product_slug="steel-bench",
        ))
    assert review.product_slug == "steel-bench"
    assert review.maker_slug == "iron-and-oak"  # auto-derived


@pytest.mark.asyncio
async def test_list_reviews_filters_by_maker_slug():
    from routers.catalog import list_reviews
    fake_db = MagicMock()
    cursor = MagicMock()
    cursor.sort = MagicMock(return_value=cursor)
    cursor.to_list = AsyncMock(return_value=[
        {"id": "1", "name": "A", "rating": 5, "text": "great", "location": "x",
         "maker_slug": "iron-and-oak", "created_at": "2026-04-26T00:00:00+00:00"},
    ])
    fake_db.reviews.find = MagicMock(return_value=cursor)
    with patch("routers.catalog.db", fake_db):
        r = await list_reviews(limit=20, maker_slug="iron-and-oak")
    assert len(r) == 1
    fake_db.reviews.find.assert_called_with({"maker_slug": "iron-and-oak"}, {"_id": 0})


# ────────────────────────────────────────────────────────────────────────
# email_service.send_buyer_receipt — review CTA in the HTML
# ────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_buyer_receipt_includes_review_cta_per_unique_maker():
    from email_service import send_buyer_receipt
    captured = {}
    async def fake_send(to, subj, html):
        captured["to"] = to
        captured["subject"] = subj
        captured["html"] = html
        return {"id": "abc"}
    with patch("email_service._send", fake_send):
        await send_buyer_receipt(
            "buyer@x.com", "1 item", 100.0,
            [
                {"title": "A", "price": 50, "quantity": 1,
                 "maker_slug": "iron-and-oak", "maker_name": "Iron & Oak"},
                {"title": "B", "price": 50, "quantity": 1,
                 "maker_slug": "iron-and-oak", "maker_name": "Iron & Oak"},  # dup
                {"title": "C", "price": 50, "quantity": 1,
                 "maker_slug": "metalart-pro", "maker_name": "MetalArt Pro"},
            ],
        )
    html = captured["html"]
    # Two unique makers → two review buttons, no duplicates
    assert html.count("Review Iron & Oak") == 1
    assert html.count("Review MetalArt Pro") == 1
    # UTM tracking
    assert "utm_source=email" in html
    assert "utm_campaign=order-receipt-review" in html
    # Links to /makers/<slug>#leave-review
    assert "/makers/iron-and-oak#leave-review" in html
    assert "/makers/metalart-pro#leave-review" in html


@pytest.mark.asyncio
async def test_buyer_receipt_skips_review_cta_when_no_maker_slug():
    """Older receipts without maker_slug enrichment should still send cleanly."""
    from email_service import send_buyer_receipt
    captured = {}
    async def fake_send(to, subj, html):
        captured["html"] = html
        return {"id": "abc"}
    with patch("email_service._send", fake_send):
        await send_buyer_receipt(
            "buyer@x.com", "1 item", 50.0,
            [{"title": "Vintage A", "price": 50, "quantity": 1}],  # no maker_slug
        )
    # No "Review …" buttons rendered
    assert "Review " not in captured["html"]
    # But total + main body still present
    assert "$50.00" in captured["html"]
