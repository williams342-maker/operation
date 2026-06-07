"""iter335.16 — Maker-facing channel-split hint + theme suggestions digest."""
from __future__ import annotations
import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
import pytest_asyncio
from datetime import datetime, timedelta, timezone
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio

MAKER_SLUG = "split-test-maker"
MAKER_EMAIL = "split-test@craftersmarket.org"


def _maker_jwt() -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(MAKER_SLUG, MAKER_EMAIL, role="maker", session_version=0)


@pytest_asyncio.fixture(autouse=True)
async def _seed():
    from core import db
    # Wipe everything our tests touch.
    for col in ("channel_weights", "products", "orders", "theme_campaigns",
                "theme_digest_marker", "makers"):
        await getattr(db, col).delete_many({"$or": [
            {"_id": {"$in": ["google", "meta", "microsoft", "global"]}},
            {"slug": MAKER_SLUG},
            {"slug": {"$regex": "^split-test-"}},
            {"maker_slug": MAKER_SLUG},
            {"session_id": {"$regex": "^split-test-"}},
        ]})
    await db.makers.insert_one({
        "slug": MAKER_SLUG, "email": MAKER_EMAIL,
        "name": "Split Test", "status": "approved",
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    yield


# ── /api/promote/channel-split ────────────────────────────────────────
async def test_channel_split_requires_auth():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/promote/channel-split")
    assert r.status_code in (401, 403)


async def test_channel_split_returns_cold_start_when_no_weights():
    """No persisted weights → endpoint still returns 200 with cold-start
    equal weights across whatever channels the maker is eligible for."""
    from server import app
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/promote/channel-split", headers=h)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["cold_start"] is True
    assert data["basis"] == "cold-start"
    assert len(data["channels"]) == 3
    # No channel is eligible by default → eligible_channels=0
    assert data["eligible_channels"] == 0


async def test_channel_split_normalizes_over_eligible_channels(monkeypatch):
    """Eligibility-aware: ineligible channels get weight=0, eligible
    channels' weights re-normalize to sum to 1.0."""
    from core import db
    await db.channel_weights.insert_many([
        {"_id": "google", "channel": "google", "weight": 0.6,
         "roas": 5.0, "orders_30d": 12, "revenue_cents_30d": 120000,
         "spend_cents_30d": 24000, "lift": 5.0, "window_days": 30,
         "computed_at": "2026-06-07T00:00:00+00:00"},
        {"_id": "meta", "channel": "meta", "weight": 0.3,
         "roas": 2.0, "orders_30d": 6, "revenue_cents_30d": 60000,
         "spend_cents_30d": 30000, "lift": 2.0, "window_days": 30,
         "computed_at": "2026-06-07T00:00:00+00:00"},
        {"_id": "microsoft", "channel": "microsoft", "weight": 0.1,
         "roas": 0.5, "orders_30d": 0, "revenue_cents_30d": 0,
         "spend_cents_30d": 5000, "lift": 0.5, "window_days": 30,
         "computed_at": "2026-06-07T00:00:00+00:00"},
    ])

    # Mock the gateway adapters so google + meta are eligible, microsoft is not.
    from services import ads_gateway

    class FakeGateway:
        def __init__(self, eligible, reason=""):
            self._e = eligible
            self._r = reason
        async def is_eligible(self, maker_slug):
            return (self._e, self._r if not self._e else None)

    def fake_get_gateway(ch):
        if ch == "microsoft":
            return FakeGateway(False, "Connect Microsoft Ads to unlock")
        return FakeGateway(True)

    monkeypatch.setattr("routers.promote.get_gateway", fake_get_gateway)

    from server import app
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/promote/channel-split", headers=h)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["cold_start"] is False
    assert data["basis"] == "marketplace"
    assert data["eligible_channels"] == 2

    by_ch = {c["channel"]: c for c in data["channels"]}
    # google (raw 0.6) + meta (raw 0.3) re-normalized to sum=1.0
    # google: 0.6 / 0.9 = 0.6667; meta: 0.3 / 0.9 = 0.3333
    assert abs(by_ch["google"]["weight"] - 0.6667) < 0.01
    assert abs(by_ch["meta"]["weight"] - 0.3333) < 0.01
    # Microsoft is ineligible → weight clamped to 0, note explains why
    assert by_ch["microsoft"]["weight"] == 0.0
    assert by_ch["microsoft"]["eligible"] is False
    assert "Microsoft" in (by_ch["microsoft"]["note"] or "")
    # Eligible channels with ROAS get the strong-lift note
    assert "ROAS" in (by_ch["google"]["note"] or "")


async def test_channel_split_equal_when_all_eligible_have_zero_weight(monkeypatch):
    """All eligible channels but ZERO raw weight → equal split fallback."""
    from core import db
    # Persist 0-weight rows for all 3 channels (degenerate case)
    for ch in ("google", "meta", "microsoft"):
        await db.channel_weights.insert_one({
            "_id": ch, "channel": ch, "weight": 0.0, "roas": 0.0,
            "orders_30d": 0, "revenue_cents_30d": 0, "spend_cents_30d": 0,
            "lift": 0.5, "window_days": 30,
            "computed_at": "2026-06-07T00:00:00+00:00",
        })

    from services import ads_gateway

    class FakeGateway:
        async def is_eligible(self, maker_slug):
            return (True, None)

    monkeypatch.setattr("routers.promote.get_gateway", lambda ch: FakeGateway())

    from server import app
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/promote/channel-split", headers=h)
    data = r.json()
    assert data["eligible_channels"] == 3
    weights = [c["weight"] for c in data["channels"] if c["eligible"]]
    # All three eligible → each gets ~0.333
    assert all(abs(w - 1/3) < 0.01 for w in weights)


# ── Theme digest email + cron ──────────────────────────────────────────
async def test_send_ops_trending_themes_digest_skips_when_no_ops_email(monkeypatch):
    """No OPS_EMAIL configured → no send, returns False."""
    monkeypatch.setattr("email_service.OPS_EMAIL", "")
    from email_service import send_ops_trending_themes_digest
    sent = await send_ops_trending_themes_digest([
        {"tag": "x", "growth_pct": 99,
         "draft": {"name": "X Week", "slug": "x-week",
                   "pool_total_cents": 50000, "per_maker_cap_cents": 5000,
                   "start_date": "2026-06-08", "end_date": "2026-06-15"}}
    ])
    assert sent is False


async def test_send_ops_trending_themes_digest_skips_empty(monkeypatch):
    monkeypatch.setattr("email_service.OPS_EMAIL", "ops@example.com")
    from email_service import send_ops_trending_themes_digest
    sent = await send_ops_trending_themes_digest([])
    assert sent is False


async def test_send_ops_trending_themes_digest_sends_with_suggestions(monkeypatch):
    """With suggestions + OPS_EMAIL → invokes the mailer and returns True."""
    monkeypatch.setattr("email_service.OPS_EMAIL", "ops@example.com")
    calls = []

    async def fake_send(to, subject, html):
        calls.append({"to": to, "subject": subject, "html": html})
        return True

    monkeypatch.setattr("email_service._send", fake_send)
    from email_service import send_ops_trending_themes_digest
    sent = await send_ops_trending_themes_digest([
        {"tag": "patio-furniture", "growth_pct": 75, "recent_orders": 8,
         "distinct_makers": 3,
         "draft": {"name": "Patio Furniture Week",
                   "slug": "patio-furniture-week",
                   "pool_total_cents": 50000,
                   "per_maker_cap_cents": 5000,
                   "start_date": "2026-06-08", "end_date": "2026-06-15"}}
    ])
    assert sent is True
    assert len(calls) == 1
    assert calls[0]["to"] == "ops@example.com"
    assert "1 hot tag" in calls[0]["subject"]
    assert "PATIO FURNITURE WEEK" in calls[0]["html"].upper()
    assert "+75%" in calls[0]["html"]


async def test_theme_digest_cron_idempotent(monkeypatch):
    """Same UTC day → second call skips."""
    monkeypatch.setattr("email_service.OPS_EMAIL", "ops@example.com")
    send_calls = []
    async def fake_send(to, subject, html):
        send_calls.append(1)
        return True
    monkeypatch.setattr("email_service._send", fake_send)

    # Mock theme_suggestions.suggest to return a high-growth tag.
    from services import theme_suggestions
    async def fake_suggest(limit=20):
        return {
            "suggestions": [{
                "tag": "boho-decor", "growth_pct": 80,
                "recent_orders": 5, "distinct_makers": 2,
                "draft": {"name": "Boho Decor Week",
                          "slug": "boho-decor-week",
                          "pool_total_cents": 50000,
                          "per_maker_cap_cents": 5000,
                          "start_date": "2026-06-08", "end_date": "2026-06-15"},
            }],
            "recent_window_days": 7, "baseline_window_days": 7,
            "computed_at": "2026-06-07T00:00:00+00:00",
        }
    monkeypatch.setattr(theme_suggestions, "suggest", fake_suggest)

    from scheduler import _job_theme_suggestions_digest
    await _job_theme_suggestions_digest()
    assert len(send_calls) == 1
    # Second run on the same day → marker prevents duplicate send.
    await _job_theme_suggestions_digest()
    assert len(send_calls) == 1

    # Verify marker was stamped.
    from core import db
    marker = await db.theme_digest_marker.find_one({"_id": "global"})
    assert marker is not None
    assert "boho-decor" in marker.get("last_tags", [])


async def test_theme_digest_cron_skips_below_threshold(monkeypatch):
    """Tag with growth < 50% → no email."""
    monkeypatch.setattr("email_service.OPS_EMAIL", "ops@example.com")
    send_calls = []
    async def fake_send(to, subject, html):
        send_calls.append(1)
        return True
    monkeypatch.setattr("email_service._send", fake_send)

    from services import theme_suggestions
    async def fake_suggest(limit=20):
        # 30% growth — below 50% threshold
        return {
            "suggestions": [{"tag": "lowgrowth", "growth_pct": 30,
                             "recent_orders": 5, "distinct_makers": 2,
                             "draft": {"name": "Low", "slug": "low",
                                       "pool_total_cents": 50000,
                                       "per_maker_cap_cents": 5000,
                                       "start_date": "2026-06-08",
                                       "end_date": "2026-06-15"}}],
            "recent_window_days": 7, "baseline_window_days": 7,
            "computed_at": "2026-06-07T00:00:00+00:00",
        }
    monkeypatch.setattr(theme_suggestions, "suggest", fake_suggest)

    from scheduler import _job_theme_suggestions_digest
    await _job_theme_suggestions_digest()
    assert send_calls == []
    # No marker either.
    from core import db
    marker = await db.theme_digest_marker.find_one({"_id": "global"})
    assert marker is None
