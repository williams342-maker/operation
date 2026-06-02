"""iter316 — Admin lead-magnet inbox + 3-touch drip + feed-health tests.

Isolated test file (own fresh sub doc + monkey-patched email sender) so
it doesn't depend on or affect the iter303 lead-magnet tests.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

from server import app  # noqa: E402
from core import db  # noqa: E402
from maker_auth import issue_admin_magic_token  # noqa: E402

pytestmark = pytest.mark.asyncio


async def _admin_jwt() -> str:
    """Helper — mint an admin JWT via the verify endpoint."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Pick any active super-admin email — the env-defined one always works.
        from core import ADMIN_EMAILS
        email = next(iter(ADMIN_EMAILS))
        magic = issue_admin_magic_token(email)
        r = await ac.post("/api/admin/auth/verify", json={"token": magic})
        assert r.status_code == 200, r.text
        return r.json()["token"]


async def _seed_subscriber(email: str, *, age_days: int, consent: bool, drip_step: int = 0):
    """Insert a synthetic subscriber so the drip tick has something
    to chew on. Returns the inserted row's _id."""
    seeded_at = (datetime.now(timezone.utc) - timedelta(days=age_days)).isoformat()
    doc = {
        "email": email.lower(),
        "magnet": "starter-pack",
        "consent_marketing": consent,
        "first_seen_at": seeded_at,
        "latest_token_at": seeded_at,
        "drip_step": drip_step,
        "download_count": 0,
        "submission_count": 1,
        "source": "iter316-test",
    }
    await db.lead_magnet_subscribers.update_one(
        {"email": doc["email"], "magnet": "starter-pack"},
        {"$set": doc},
        upsert=True,
    )


# ────────────────────────────────────────────────────────────────────
# Admin lead-magnet inbox
# ────────────────────────────────────────────────────────────────────

async def test_admin_summary_returns_counts_and_top_sources():
    jwt = await _admin_jwt()
    await _seed_subscriber("iter316-fresh@example.com", age_days=1, consent=True)
    await _seed_subscriber("iter316-stale@example.com", age_days=40, consent=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/lead-magnet/summary",
                         headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 2
    assert body["new_7d"] >= 1          # fresh sub
    assert body["consented_to_marketing"] >= 1
    sources = {s["source"] for s in body["top_sources"]}
    assert "iter316-test" in sources
    # Drip funnel exposed
    assert "drip" in body and "eligible_audience" in body["drip"]


async def test_admin_subscribers_paginated_and_csv():
    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/lead-magnet/subscribers?limit=3",
                         headers={"Authorization": f"Bearer {jwt}"})
        assert r.status_code == 200
        body = r.json()
        assert len(body["subscribers"]) <= 3
        assert body["total"] >= len(body["subscribers"])
        # CSV
        r2 = await ac.get("/api/admin/lead-magnet/export.csv",
                          headers={"Authorization": f"Bearer {jwt}"})
        assert r2.status_code == 200
        assert "text/csv" in r2.headers["content-type"]
        text = r2.text
        # Header row + at least one data row
        assert text.startswith("email,first_seen_at,source")
        assert "iter316-test" in text or "starter-pack" in text or text.count("\n") >= 2


# ────────────────────────────────────────────────────────────────────
# Drip funnel
# ────────────────────────────────────────────────────────────────────

async def test_drip_dry_run_picks_consented_old_enough_subscribers(monkeypatch):
    # Two subscribers — one consented + 4 days old (should be candidate
    # for step 1), one un-consented + 4 days old (should be skipped).
    await db.lead_magnet_subscribers.delete_many({"email": {"$regex": "^iter316-drip-"}})
    await _seed_subscriber("iter316-drip-eligible@example.com", age_days=4, consent=True, drip_step=0)
    await _seed_subscriber("iter316-drip-noconsent@example.com", age_days=4, consent=False, drip_step=0)
    # Patch the email sender to a no-op so dry-run only counts.
    sent: list[tuple[str, str]] = []

    async def _fake_send(to, subject, html):
        sent.append((to, subject))

    monkeypatch.setattr("lead_magnet_drip._send", _fake_send)

    from lead_magnet_drip import run_drip_tick
    r = await run_drip_tick(dry_run=True)
    assert r["step1"]["candidates"] == 1, r
    assert r["step2"]["candidates"] == 0
    assert sent == []  # dry-run sends nothing


async def test_drip_send_advances_step_and_skips_already_makers(monkeypatch):
    # Three subscribers:
    #   A — consented, 4 days old, drip_step=0  → should get step 1
    #   B — consented, 8 days old, drip_step=1  → should get step 2
    #   C — consented, 4 days old, drip_step=0  → BUT email matches an
    #       approved maker; should be suppressed to step -1, no email.
    # Wipe ALL iter316-drip-* rows so the previous dry-run test's seeds
    # don't accidentally become candidates here.
    await db.lead_magnet_subscribers.delete_many({"email": {"$regex": "^iter316-drip-"}})
    await _seed_subscriber("iter316-drip-send-a@example.com", age_days=4, consent=True, drip_step=0)
    await _seed_subscriber("iter316-drip-send-b@example.com", age_days=8, consent=True, drip_step=1)
    await _seed_subscriber("iter316-drip-send-c@example.com", age_days=4, consent=True, drip_step=0)
    # Approved-maker decoy for C — must match the suppression query in
    # `_is_already_maker` (email + not deleted).
    await db.makers.update_one(
        {"slug": "iter316-test-maker"},
        {"$set": {"slug": "iter316-test-maker",
                  "email": "iter316-drip-send-c@example.com",
                  "deleted_at": None}},
        upsert=True,
    )

    sent: list[tuple[str, str]] = []

    async def _fake_send(to, subject, html):
        sent.append((to, subject))

    monkeypatch.setattr("lead_magnet_drip._send", _fake_send)

    from lead_magnet_drip import run_drip_tick
    r = await run_drip_tick(dry_run=False)

    assert r["step1"]["sent"] == 1, r            # A
    assert r["step1"]["suppressed"] == 1, r      # C
    assert r["step2"]["sent"] == 1, r            # B
    # 2 sends actually fired
    assert len(sent) == 2
    recipients = {s[0] for s in sent}
    assert recipients == {
        "iter316-drip-send-a@example.com",
        "iter316-drip-send-b@example.com",
    }

    # State assertions
    a = await db.lead_magnet_subscribers.find_one(
        {"email": "iter316-drip-send-a@example.com"})
    b = await db.lead_magnet_subscribers.find_one(
        {"email": "iter316-drip-send-b@example.com"})
    c = await db.lead_magnet_subscribers.find_one(
        {"email": "iter316-drip-send-c@example.com"})
    assert a["drip_step"] == 1
    assert b["drip_step"] == 2
    assert c["drip_step"] == -1
    assert c.get("drip_suppression_reason") == "already_maker"

    # Cleanup the decoy maker.
    await db.makers.delete_one({"slug": "iter316-test-maker"})


async def test_drip_resend_guard_blocks_double_send_within_24h(monkeypatch):
    # If we just sent to a row within 20h, a second tick must NOT pick it.
    await db.lead_magnet_subscribers.delete_many({"email": "iter316-guard@example.com"})
    await _seed_subscriber("iter316-guard@example.com", age_days=10, consent=True, drip_step=1)
    # Fake a recent send-stamp so the $nor guard excludes the row.
    await db.lead_magnet_subscribers.update_one(
        {"email": "iter316-guard@example.com"},
        {"$set": {"drip_last_sent_at": datetime.now(timezone.utc).isoformat()}},
    )

    async def _fake_send(to, subject, html):
        raise AssertionError(f"Should NOT have sent within guard window — got {to}")

    monkeypatch.setattr("lead_magnet_drip._send", _fake_send)

    from lead_magnet_drip import run_drip_tick
    r = await run_drip_tick(dry_run=False)
    assert r["step2"]["sent"] == 0, r


async def test_unsubscribe_flips_consent_and_step(monkeypatch):
    await db.lead_magnet_subscribers.delete_many({"email": "iter316-unsub@example.com"})
    await _seed_subscriber("iter316-unsub@example.com", age_days=2, consent=True, drip_step=1)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/lead-magnet/unsubscribe?email=iter316-unsub@example.com")
    assert r.status_code == 200
    assert "unsubscribed" in r.text.lower()
    row = await db.lead_magnet_subscribers.find_one(
        {"email": "iter316-unsub@example.com"})
    assert row["consent_marketing"] is False
    assert row["drip_step"] == -1


# ────────────────────────────────────────────────────────────────────
# Feed health
# ────────────────────────────────────────────────────────────────────

async def test_feed_health_returns_per_channel_buckets():
    jwt = await _admin_jwt()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/feeds/health",
                         headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "products_total" in body
    assert "channels" in body and isinstance(body["channels"], list)
    channels = {c["channel"] for c in body["channels"]}
    # All 6 channels exposed
    for ch in ("google_merchant", "pinterest", "meta", "enrichlabs",
               "showcase", "design_files"):
        assert ch in channels, f"Missing channel {ch}"
    for c in body["channels"]:
        assert "ready" in c and "blocked" in c and "total" in c
        assert c["total"] == c["ready"] + c["blocked"]
    assert "blocker_glossary" in body
