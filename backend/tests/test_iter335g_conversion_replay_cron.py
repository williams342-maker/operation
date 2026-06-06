"""iter335.8 — Conversion replay cron tests.

Verifies the daily sweep:
  • Errored rows from the last 7 days get retried
  • Successful rows from the log are not re-fired (idempotency)
  • Rows older than 7 days are SKIPPED (ad platforms reject conversions
    older than their attribution window)
  • Per-channel isolation continues during replay (Meta still down →
    Google still uploads)
  • Missing payment_transactions rows are gracefully skipped (no crash)
"""
from __future__ import annotations
import os
import sys
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
import pytest_asyncio

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture(autouse=True)
async def _isolate_db():
    from core import db
    await db.conversion_upload_log.delete_many({})
    await db.payment_transactions.delete_many({})
    yield


async def _seed_failed_upload(session_id: str, channel: str,
                              uploaded_at: str = None) -> None:
    """Insert a fake `err:` log row + the matching payment_transactions row."""
    from core import db
    when = uploaded_at or datetime.now(timezone.utc).isoformat()
    await db.conversion_upload_log.update_one(
        {"session_id": session_id, "channel": channel},
        {"$set": {
            "session_id": session_id, "channel": channel,
            "status": "err:transient outage",
            "amount_cents": 5000, "currency": "usd",
            "uploaded_at": when,
        }},
        upsert=True,
    )
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {
            "session_id": session_id, "customer_email": "x@y.com",
            "amount": 5000, "currency": "usd",
            "fbclid": "FB.1.abc", "gclid": "Cj0abc", "msclkid": "ms_xyz",
        }},
        upsert=True,
    )


async def test_replay_retries_recent_errored_rows(monkeypatch):
    """A failed Meta upload from yesterday must be retried on the next
    cron run."""
    import services.conversions_uploader as mod
    from scheduler import _job_conversion_replay

    await _seed_failed_upload("cs_yday", "meta")

    calls = {"meta": 0}
    async def fake_meta(*a, **kw): calls["meta"] += 1
    async def fake_google(*a, **kw): pass
    async def fake_microsoft(*a, **kw): pass
    monkeypatch.setattr(mod, "_upload_meta", fake_meta)
    monkeypatch.setattr(mod, "_upload_google", fake_google)
    monkeypatch.setattr(mod, "_upload_microsoft", fake_microsoft)

    await _job_conversion_replay()
    assert calls["meta"] == 1


async def test_replay_skips_already_successful_rows(monkeypatch):
    """If a row is already `ok` in the log, the replay must NOT touch
    it again — even though the session_id is also referenced by an
    errored row on a different channel."""
    from core import db
    import services.conversions_uploader as mod
    from scheduler import _job_conversion_replay

    # Meta succeeded, Google failed → only Google should retry.
    await _seed_failed_upload("cs_mixed", "google")
    await db.conversion_upload_log.update_one(
        {"session_id": "cs_mixed", "channel": "meta"},
        {"$set": {
            "session_id": "cs_mixed", "channel": "meta", "status": "ok",
            "amount_cents": 5000, "currency": "usd",
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )

    calls = {"meta": 0, "google": 0}
    async def fake_meta(*a, **kw): calls["meta"] += 1
    async def fake_google(*a, **kw): calls["google"] += 1
    async def fake_microsoft(*a, **kw): pass
    monkeypatch.setattr(mod, "_upload_meta", fake_meta)
    monkeypatch.setattr(mod, "_upload_google", fake_google)
    monkeypatch.setattr(mod, "_upload_microsoft", fake_microsoft)

    await _job_conversion_replay()
    # Meta already ok → must not re-fire.
    assert calls["meta"] == 0
    # Google was err: + retried.
    assert calls["google"] == 1


async def test_replay_skips_rows_older_than_7_days(monkeypatch):
    """Meta + Google reject conversions outside their attribution
    window — don't even try."""
    import services.conversions_uploader as mod
    from scheduler import _job_conversion_replay

    old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    await _seed_failed_upload("cs_old", "meta", uploaded_at=old)

    calls = {"meta": 0}
    async def fake_meta(*a, **kw): calls["meta"] += 1
    monkeypatch.setattr(mod, "_upload_meta", fake_meta)
    monkeypatch.setattr(mod, "_upload_google", lambda *a, **kw: None)
    monkeypatch.setattr(mod, "_upload_microsoft", lambda *a, **kw: None)

    await _job_conversion_replay()
    assert calls["meta"] == 0, "stale row was retried, but it should be skipped"


async def test_replay_handles_missing_payment_transaction_gracefully(monkeypatch):
    """If conversion_upload_log has an `err:` row but the matching
    payment_transactions doc was purged, skip silently — don't crash
    the whole cron."""
    from core import db
    from scheduler import _job_conversion_replay

    # Errored log row, NO payment_transactions row.
    await db.conversion_upload_log.insert_one({
        "session_id": "cs_orphan", "channel": "meta",
        "status": "err:something", "amount_cents": 5000, "currency": "usd",
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    })

    # Should complete without raising.
    await _job_conversion_replay()


async def test_replay_partial_success_updates_only_succeeded_channels(monkeypatch):
    """If Meta is still down but Google recovers, only Google's log
    row flips to `ok`. Meta's row stays `err:` so the next cron tries
    again."""
    from core import db
    import services.conversions_uploader as mod
    from scheduler import _job_conversion_replay

    await _seed_failed_upload("cs_partial", "meta")
    await _seed_failed_upload("cs_partial", "google")

    async def boom_meta(*a, **kw): raise RuntimeError("Meta still down")
    async def ok_google(*a, **kw): return
    monkeypatch.setattr(mod, "_upload_meta", boom_meta)
    monkeypatch.setattr(mod, "_upload_google", ok_google)
    monkeypatch.setattr(mod, "_upload_microsoft", lambda *a, **kw: None)

    await _job_conversion_replay()

    meta_row = await db.conversion_upload_log.find_one(
        {"session_id": "cs_partial", "channel": "meta"})
    google_row = await db.conversion_upload_log.find_one(
        {"session_id": "cs_partial", "channel": "google"})
    assert meta_row["status"].startswith("err:")
    assert google_row["status"] == "ok"
