"""iter101 — Beta feedback resolved follow-up email.

Verifies the auto-follow-up fires on bare /resolve (when no Reply has
been sent), is idempotent (re-resolving doesn't double-email), and
respects the suppress-when-already-replied rule.
"""
import asyncio
from unittest.mock import patch, AsyncMock

import pytest


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


def _seed_settings_beta_on():
    """Ensure the settings doc allows beta feedback (only matters if
    we ever need to insert via the public POST; tests below seed
    db.beta_feedback directly so this is informational only)."""
    pass


@pytest.mark.asyncio(loop_scope="module")
async def test_resolve_fires_followup_email_when_no_prior_reply():
    from core import db
    from routers.settings import admin_resolve_feedback
    from fastapi import BackgroundTasks
    fid = "test-iter101-no-reply"
    await db.beta_feedback.delete_many({"id": fid})
    await db.beta_feedback.insert_one({
        "id": fid, "name": "Alice", "email": "alice@example.com",
        "message": "Cart total off by $1.",
        "page": "/checkout", "created_at": "2026-05-01T00:00:00",
        "resolved": False,
    })
    bg = BackgroundTasks()
    with patch("email_service.send_beta_feedback_resolved", new=AsyncMock()) as send:
        r = await admin_resolve_feedback(fid, bg, claims={"email": "ops@craftersmarket.org"})
        await bg()
        assert r["resolved"] is True
        assert r["followup_sent"] is True
        assert send.await_count == 1
        kw = send.await_args.kwargs
        assert kw["email"] == "alice@example.com"
        assert kw["name"] == "Alice"
        assert "Cart total off by $1." in kw["message"]
    # DB row must reflect the timestamp so re-resolves are no-ops
    doc = await db.beta_feedback.find_one({"id": fid}, {"_id": 0})
    assert doc.get("followup_sent_at")
    await db.beta_feedback.delete_many({"id": fid})


@pytest.mark.asyncio(loop_scope="module")
async def test_resolve_skips_followup_when_already_replied():
    """If the admin used the Reply path (which sends a tailored email
    and auto-resolves), a subsequent bare resolve should NOT fire a
    second auto-follow-up — they already got a personalized note."""
    from core import db
    from routers.settings import admin_resolve_feedback
    from fastapi import BackgroundTasks
    fid = "test-iter101-already-replied"
    await db.beta_feedback.delete_many({"id": fid})
    await db.beta_feedback.insert_one({
        "id": fid, "name": "Bob", "email": "bob@example.com",
        "message": "Question about shipping rates.",
        "page": "", "created_at": "2026-05-01T00:00:00",
        "resolved": False,
        "replied_at": "2026-05-01T01:00:00",
        "replied_by": "ops@craftersmarket.org",
    })
    bg = BackgroundTasks()
    with patch("email_service.send_beta_feedback_resolved", new=AsyncMock()) as send:
        r = await admin_resolve_feedback(fid, bg, claims={"email": "ops@craftersmarket.org"})
        await bg()
        assert r["resolved"] is True
        assert r["followup_sent"] is False
        assert send.await_count == 0
    await db.beta_feedback.delete_many({"id": fid})


@pytest.mark.asyncio(loop_scope="module")
async def test_resolve_is_idempotent_does_not_double_email():
    """Calling /resolve twice on the same item must only send one email."""
    from core import db
    from routers.settings import admin_resolve_feedback
    from fastapi import BackgroundTasks
    fid = "test-iter101-idempotent"
    await db.beta_feedback.delete_many({"id": fid})
    await db.beta_feedback.insert_one({
        "id": fid, "name": "Carol", "email": "carol@example.com",
        "message": "Loved the new gallery view.",
        "page": "/", "created_at": "2026-05-01T00:00:00",
        "resolved": False,
    })
    with patch("email_service.send_beta_feedback_resolved", new=AsyncMock()) as send:
        bg1 = BackgroundTasks()
        r1 = await admin_resolve_feedback(fid, bg1, claims={"email": "ops@craftersmarket.org"})
        await bg1()
        bg2 = BackgroundTasks()
        r2 = await admin_resolve_feedback(fid, bg2, claims={"email": "ops@craftersmarket.org"})
        await bg2()
        assert r1["followup_sent"] is True
        assert r2["followup_sent"] is False  # second resolve must not re-send
        assert send.await_count == 1
    await db.beta_feedback.delete_many({"id": fid})


@pytest.mark.asyncio(loop_scope="module")
async def test_resolve_skips_when_no_email_on_file():
    """Some early feedback rows may have empty email; resolve must still
    succeed and just skip the email."""
    from core import db
    from routers.settings import admin_resolve_feedback
    from fastapi import BackgroundTasks
    fid = "test-iter101-no-email"
    await db.beta_feedback.delete_many({"id": fid})
    await db.beta_feedback.insert_one({
        "id": fid, "name": "Anon", "email": "",
        "message": "Anonymous note.",
        "page": "", "created_at": "2026-05-01T00:00:00",
        "resolved": False,
    })
    with patch("email_service.send_beta_feedback_resolved", new=AsyncMock()) as send:
        bg = BackgroundTasks()
        r = await admin_resolve_feedback(fid, bg, claims={"email": "ops@craftersmarket.org"})
        await bg()
        assert r["resolved"] is True
        assert r["followup_sent"] is False
        assert send.await_count == 0
    await db.beta_feedback.delete_many({"id": fid})
