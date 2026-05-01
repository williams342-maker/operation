"""iter98 — Updates digest polish: CSV export + staleness + OPS summary.

Covers:
  - _days_since() handles ISO+TZ correctly
  - staleness() flags is_stale only after threshold + previous dispatch
  - run_digest_dispatch fires OPS summary on live send, skips on dry-run
  - CSV export endpoint returns proper content-type + filename
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, AsyncMock

import pytest


@pytest.fixture(scope="module")
def event_loop():
    import asyncio
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ------------------------ _days_since ------------------------
def test_days_since_handles_z_suffix():
    from updates_digest import _days_since
    # 5 days ago
    past = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat().replace("+00:00", "Z")
    assert _days_since(past) == 5
    # naive datetime → assumed UTC
    naive = (datetime.now(timezone.utc) - timedelta(days=2)).replace(tzinfo=None).isoformat()
    assert _days_since(naive) == 2
    # garbage input → None
    assert _days_since("not-a-date") is None
    assert _days_since(None) is None


# ------------------------ staleness ------------------------
@pytest.mark.asyncio(loop_scope="module")
async def test_staleness_false_when_recent():
    from core import db
    from updates_digest import staleness, STATE_KEY
    # 10 days ago — well under 30-day threshold
    ten_ago = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    await db.system_state.update_one(
        {"key": STATE_KEY},
        {"$set": {"key": STATE_KEY, "last_dispatched_at": ten_ago, "last_dispatched_iter": "1"}},
        upsert=True,
    )
    s = await staleness()
    assert s["is_stale"] is False
    assert s["days_since_dispatch"] == 10
    assert s["threshold_days"] == 30


@pytest.mark.asyncio(loop_scope="module")
async def test_staleness_true_when_over_threshold():
    from core import db
    from updates_digest import staleness, STATE_KEY
    forty_ago = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
    await db.system_state.update_one(
        {"key": STATE_KEY},
        {"$set": {"key": STATE_KEY, "last_dispatched_at": forty_ago, "last_dispatched_iter": "1"}},
        upsert=True,
    )
    s = await staleness()
    assert s["is_stale"] is True
    assert s["days_since_dispatch"] == 40


@pytest.mark.asyncio(loop_scope="module")
async def test_staleness_false_when_never_dispatched():
    from core import db
    from updates_digest import staleness, STATE_KEY
    await db.system_state.delete_many({"key": STATE_KEY})
    s = await staleness()
    assert s["is_stale"] is False
    assert s["days_since_dispatch"] is None


# ------------------------ OPS summary ------------------------
@pytest.mark.asyncio(loop_scope="module")
async def test_ops_summary_fires_on_live_dispatch():
    from core import db
    from updates_digest import run_digest_dispatch, _current_latest_iter
    # Set up active subscriber + stale pointer so dispatch will fire
    email = "test+ops-summary@example.com"
    await db.update_subscribers.delete_many({"email": email})
    await db.update_subscribers.insert_one({
        "email": email, "name": "Ops Test",
        "subscribed_at": "2020-01-01T00:00:00", "unsubscribed_at": None,
        "unsubscribe_token": "tok-ops-test", "joined_at_iter": "0",
    })
    await db.system_state.update_one(
        {"key": "updates_digest"},
        {"$set": {"key": "updates_digest", "last_dispatched_iter": "1"}},
        upsert=True,
    )
    with patch("email_service.send_updates_digest", new=AsyncMock()), \
         patch("email_service.send_ops_updates_dispatch_summary", new=AsyncMock()) as ops:
        r = await run_digest_dispatch(trigger="test-suite")
        assert r["sent"] >= 1
        assert ops.await_count == 1
        kwargs = ops.await_args.kwargs
        assert kwargs.get("trigger") == "test-suite"
        assert kwargs.get("sent") >= 1
        assert kwargs.get("advanced_to") == await _current_latest_iter()
    await db.update_subscribers.delete_many({"email": email})


@pytest.mark.asyncio(loop_scope="module")
async def test_ops_summary_skipped_on_dry_run():
    from core import db
    from updates_digest import run_digest_dispatch
    email = "test+dry-run-ops@example.com"
    await db.update_subscribers.delete_many({"email": email})
    await db.update_subscribers.insert_one({
        "email": email, "name": None,
        "subscribed_at": "2020-01-01T00:00:00", "unsubscribed_at": None,
        "unsubscribe_token": "tok-dr-ops", "joined_at_iter": "0",
    })
    await db.system_state.update_one(
        {"key": "updates_digest"},
        {"$set": {"key": "updates_digest", "last_dispatched_iter": "1"}},
        upsert=True,
    )
    with patch("email_service.send_ops_updates_dispatch_summary", new=AsyncMock()) as ops:
        r = await run_digest_dispatch(dry_run=True)
        assert r["dry_run"] is True
        # OPS summary must NOT fire on dry-run
        assert ops.await_count == 0
    await db.update_subscribers.delete_many({"email": email})


# ------------------------ CSV export ------------------------
# CSV export tests live in /app/backend/tests/test_iter98_csv_export.py
# (separate file because TestClient spawns its own loop that conflicts
# with Motor's module-scoped binding when run in the same module as
# the async DB tests above).
