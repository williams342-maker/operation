"""iter96 — Updates digest subscription + dispatch.

Covers:
  - subscribe()/unsubscribe() idempotency + reactivation
  - _entries_since() diff math (no last_iter, mid-list iter, unknown iter)
  - _iter_le() comparison handles digit-suffix iters (69b, 91)
  - run_digest_dispatch() advances pointer, sends to active subscribers,
    skips subscribers who joined after the entry shipped
"""
import asyncio
from unittest.mock import patch, AsyncMock

import pytest


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ------------------------ unit tests ------------------------
def test_iter_le_handles_letter_suffix():
    from updates_digest import _iter_le
    # Numeric-prefix suffixes (69b, 91) should compare on the digit portion
    assert _iter_le("69b", "92") is True
    assert _iter_le("92", "69b") is False
    assert _iter_le("92", "92") is True
    assert _iter_le(None, "92") is False  # None never less-or-equal


def test_entries_since_with_no_pointer_returns_only_newest():
    from updates_digest import _entries_since
    fake = """
## 2026-05 — iter95 — Newest

**Why:** A.

---

## 2026-05 — iter94 — Middle

**Why:** B.

---

## 2026-05 — iter93 — Oldest

**Why:** C.

---
"""
    fresh = _entries_since(fake, last_iter=None)
    assert len(fresh) == 1
    assert fresh[0]["iter"] == "95"


def test_entries_since_returns_only_newer_than_pointer():
    from updates_digest import _entries_since
    fake = """
## 2026-05 — iter95 — Newest

**Why:** A.

---

## 2026-05 — iter94 — Middle

**Why:** B.

---

## 2026-05 — iter93 — Pointer

**Why:** C.

---
"""
    fresh = _entries_since(fake, last_iter="93")
    iters = [e["iter"] for e in fresh]
    assert iters == ["95", "94"]


def test_entries_since_unknown_pointer_returns_all():
    """If the pointer doesn't match any entry (shouldn't happen but
    defensive), return everything — better to over-notify than miss."""
    from updates_digest import _entries_since
    fake = """
## 2026-05 — iter95 — A

**Why:** Foo.

---

## 2026-05 — iter94 — B

**Why:** Bar.

---
"""
    fresh = _entries_since(fake, last_iter="999")
    assert len(fresh) == 2


# ------------------------ async DB tests ------------------------
@pytest.mark.asyncio(loop_scope="module")
async def test_subscribe_is_idempotent():
    from core import db
    from updates_digest import subscribe
    await db.update_subscribers.delete_many({"email": "test+idem@example.com"})
    r1 = await subscribe("test+idem@example.com", "Test")
    assert r1["ok"] is True and r1["already"] is False
    r2 = await subscribe("test+idem@example.com", "Test 2")
    assert r2["ok"] is True and r2.get("already") is True
    rows = await db.update_subscribers.count_documents({"email": "test+idem@example.com"})
    assert rows == 1


@pytest.mark.asyncio(loop_scope="module")
async def test_subscribe_validates_email():
    from updates_digest import subscribe
    bad = await subscribe("not an email", None)
    assert bad["ok"] is False
    assert bad["error"] == "invalid_email"


@pytest.mark.asyncio(loop_scope="module")
async def test_unsubscribe_then_resubscribe_reactivates():
    from core import db
    from updates_digest import subscribe, unsubscribe
    email = "test+reactivate@example.com"
    await db.update_subscribers.delete_many({"email": email})
    r = await subscribe(email)
    token = (await db.update_subscribers.find_one({"email": email}))["unsubscribe_token"]
    assert token
    out = await unsubscribe(token)
    assert out["ok"] and out["found"]
    # State now: unsubscribed_at set
    doc = await db.update_subscribers.find_one({"email": email}, {"_id": 0})
    assert doc["unsubscribed_at"] is not None
    # Re-subscribe → reactivates
    r2 = await subscribe(email)
    assert r2["ok"] and r2["reactivated"] is True
    doc2 = await db.update_subscribers.find_one({"email": email}, {"_id": 0})
    assert doc2["unsubscribed_at"] is None


@pytest.mark.asyncio(loop_scope="module")
async def test_unsubscribe_invalid_token_is_safe():
    from updates_digest import unsubscribe
    r = await unsubscribe("definitely-not-a-real-token")
    assert r["ok"] is True
    assert r["found"] is False


@pytest.mark.asyncio(loop_scope="module")
async def test_run_digest_dispatch_no_op_when_nothing_new():
    """If we've already dispatched the latest iter, the cron is a no-op."""
    from core import db
    from updates_digest import run_digest_dispatch, _current_latest_iter
    # Pin the pointer to the current latest iter
    latest = await _current_latest_iter()
    # iter413at — Tolerant of empty changelog state (fresh DBs);
    # treat None/empty as "nothing to dispatch" which is the no-op
    # we're testing anyway.
    if not latest:
        pytest.skip("no changelog entries available in this env")
    await db.system_state.update_one(
        {"key": "updates_digest"},
        {"$set": {"key": "updates_digest", "last_dispatched_iter": latest}},
        upsert=True,
    )
    # Mock the email send — must NOT be called
    with patch("email_service.send_updates_digest", new=AsyncMock()) as send:
        r = await run_digest_dispatch()
        assert r["new_entries"] == 0
        assert r["sent"] == 0
        assert send.await_count == 0


@pytest.mark.asyncio(loop_scope="module")
async def test_run_digest_dispatch_advances_pointer_and_emails():
    """Reset pointer to a stale value → dispatch fires for an active sub."""
    from core import db
    from updates_digest import run_digest_dispatch, subscribe, _current_latest_iter
    # Set up an active subscriber whose joined_at is OLD enough that the
    # current latest iter qualifies as "new" for them.
    await db.update_subscribers.delete_many({"email": "test+digest@example.com"})
    await db.update_subscribers.insert_one({
        "email": "test+digest@example.com",
        "name": "Digest",
        "subscribed_at": "2020-01-01T00:00:00",
        "unsubscribed_at": None,
        "unsubscribe_token": "tok-digest-test",
        "joined_at_iter": "0",  # ancient
    })
    # Push the pointer back so the latest entry counts as new
    await db.system_state.update_one(
        {"key": "updates_digest"},
        {"$set": {"key": "updates_digest", "last_dispatched_iter": "1"}},
        upsert=True,
    )
    latest = await _current_latest_iter()
    with patch("email_service.send_updates_digest", new=AsyncMock()) as send:
        r = await run_digest_dispatch()
        assert r["new_entries"] >= 1
        assert r["sent"] >= 1
        assert send.await_count >= 1
        # The recipient should have been our test subscriber at least once
        called_emails = [c.kwargs.get("email") for c in send.await_args_list]
        assert "test+digest@example.com" in called_emails
    # Pointer must have advanced to the current latest iter
    state = await db.system_state.find_one({"key": "updates_digest"}, {"_id": 0})
    assert state["last_dispatched_iter"] == latest
    # Cleanup
    await db.update_subscribers.delete_many({"email": "test+digest@example.com"})


@pytest.mark.asyncio(loop_scope="module")
async def test_run_digest_dispatch_skips_subscribers_who_joined_recently():
    """A subscriber whose joined_at_iter == latest must NOT receive a digest
    on the first cron after they signed up — they already saw the page."""
    from core import db
    from updates_digest import run_digest_dispatch, _current_latest_iter
    latest = await _current_latest_iter()
    await db.update_subscribers.delete_many({"email": "test+freshjoin@example.com"})
    await db.update_subscribers.insert_one({
        "email": "test+freshjoin@example.com",
        "name": None,
        "subscribed_at": "2026-05-01T00:00:00",
        "unsubscribed_at": None,
        "unsubscribe_token": "tok-fresh-test",
        "joined_at_iter": latest,
    })
    # Ensure pointer is stale so the cron picks up the latest as "new"
    await db.system_state.update_one(
        {"key": "updates_digest"},
        {"$set": {"key": "updates_digest", "last_dispatched_iter": "1"}},
        upsert=True,
    )
    with patch("email_service.send_updates_digest", new=AsyncMock()) as send:
        await run_digest_dispatch()
        called_emails = [c.kwargs.get("email") for c in send.await_args_list]
        assert "test+freshjoin@example.com" not in called_emails
    await db.update_subscribers.delete_many({"email": "test+freshjoin@example.com"})
