"""iter351 — GSC indexed-bucket WoW drop-off alert job.

Exercises the 3 branches of `_job_gsc_indexed_dropoff_alert`:
  1. GSC_ENABLED!=1 → silent skip
  2. drop ≤ threshold → silent skip + snapshot still persisted
  3. drop > threshold → snapshot + alert log written + email sent

The email send itself is monkey-patched so we don't actually fire Resend.
"""
from __future__ import annotations
import asyncio
import os
from datetime import datetime, timedelta, timezone

# Ensure env is sane before imports.
os.environ.setdefault("PUBLIC_SITE_URL", "https://craftersmarket.org")

import pytest  # noqa: E402

from core import db  # noqa: E402
from scheduler import (  # noqa: E402
    _job_gsc_indexed_dropoff_alert,
    _snapshot_gsc_indexation,
)
import email_service  # noqa: E402


TEST_DATE = "1999-01-01"  # Fixed sentinel, far enough away that real data
TEST_DATE_OLD = "1998-12-25"  # ≥6 days prior


async def _seed_prior_snapshot(*, indexed_pct: float, indexed_count: int = 70,
                               total: int = 100) -> None:
    """Inject a 'last week' snapshot directly into Mongo."""
    ts = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    await db.gsc_indexed_snapshots.replace_one(
        {"_id": TEST_DATE_OLD},
        {
            "_id": TEST_DATE_OLD,
            "date": TEST_DATE_OLD,
            "ts": ts,
            "tier_counts": {
                "established": indexed_count,
                "submitted": total - indexed_count,
                "not_in_sitemap": 0, "unchecked": 0,
            },
            "total_published": total,
            "indexed_count": indexed_count,
            "indexed_pct": indexed_pct,
        },
        upsert=True,
    )


async def _clear_snapshots():
    await db.gsc_indexed_snapshots.delete_many(
        {"_id": {"$in": [TEST_DATE, TEST_DATE_OLD]}}
    )
    await db.gsc_alert_log.delete_many({"kind": "indexed_dropoff"})


@pytest.mark.asyncio
async def test_skip_when_gsc_disabled(monkeypatch):
    monkeypatch.setenv("GSC_ENABLED", "0")
    sent = []
    monkeypatch.setattr(
        email_service, "send_ops_gsc_indexed_dropoff",
        lambda **kw: asyncio.sleep(0, result=False) or sent.append(kw),
    )
    await _clear_snapshots()
    await _job_gsc_indexed_dropoff_alert()
    # No snapshot persisted for today, no email sent.
    assert sent == []
    # gsc_alert_log should be empty for the kind.
    n = await db.gsc_alert_log.count_documents({"kind": "indexed_dropoff"})
    assert n == 0


@pytest.mark.asyncio
async def test_snapshot_persists_idempotently():
    """Direct call to _snapshot_gsc_indexation should write today's row
    keyed by UTC date — and re-running on the same day overwrites."""
    await _clear_snapshots()
    snap1 = await _snapshot_gsc_indexation()
    snap2 = await _snapshot_gsc_indexation()
    assert snap1["date"] == snap2["date"]
    assert snap1["total_published"] == snap2["total_published"]
    # Only one row should exist for today.
    n = await db.gsc_indexed_snapshots.count_documents({"_id": snap1["date"]})
    assert n == 1


@pytest.mark.asyncio
async def test_alert_fires_on_large_drop(monkeypatch):
    """When prior snapshot says 80% indexed and current says 60%, drop is
    20pp > threshold (5pp) → email fires + alert log row written."""
    monkeypatch.setenv("GSC_ENABLED", "1")
    monkeypatch.setenv("GSC_INDEXED_DROP_THRESHOLD_PP", "5")
    captured: dict = {}

    async def _fake_send(**kw):
        captured.update(kw)
        return True

    monkeypatch.setattr(email_service, "send_ops_gsc_indexed_dropoff", _fake_send)
    await _clear_snapshots()
    # Prior: 80% (80/100). Need to inject a fake "today's snapshot too" so the
    # job's read of current returns ~lower-than-prior. But the job calls
    # _snapshot_gsc_indexation() which reads from db.products — and we can't
    # easily mutate the real catalog. Instead, monkeypatch _snapshot_gsc_indexation
    # to return a controlled 60% reading.
    from datetime import datetime, timezone
    now_iso_str = datetime.now(timezone.utc).isoformat()
    fake_current = {
        "_id": TEST_DATE,
        "date": TEST_DATE,
        "ts": now_iso_str,
        "tier_counts": {"established": 60, "submitted": 40,
                        "not_in_sitemap": 0, "unchecked": 0},
        "total_published": 100,
        "indexed_count": 60,
        "indexed_pct": 60.0,
    }

    async def _fake_snapshot():
        await db.gsc_indexed_snapshots.replace_one(
            {"_id": TEST_DATE}, fake_current, upsert=True,
        )
        return fake_current

    import scheduler
    monkeypatch.setattr(scheduler, "_snapshot_gsc_indexation", _fake_snapshot)
    await _seed_prior_snapshot(indexed_pct=80.0, indexed_count=80, total=100)

    await _job_gsc_indexed_dropoff_alert()
    # Email was dispatched with the right WoW math.
    assert captured.get("current_indexed") == 60
    assert captured.get("prior_indexed") == 80
    assert abs(captured.get("drop_pp", 0) - 20.0) < 0.01
    # Alert log was written.
    log_row = await db.gsc_alert_log.find_one({"kind": "indexed_dropoff"})
    assert log_row is not None
    assert log_row.get("email_sent") is True
    assert abs(log_row.get("drop_pp", 0) - 20.0) < 0.01


@pytest.mark.asyncio
async def test_no_alert_within_threshold(monkeypatch):
    """When drop is within threshold (e.g. 2pp), no email + no log row."""
    monkeypatch.setenv("GSC_ENABLED", "1")
    monkeypatch.setenv("GSC_INDEXED_DROP_THRESHOLD_PP", "5")
    sent_calls = []

    async def _fake_send(**kw):
        sent_calls.append(kw)
        return True

    monkeypatch.setattr(email_service, "send_ops_gsc_indexed_dropoff", _fake_send)
    await _clear_snapshots()

    from datetime import datetime, timezone
    now_iso_str = datetime.now(timezone.utc).isoformat()
    fake_current = {
        "_id": TEST_DATE,
        "date": TEST_DATE,
        "ts": now_iso_str,
        "tier_counts": {"established": 78, "submitted": 22,
                        "not_in_sitemap": 0, "unchecked": 0},
        "total_published": 100,
        "indexed_count": 78,
        "indexed_pct": 78.0,
    }

    async def _fake_snapshot():
        await db.gsc_indexed_snapshots.replace_one(
            {"_id": TEST_DATE}, fake_current, upsert=True,
        )
        return fake_current

    import scheduler
    monkeypatch.setattr(scheduler, "_snapshot_gsc_indexation", _fake_snapshot)
    await _seed_prior_snapshot(indexed_pct=80.0, indexed_count=80, total=100)
    await _job_gsc_indexed_dropoff_alert()
    assert sent_calls == []
    n = await db.gsc_alert_log.count_documents({"kind": "indexed_dropoff"})
    assert n == 0


@pytest.mark.asyncio
async def test_no_alert_when_no_prior_snapshot(monkeypatch):
    """Bootstrap-mode: first ever run, no prior snapshot → silent skip."""
    monkeypatch.setenv("GSC_ENABLED", "1")
    sent_calls = []
    monkeypatch.setattr(
        email_service, "send_ops_gsc_indexed_dropoff",
        lambda **kw: asyncio.sleep(0, result=False) or sent_calls.append(kw),
    )
    await _clear_snapshots()
    # Don't seed prior; ensure no snapshot exists ≥6 days old.
    await db.gsc_indexed_snapshots.delete_many({
        "ts": {"$lte": (datetime.now(timezone.utc) - timedelta(days=6)).isoformat()}
    })
    # Need a fake current that doesn't tank the test by needing 10+ real listings
    fake_current = {
        "_id": TEST_DATE, "date": TEST_DATE,
        "ts": datetime.now(timezone.utc).isoformat(),
        "tier_counts": {"established": 50, "submitted": 50,
                        "not_in_sitemap": 0, "unchecked": 0},
        "total_published": 100, "indexed_count": 50, "indexed_pct": 50.0,
    }

    async def _fake_snapshot():
        await db.gsc_indexed_snapshots.replace_one(
            {"_id": TEST_DATE}, fake_current, upsert=True,
        )
        return fake_current

    import scheduler
    monkeypatch.setattr(scheduler, "_snapshot_gsc_indexation", _fake_snapshot)
    await _job_gsc_indexed_dropoff_alert()
    assert sent_calls == []


@pytest.mark.asyncio
async def test_email_renderer_signature():
    """Smoke-check the email_service function renders an HTML body
    when OPS_EMAIL is set (no actual network call — we monkeypatch _send)."""
    # If OPS_EMAIL is empty, function returns False without errors.
    if not email_service.OPS_EMAIL:
        ok = await email_service.send_ops_gsc_indexed_dropoff(
            current_indexed=60, prior_indexed=80,
            current_total=100, prior_total=100,
            current_pct=60.0, prior_pct=80.0,
            drop_pp=20.0, snapshot_ts="2026-06-10T06:15:00+00:00",
        )
        assert ok is False
        return
    # Otherwise verify a successful dispatch (mock the _send wrapper).
    sent = {}

    async def _fake_internal_send(to, subject, html):
        sent["to"] = to
        sent["subject"] = subject
        sent["html"] = html

    import email_service as es
    es._send = _fake_internal_send  # type: ignore
    ok = await es.send_ops_gsc_indexed_dropoff(
        current_indexed=60, prior_indexed=80,
        current_total=100, prior_total=100,
        current_pct=60.0, prior_pct=80.0,
        drop_pp=20.0, snapshot_ts="2026-06-10T06:15:00+00:00",
    )
    assert ok is True
    assert "Indexation alert" in sent["html"]
    assert "20.0pp" in sent["html"] or "20.0" in sent["html"]
    assert "Indexed listings down" in sent["subject"]
