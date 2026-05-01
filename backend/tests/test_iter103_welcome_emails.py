"""iter103 — Welcome emails for /updates and /coming-soon waitlists.

Verifies:
- /api/updates/subscribe fires the welcome email on a brand-new signup
  and on a reactivation (previously unsubscribed), but is silent on a
  duplicate active signup.
- /api/coming-soon/waitlist fires the confirmation email on a brand-new
  signup but is silent on a duplicate signup.
- Both endpoints reject invalid inputs cleanly without firing email.
"""
import asyncio
from unittest.mock import patch, AsyncMock

import pytest


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ============================================================
# /api/updates/subscribe — welcome on first signup + reactivate
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_updates_subscribe_fires_welcome_on_new_signup():
    from core import db
    from routers.updates import subscribe_to_updates, _SubscribeBody
    from fastapi import BackgroundTasks
    email = "iter103-new@example.com"
    await db.update_subscribers.delete_many({"email": email})
    bg = BackgroundTasks()
    with patch("email_service.send_updates_subscribe_welcome", new=AsyncMock()) as send:
        r = await subscribe_to_updates(_SubscribeBody(email=email, name="New User"), bg)
        await bg()
        assert r["ok"] is True
        assert send.await_count == 1
        kw = send.await_args.kwargs
        assert kw["email"] == email
        assert kw["name"] == "New User"
        assert kw["unsubscribe_token"]  # token populated from db lookup
    doc = await db.update_subscribers.find_one({"email": email}, {"_id": 0})
    assert doc and doc.get("unsubscribe_token")
    await db.update_subscribers.delete_many({"email": email})


@pytest.mark.asyncio(loop_scope="module")
async def test_updates_subscribe_silent_on_duplicate_active_signup():
    from core import db
    from routers.updates import subscribe_to_updates, _SubscribeBody
    from fastapi import BackgroundTasks
    email = "iter103-dup@example.com"
    await db.update_subscribers.delete_many({"email": email})
    # First signup populates the row.
    with patch("email_service.send_updates_subscribe_welcome", new=AsyncMock()):
        bg1 = BackgroundTasks()
        await subscribe_to_updates(_SubscribeBody(email=email), bg1)
        await bg1()
    # Second signup on the same active row must NOT email.
    with patch("email_service.send_updates_subscribe_welcome", new=AsyncMock()) as send:
        bg2 = BackgroundTasks()
        r = await subscribe_to_updates(_SubscribeBody(email=email), bg2)
        await bg2()
        assert r["ok"] is True
        assert send.await_count == 0
    await db.update_subscribers.delete_many({"email": email})


@pytest.mark.asyncio(loop_scope="module")
async def test_updates_subscribe_fires_welcome_on_reactivation():
    from core import db
    from routers.updates import subscribe_to_updates, _SubscribeBody
    from fastapi import BackgroundTasks
    from core import now_iso
    email = "iter103-reactivate@example.com"
    await db.update_subscribers.delete_many({"email": email})
    # Seed an unsubscribed row.
    await db.update_subscribers.insert_one({
        "email": email, "name": "Returning",
        "subscribed_at": now_iso(),
        "unsubscribed_at": now_iso(),  # ← unsubscribed
        "unsubscribe_token": "stale-token",
    })
    bg = BackgroundTasks()
    with patch("email_service.send_updates_subscribe_welcome", new=AsyncMock()) as send:
        r = await subscribe_to_updates(_SubscribeBody(email=email, name="Returning"), bg)
        await bg()
        assert r["ok"] is True
        assert send.await_count == 1
        kw = send.await_args.kwargs
        # Reactivation should refresh the unsubscribe token, not reuse "stale-token".
        assert kw["unsubscribe_token"] and kw["unsubscribe_token"] != "stale-token"
    await db.update_subscribers.delete_many({"email": email})


# ============================================================
# /api/coming-soon/waitlist — confirmation on first signup only
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_coming_soon_fires_confirmation_on_new_signup():
    from core import db
    from routers.coming_soon import join_coming_soon_waitlist, _SignupBody
    from fastapi import BackgroundTasks
    email = "iter103-cs-new@example.com"
    await db.coming_soon_waitlist.delete_many({"email": email})
    bg = BackgroundTasks()
    with patch("email_service.send_coming_soon_confirmation", new=AsyncMock()) as send:
        r = await join_coming_soon_waitlist(
            _SignupBody(email=email, category="Neon & Light", name="Greta"), bg,
        )
        await bg()
        assert r == {"ok": True, "already": False}
        assert send.await_count == 1
        kw = send.await_args.kwargs
        assert kw["email"] == email
        assert kw["category"] == "Neon & Light"
        assert kw["name"] == "Greta"
    await db.coming_soon_waitlist.delete_many({"email": email})


@pytest.mark.asyncio(loop_scope="module")
async def test_coming_soon_silent_on_duplicate_signup():
    from core import db
    from routers.coming_soon import join_coming_soon_waitlist, _SignupBody
    from fastapi import BackgroundTasks
    email = "iter103-cs-dup@example.com"
    await db.coming_soon_waitlist.delete_many({"email": email})
    # First signup arms the row.
    with patch("email_service.send_coming_soon_confirmation", new=AsyncMock()):
        bg1 = BackgroundTasks()
        await join_coming_soon_waitlist(
            _SignupBody(email=email, category="Furniture"), bg1,
        )
        await bg1()
    # Re-signup on the same (email, category) must NOT email.
    with patch("email_service.send_coming_soon_confirmation", new=AsyncMock()) as send:
        bg2 = BackgroundTasks()
        r = await join_coming_soon_waitlist(
            _SignupBody(email=email, category="Furniture"), bg2,
        )
        await bg2()
        assert r == {"ok": True, "already": True}
        assert send.await_count == 0
    await db.coming_soon_waitlist.delete_many({"email": email})


@pytest.mark.asyncio(loop_scope="module")
async def test_coming_soon_rejects_unknown_category_without_email():
    from routers.coming_soon import join_coming_soon_waitlist, _SignupBody
    from fastapi import BackgroundTasks
    bg = BackgroundTasks()
    with patch("email_service.send_coming_soon_confirmation", new=AsyncMock()) as send:
        r = await join_coming_soon_waitlist(
            _SignupBody(email="iter103-cs-bad@example.com", category="Smuggled Goods"), bg,
        )
        await bg()
        assert r == {"ok": False, "error": "unknown_category"}
        assert send.await_count == 0


@pytest.mark.asyncio(loop_scope="module")
async def test_coming_soon_same_email_different_category_fires_again():
    """A user signing up for both Neon AND Furniture should get TWO
    confirmations — one per category — because the rows are distinct."""
    from core import db
    from routers.coming_soon import join_coming_soon_waitlist, _SignupBody
    from fastapi import BackgroundTasks
    email = "iter103-cs-multi@example.com"
    await db.coming_soon_waitlist.delete_many({"email": email})
    with patch("email_service.send_coming_soon_confirmation", new=AsyncMock()) as send:
        bg1 = BackgroundTasks()
        r1 = await join_coming_soon_waitlist(
            _SignupBody(email=email, category="Neon & Light"), bg1,
        )
        await bg1()
        bg2 = BackgroundTasks()
        r2 = await join_coming_soon_waitlist(
            _SignupBody(email=email, category="Furniture"), bg2,
        )
        await bg2()
        assert r1 == {"ok": True, "already": False}
        assert r2 == {"ok": True, "already": False}
        assert send.await_count == 2
        cats = {c.kwargs["category"] for c in send.await_args_list}
        assert cats == {"Neon & Light", "Furniture"}
    await db.coming_soon_waitlist.delete_many({"email": email})
