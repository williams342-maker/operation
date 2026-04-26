"""Iter25 — Crafters Plus monthly ROI digest job."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _async_find(rows):
    cursor = MagicMock()
    cursor.sort = MagicMock(return_value=cursor)
    cursor.to_list = AsyncMock(return_value=rows)
    return MagicMock(return_value=cursor)


@pytest.mark.asyncio
async def test_digest_dry_run_skips_makers_below_threshold():
    """Free-tier maker with $400/30d shouldn't be a candidate (threshold $500)."""
    from digests import run_plus_roi_digest
    fake_db = MagicMock()
    fake_db.makers.find = _async_find([
        {"slug": "low-volume", "email": "lv@x.com", "name": "Low Volume",
         "subscription_status": "free"},
    ])
    fake_db.maker_payouts.find = _async_find([
        {"maker_slug": "low-volume", "amount": 400.0},
    ])
    with patch("digests.db", fake_db):
        r = await run_plus_roi_digest(apply=False)
    assert r["candidate_count"] == 0
    assert r["mode"] == "dry-run"


@pytest.mark.asyncio
async def test_digest_includes_makers_above_threshold():
    """Free-tier maker doing $1500/30d → on the candidate list with computed savings."""
    from digests import run_plus_roi_digest
    fake_db = MagicMock()
    fake_db.makers.find = _async_find([
        {"slug": "iron-and-oak", "email": "io@x.com", "name": "Iron & Oak",
         "subscription_status": "free"},
    ])
    fake_db.maker_payouts.find = _async_find([
        {"maker_slug": "iron-and-oak", "amount": 1500.0},
    ])
    with patch("digests.db", fake_db):
        r = await run_plus_roi_digest(apply=False)
    assert r["candidate_count"] == 1
    c = r["candidates"][0]
    assert c["slug"] == "iron-and-oak"
    assert c["gross_30d"] == 1500.0
    # 1% of $1500 = $15 saved on commission
    assert c["commission_savings"] == 15.0
    # Net of $12/mo subscription = +$3
    assert c["net_benefit"] == 3.0


@pytest.mark.asyncio
async def test_digest_excludes_active_plus_subscribers():
    """Plus subscribers shouldn't get the upsell digest — they already pay."""
    from digests import run_plus_roi_digest
    fake_db = MagicMock()
    # Mongo `$nin` filter should exclude active+trialing — emulate by
    # returning [] (the actual query filter is verified separately).
    fake_db.makers.find = _async_find([])
    fake_db.maker_payouts.find = _async_find([])
    with patch("digests.db", fake_db):
        r = await run_plus_roi_digest(apply=False)
    assert r["candidate_count"] == 0
    # Verify the find filter excludes active+trialing.
    call_args, _ = fake_db.makers.find.call_args
    filt = call_args[0]
    assert {"subscription_status": {"$nin": ["active", "trialing"]}} in filt["$or"]


@pytest.mark.asyncio
async def test_digest_respects_cooldown_window():
    """A maker emailed within the last 25 days should be skipped."""
    from digests import run_plus_roi_digest
    recent = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    fake_db = MagicMock()
    fake_db.makers.find = _async_find([
        {"slug": "recent", "email": "r@x.com", "name": "Recent",
         "subscription_status": "free", "last_plus_roi_digest_sent_at": recent},
    ])
    fake_db.maker_payouts.find = _async_find([{"maker_slug": "recent", "amount": 1000.0}])
    fake_db.makers.update_one = AsyncMock()
    with patch("digests.db", fake_db), \
         patch("digests.send_maker_plus_roi_digest", AsyncMock(return_value={"id": "abc"})):
        r = await run_plus_roi_digest(apply=True)
    # Cooldown means no candidate, no send, but counted as skipped.
    assert r["candidate_count"] == 0
    assert r["sent"] == 0
    assert r["skipped"] == 1
    assert fake_db.makers.update_one.await_count == 0


@pytest.mark.asyncio
async def test_digest_apply_sends_email_and_stamps_timestamp():
    """End-to-end happy path: candidate → send email → stamp timestamp."""
    from digests import run_plus_roi_digest
    fake_db = MagicMock()
    fake_db.makers.find = _async_find([
        {"slug": "ready", "email": "ready@x.com", "name": "Ready",
         "subscription_status": "free"},
    ])
    fake_db.maker_payouts.find = _async_find([{"maker_slug": "ready", "amount": 2000.0}])
    fake_db.makers.update_one = AsyncMock()
    sender = AsyncMock(return_value={"message_id": "ms_123"})
    with patch("digests.db", fake_db), \
         patch("digests.send_maker_plus_roi_digest", sender):
        r = await run_plus_roi_digest(apply=True)
    assert r["sent"] == 1
    assert r["skipped"] == 0
    assert sender.await_count == 1
    # Verify the email got the correct numbers
    kwargs = sender.await_args.kwargs
    assert kwargs["maker_email"] == "ready@x.com"
    assert kwargs["gross_30d"] == 2000.0
    assert kwargs["commission_savings"] == 20.0
    assert kwargs["net_benefit"] == 8.0
    assert "utm_source=email" in kwargs["upgrade_link"]
    # Verify stamp was written
    assert fake_db.makers.update_one.await_count == 1
    update_call = fake_db.makers.update_one.await_args
    assert update_call[0][0] == {"slug": "ready"}
    assert "last_plus_roi_digest_sent_at" in update_call[0][1]["$set"]


@pytest.mark.asyncio
async def test_digest_skipped_when_email_provider_returns_none():
    """If MailerSend rejects (returns None), don't stamp — let next run retry."""
    from digests import run_plus_roi_digest
    fake_db = MagicMock()
    fake_db.makers.find = _async_find([
        {"slug": "fail", "email": "f@x.com", "name": "Fail",
         "subscription_status": "free"},
    ])
    fake_db.maker_payouts.find = _async_find([{"maker_slug": "fail", "amount": 1500.0}])
    fake_db.makers.update_one = AsyncMock()
    with patch("digests.db", fake_db), \
         patch("digests.send_maker_plus_roi_digest", AsyncMock(return_value=None)):
        r = await run_plus_roi_digest(apply=True)
    assert r["sent"] == 0
    assert r["skipped"] == 1
    # No timestamp stamped → maker is eligible to retry next run
    assert fake_db.makers.update_one.await_count == 0
