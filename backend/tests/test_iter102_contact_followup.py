"""iter102 — Contact message follow-up email on resolve.

Mirrors iter101's beta-feedback test suite. Verifies the auto-ack
fires on bare /resolve, is idempotent (re-resolves don't double-email),
and respects the suppress-when-already-replied rule.
"""
import asyncio
from unittest.mock import patch, AsyncMock

import pytest


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.mark.asyncio(loop_scope="module")
async def test_resolve_fires_followup_email_when_no_prior_reply():
    from core import db
    from routers.contact_messages import admin_resolve_contact_message
    from fastapi import BackgroundTasks
    mid = "test-iter102-no-reply"
    await db.contact_messages.delete_many({"id": mid})
    await db.contact_messages.insert_one({
        "id": mid, "name": "Diana", "email": "diana@example.com",
        "subject": "Wholesale inquiry",
        "message": "Do you offer bulk pricing for 50+ pieces?",
        "created_at": "2026-05-01T00:00:00", "resolved": False,
    })
    bg = BackgroundTasks()
    with patch("email_service.send_contact_message_resolved", new=AsyncMock()) as send:
        r = await admin_resolve_contact_message(mid, bg, claims={"email": "ops@craftersmarket.org"})
        await bg()
        assert r["resolved"] is True
        assert r["followup_sent"] is True
        assert send.await_count == 1
        kw = send.await_args.kwargs
        assert kw["email"] == "diana@example.com"
        assert kw["name"] == "Diana"
        assert kw["subject"] == "Wholesale inquiry"
        assert "bulk pricing" in kw["message"]
    doc = await db.contact_messages.find_one({"id": mid}, {"_id": 0})
    assert doc.get("followup_sent_at")
    await db.contact_messages.delete_many({"id": mid})


@pytest.mark.asyncio(loop_scope="module")
async def test_resolve_skips_followup_when_already_replied():
    from core import db
    from routers.contact_messages import admin_resolve_contact_message
    from fastapi import BackgroundTasks
    mid = "test-iter102-already-replied"
    await db.contact_messages.delete_many({"id": mid})
    await db.contact_messages.insert_one({
        "id": mid, "name": "Eli", "email": "eli@example.com",
        "subject": "Order question",
        "message": "Where's my package?",
        "created_at": "2026-05-01T00:00:00", "resolved": False,
        "replied_at": "2026-05-01T01:00:00", "replied_by": "ops@craftersmarket.org",
    })
    bg = BackgroundTasks()
    with patch("email_service.send_contact_message_resolved", new=AsyncMock()) as send:
        r = await admin_resolve_contact_message(mid, bg, claims={"email": "ops@craftersmarket.org"})
        await bg()
        assert r["followup_sent"] is False
        assert send.await_count == 0
    await db.contact_messages.delete_many({"id": mid})


@pytest.mark.asyncio(loop_scope="module")
async def test_resolve_is_idempotent_does_not_double_email():
    from core import db
    from routers.contact_messages import admin_resolve_contact_message
    from fastapi import BackgroundTasks
    mid = "test-iter102-idempotent"
    await db.contact_messages.delete_many({"id": mid})
    await db.contact_messages.insert_one({
        "id": mid, "name": "Frank", "email": "frank@example.com",
        "subject": "Compliment", "message": "Loved my purchase.",
        "created_at": "2026-05-01T00:00:00", "resolved": False,
    })
    with patch("email_service.send_contact_message_resolved", new=AsyncMock()) as send:
        bg1 = BackgroundTasks()
        r1 = await admin_resolve_contact_message(mid, bg1, claims={"email": "ops@craftersmarket.org"})
        await bg1()
        bg2 = BackgroundTasks()
        r2 = await admin_resolve_contact_message(mid, bg2, claims={"email": "ops@craftersmarket.org"})
        await bg2()
        assert r1["followup_sent"] is True
        assert r2["followup_sent"] is False
        assert send.await_count == 1
    await db.contact_messages.delete_many({"id": mid})


@pytest.mark.asyncio(loop_scope="module")
async def test_resolve_skips_when_no_email_on_file():
    from core import db
    from routers.contact_messages import admin_resolve_contact_message
    from fastapi import BackgroundTasks
    mid = "test-iter102-no-email"
    await db.contact_messages.delete_many({"id": mid})
    await db.contact_messages.insert_one({
        "id": mid, "name": "Anon", "email": "",
        "subject": "anon", "message": "Anonymous note.",
        "created_at": "2026-05-01T00:00:00", "resolved": False,
    })
    with patch("email_service.send_contact_message_resolved", new=AsyncMock()) as send:
        bg = BackgroundTasks()
        r = await admin_resolve_contact_message(mid, bg, claims={"email": "ops@craftersmarket.org"})
        await bg()
        assert r["followup_sent"] is False
        assert send.await_count == 0
    await db.contact_messages.delete_many({"id": mid})
