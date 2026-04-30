"""Iter74 — Backorder request lifecycle.

Tests cover the policy resolver, public submit endpoint guards, and the
maker accept/decline/fulfill state machine."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ────────────────────────────────────────────────────────────────────────
# Policy resolver
# ────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_policy_inherits_from_maker_default_when_listing_pref_is_none():
    from routers.backorder import _resolve_backorder_policy
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={
        "accepts_backorders_default": True,
    })
    with patch("routers.backorder.db", fake_db):
        allowed, lead = await _resolve_backorder_policy({
            "maker_slug": "mk", "accepts_backorders": None,
        })
    assert allowed is True
    assert lead == 4  # default fallback


@pytest.mark.asyncio
async def test_policy_per_listing_override_wins_over_maker_default():
    from routers.backorder import _resolve_backorder_policy
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={
        "accepts_backorders_default": True,
    })
    with patch("routers.backorder.db", fake_db):
        # Listing explicitly OFF — overrides maker ON
        allowed, _ = await _resolve_backorder_policy({
            "maker_slug": "mk", "accepts_backorders": False,
        })
    assert allowed is False


@pytest.mark.asyncio
async def test_policy_uses_listing_lead_weeks_when_present():
    from routers.backorder import _resolve_backorder_policy
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={"accepts_backorders_default": True})
    with patch("routers.backorder.db", fake_db):
        _, lead = await _resolve_backorder_policy({
            "maker_slug": "mk", "accepts_backorders": True,
            "backorder_lead_weeks": 8,
        })
    assert lead == 8


# ────────────────────────────────────────────────────────────────────────
# Public submit endpoint
# ────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_submit_rejects_when_listing_in_stock():
    """Backorders are only valid for 0-stock listings — anything else
    should redirect the buyer to the cart flow."""
    from fastapi import BackgroundTasks, HTTPException
    from routers.backorder import create_backorder_request
    from models import BackorderRequestCreate

    fake_db = MagicMock()
    fake_db.products.find_one = AsyncMock(return_value={
        "id": "p1", "slug": "x", "title": "T", "maker_slug": "mk",
        "in_stock": 5, "status": "published",
    })
    payload = BackorderRequestCreate(
        buyer_email="b@x.com", buyer_name="Maya", quantity=1,
    )
    with patch("routers.backorder.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await create_backorder_request("x", payload, BackgroundTasks())
    assert exc.value.status_code == 400
    assert "in stock" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_submit_rejects_when_backorders_disabled_for_maker():
    from fastapi import BackgroundTasks, HTTPException
    from routers.backorder import create_backorder_request
    from models import BackorderRequestCreate

    fake_db = MagicMock()
    fake_db.products.find_one = AsyncMock(return_value={
        "id": "p1", "slug": "x", "title": "T", "maker_slug": "mk",
        "in_stock": 0, "status": "published",
        "accepts_backorders": None,
    })
    fake_db.makers.find_one = AsyncMock(return_value={"accepts_backorders_default": False})
    payload = BackorderRequestCreate(
        buyer_email="b@x.com", buyer_name="Maya", quantity=1,
    )
    with patch("routers.backorder.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await create_backorder_request("x", payload, BackgroundTasks())
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_submit_inserts_doc_and_schedules_emails():
    from fastapi import BackgroundTasks
    from routers.backorder import create_backorder_request
    from models import BackorderRequestCreate

    fake_db = MagicMock()
    fake_db.products.find_one = AsyncMock(return_value={
        "id": "p1", "slug": "mountain-sign", "title": "Mountain Sign",
        "maker_slug": "iron-and-oak", "in_stock": 0, "status": "published",
        "accepts_backorders": True, "backorder_lead_weeks": 6,
    })
    fake_db.makers.find_one = AsyncMock(return_value={
        "name": "Iron & Oak", "email": "iao@example.com",
    })
    fake_db.backorder_requests.insert_one = AsyncMock()

    bg = BackgroundTasks()
    payload = BackorderRequestCreate(
        buyer_email="b@x.com", buyer_name="Maya Chen", quantity=2,
        message="Need by July.",
    )
    with patch("routers.backorder.db", fake_db):
        r = await create_backorder_request("mountain-sign", payload, bg)
    assert r.status == "pending"
    assert r.lead_weeks_quoted == 6
    assert r.product_title == "Mountain Sign"
    fake_db.backorder_requests.insert_one.assert_awaited_once()
    fn_names = [t.func.__name__ for t in bg.tasks]
    assert "send_buyer_backorder_received" in fn_names
    assert "send_maker_backorder_alert" in fn_names


# ────────────────────────────────────────────────────────────────────────
# Maker decision endpoints
# ────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_accept_flips_status_and_schedules_buyer_email():
    from fastapi import BackgroundTasks
    from routers.backorder import maker_accept_backorder

    fake_db = MagicMock()
    fake_db.backorder_requests.find_one = AsyncMock(return_value={
        "id": "req1", "maker_slug": "mk", "status": "pending",
        "buyer_email": "b@x.com", "buyer_name": "Maya",
        "product_title": "Sign", "lead_weeks_quoted": 4,
    })
    fake_db.makers.find_one = AsyncMock(return_value={"name": "MK", "email": "mk@x.com"})
    fake_db.backorder_requests.update_one = AsyncMock()

    bg = BackgroundTasks()
    with patch("routers.backorder.db", fake_db):
        r = await maker_accept_backorder("req1", bg, slug="mk")
    assert r["status"] == "accepted"
    fn_names = [t.func.__name__ for t in bg.tasks]
    assert "send_buyer_backorder_accepted" in fn_names


@pytest.mark.asyncio
async def test_accept_rejects_non_pending_status():
    """Can't accept a request that's already declined / fulfilled."""
    from fastapi import BackgroundTasks, HTTPException
    from routers.backorder import maker_accept_backorder

    fake_db = MagicMock()
    fake_db.backorder_requests.find_one = AsyncMock(return_value={
        "id": "req1", "maker_slug": "mk", "status": "declined",
    })
    bg = BackgroundTasks()
    with patch("routers.backorder.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await maker_accept_backorder("req1", bg, slug="mk")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_decline_records_reason_and_emails_buyer():
    from fastapi import BackgroundTasks
    from routers.backorder import maker_decline_backorder
    from models import BackorderDecision

    fake_db = MagicMock()
    fake_db.backorder_requests.find_one = AsyncMock(return_value={
        "id": "req1", "maker_slug": "mk", "status": "pending",
        "buyer_email": "b@x.com", "buyer_name": "Maya", "product_title": "Sign",
    })
    fake_db.makers.find_one = AsyncMock(return_value={"name": "MK"})
    fake_db.backorder_requests.update_one = AsyncMock()
    bg = BackgroundTasks()
    payload = BackorderDecision(decline_reason="Booked through Q3.")
    with patch("routers.backorder.db", fake_db):
        r = await maker_decline_backorder("req1", payload, bg, slug="mk")
    assert r["status"] == "declined"
    assert r["decline_reason"] == "Booked through Q3."
    fn_names = [t.func.__name__ for t in bg.tasks]
    assert "send_buyer_backorder_declined" in fn_names


@pytest.mark.asyncio
async def test_fulfill_only_works_on_accepted():
    from fastapi import HTTPException
    from routers.backorder import maker_fulfill_backorder

    fake_db = MagicMock()
    # First test: accepted → fulfilled (success)
    fake_db.backorder_requests.find_one = AsyncMock(return_value={
        "id": "req1", "maker_slug": "mk", "status": "accepted",
    })
    fake_db.backorder_requests.update_one = AsyncMock()
    with patch("routers.backorder.db", fake_db):
        r = await maker_fulfill_backorder("req1", slug="mk")
    assert r["status"] == "fulfilled"

    # Second: pending → reject
    fake_db.backorder_requests.find_one = AsyncMock(return_value={
        "id": "req2", "maker_slug": "mk", "status": "pending",
    })
    with patch("routers.backorder.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await maker_fulfill_backorder("req2", slug="mk")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_cross_maker_isolation():
    """Maker A can't accept/decline maker B's backorder requests."""
    from fastapi import BackgroundTasks, HTTPException
    from routers.backorder import maker_accept_backorder

    fake_db = MagicMock()
    # find_one will respect the maker_slug filter — return None when slug doesn't match
    fake_db.backorder_requests.find_one = AsyncMock(return_value=None)
    bg = BackgroundTasks()
    with patch("routers.backorder.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await maker_accept_backorder("req-belongs-to-other-maker", bg, slug="mk")
    assert exc.value.status_code == 404
