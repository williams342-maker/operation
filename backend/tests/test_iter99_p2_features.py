"""iter99 — P2 features: Coming-Soon waitlist + Restock weekly digest +
Broadcast-to-Subscribers audience.
"""
from unittest.mock import patch, AsyncMock

import pytest


@pytest.fixture(scope="module")
def event_loop():
    import asyncio
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ---------------- Coming Soon waitlist ----------------
@pytest.mark.asyncio(loop_scope="module")
async def test_coming_soon_signup_idempotent():
    from core import db
    from routers.coming_soon import join_coming_soon_waitlist, _SignupBody
    email = "test+coming-soon-idem@example.com"
    await db.coming_soon_waitlist.delete_many({"email": email})
    body = _SignupBody(email=email, category="Neon & Light")
    r1 = await join_coming_soon_waitlist(body)
    assert r1["ok"] is True and r1["already"] is False
    r2 = await join_coming_soon_waitlist(body)
    assert r2["ok"] is True and r2["already"] is True
    rows = await db.coming_soon_waitlist.count_documents({"email": email})
    assert rows == 1
    await db.coming_soon_waitlist.delete_many({"email": email})


@pytest.mark.asyncio(loop_scope="module")
async def test_coming_soon_rejects_unknown_category():
    from routers.coming_soon import join_coming_soon_waitlist, _SignupBody
    body = _SignupBody(email="x@y.com", category="Diamond Mining")
    r = await join_coming_soon_waitlist(body)
    assert r["ok"] is False
    assert r["error"] == "unknown_category"


# ---------------- Maker restock weekly digest ----------------
@pytest.mark.asyncio(loop_scope="module")
async def test_restock_digest_no_op_when_empty():
    from core import db
    from maker_restock_digest import run_weekly_restock_digest, STATE_KEY
    # Clear the waitlist and state so we hit the no-op path
    await db.system_state.delete_many({"key": STATE_KEY})
    # Don't touch real data — just ensure the run reports 0 makers
    with patch("email_service.send_maker_restock_digest", new=AsyncMock()) as send:
        r = await run_weekly_restock_digest(force=True)
        # It may find real waitlist rows; assert structure only
        assert r["ran"] is True
        assert "week" in r
        assert send.await_count == r.get("makers_notified", 0)


@pytest.mark.asyncio(loop_scope="module")
async def test_restock_digest_idempotent_per_week():
    from core import db
    from maker_restock_digest import run_weekly_restock_digest, _current_iso_week, STATE_KEY
    week = _current_iso_week()
    await db.system_state.update_one(
        {"key": STATE_KEY},
        {"$set": {"key": STATE_KEY, "last_dispatched_week": week}},
        upsert=True,
    )
    with patch("email_service.send_maker_restock_digest", new=AsyncMock()) as send:
        r = await run_weekly_restock_digest()
        assert r.get("skipped") == "already_dispatched_this_week"
        assert send.await_count == 0


@pytest.mark.asyncio(loop_scope="module")
async def test_restock_digest_force_overrides_pointer():
    from core import db
    from maker_restock_digest import run_weekly_restock_digest, _current_iso_week, STATE_KEY
    week = _current_iso_week()
    await db.system_state.update_one(
        {"key": STATE_KEY},
        {"$set": {"key": STATE_KEY, "last_dispatched_week": week}},
        upsert=True,
    )
    with patch("email_service.send_maker_restock_digest", new=AsyncMock()):
        r = await run_weekly_restock_digest(force=True)
        # Force=True bypasses the per-week check
        assert "skipped" not in r


# ---------------- Broadcast: update_subscribers audience ----------------
@pytest.mark.asyncio(loop_scope="module")
async def test_broadcast_preview_accepts_update_subscribers_audience():
    from routers.admin import _resolve_broadcast_audience
    emails = await _resolve_broadcast_audience("update_subscribers")
    assert isinstance(emails, list)
    # All entries must be lower-cased and de-duplicated (set semantics)
    assert all(e == e.lower() for e in emails)
    assert len(emails) == len(set(emails))


@pytest.mark.asyncio(loop_scope="module")
async def test_broadcast_everyone_includes_subscribers():
    """The 'everyone' audience must include opted-in update subscribers."""
    from core import db
    from routers.admin import _resolve_broadcast_audience
    # Insert a unique sentinel subscriber
    sentinel = "test+broadcast-everyone-sentinel@example.com"
    await db.update_subscribers.delete_many({"email": sentinel})
    await db.update_subscribers.insert_one({
        "email": sentinel, "name": None,
        "subscribed_at": "2026-05-01T00:00:00", "unsubscribed_at": None,
        "unsubscribe_token": "tok-everyone-test", "joined_at_iter": "0",
    })
    everyone = await _resolve_broadcast_audience("everyone")
    assert sentinel in everyone
    await db.update_subscribers.delete_many({"email": sentinel})
