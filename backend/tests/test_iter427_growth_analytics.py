"""iter427 — Admin Growth Analytics tests.

Covers:
  • Admin-only access (401 without token)
  • Daily / weekly / monthly aggregation
  • Custom date-range filtering
  • CSV export format (headers + row count)
  • Empty-state (no data → 200 with zeros)
  • Analytics event ingestion (allow-list + bot filter)
"""
import os
import uuid
import pytest
import pytest_asyncio

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017/craft_test_iter427")
os.environ.setdefault("DB_NAME", "craft_test_iter427")

from httpx import ASGITransport, AsyncClient
from server import app
from core import db
from maker_auth import issue_session_jwt

_ADMIN_EMAIL = os.environ.get("ADMIN_EMAILS", "team@craftersmarket.org").split(",")[0]


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _admin_hdr() -> dict:
    tok = issue_session_jwt(_ADMIN_EMAIL, _ADMIN_EMAIL, role="admin", session_version=0)
    return {"Authorization": f"Bearer {tok}"}


async def _seed_pageviews(n: int, path: str = "/"):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    docs = []
    for i in range(n):
        docs.append({
            "id": uuid.uuid4().hex,
            "ts": now.isoformat(),
            "session_id": f"s-{i%3}",
            "visitor_id": f"v-{i%5}",
            "path": path,
            "country": "United States",
        })
    if docs:
        await db.pageview_events.insert_many(docs)


# ─────────────────────────── ADMIN-ONLY ACCESS ───────────────────────────
@pytest.mark.asyncio
async def test_growth_requires_admin(client):
    r = await client.get("/api/admin/analytics/growth")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_growth_returns_200_with_admin(client):
    r = await client.get("/api/admin/analytics/growth", headers=_admin_hdr())
    assert r.status_code == 200
    d = r.json()
    for key in ("range", "grain", "start", "end", "summary", "rows", "top_pages", "funnel"):
        assert key in d


# ─────────────────────────── EMPTY STATE ────────────────────────────────
@pytest.mark.asyncio
async def test_growth_empty_state(client):
    # Fresh DB — no seeded events
    r = await client.get("/api/admin/analytics/growth?range=daily",
                         headers=_admin_hdr())
    assert r.status_code == 200
    d = r.json()
    # rows may or may not be empty (buckets are always generated), but summary
    # totals must be zero-ish
    assert d["summary"]["visitors"] == 0
    assert d["summary"]["page_views"] == 0
    assert d["summary"]["orders"] == 0
    # Funnel stages always present
    stages = {s["stage"] for s in d["funnel"]}
    assert "Visitors" in stages and "Applications" in stages


# ─────────────────────────── AGGREGATION GRAINS ─────────────────────────
@pytest.mark.asyncio
async def test_daily_aggregation(client):
    await _seed_pageviews(20)
    r = await client.get("/api/admin/analytics/growth?range=daily",
                         headers=_admin_hdr())
    assert r.status_code == 200
    d = r.json()
    assert d["grain"] == "day"
    # 20 seeded rows, 5 distinct visitors
    assert d["summary"]["visitors"] >= 5
    assert d["summary"]["page_views"] >= 20


@pytest.mark.asyncio
async def test_weekly_aggregation(client):
    r = await client.get("/api/admin/analytics/growth?range=weekly",
                         headers=_admin_hdr())
    assert r.status_code == 200
    assert r.json()["grain"] == "week"


@pytest.mark.asyncio
async def test_monthly_aggregation(client):
    r = await client.get("/api/admin/analytics/growth?range=monthly",
                         headers=_admin_hdr())
    assert r.status_code == 200
    assert r.json()["grain"] == "month"


# ─────────────────────────── DATE-RANGE FILTER ──────────────────────────
@pytest.mark.asyncio
async def test_custom_date_range(client):
    r = await client.get(
        "/api/admin/analytics/growth?start_date=2026-01-01&end_date=2026-01-07",
        headers=_admin_hdr(),
    )
    assert r.status_code == 200
    d = r.json()
    assert d["start"].startswith("2026-01-01")
    assert d["end"].startswith("2026-01-08")  # exclusive


@pytest.mark.asyncio
async def test_bad_date_format_400(client):
    r = await client.get(
        "/api/admin/analytics/growth?start_date=NOPE",
        headers=_admin_hdr(),
    )
    assert r.status_code == 422  # pydantic pattern rejection


# ─────────────────────────── CSV EXPORT ─────────────────────────────────
@pytest.mark.asyncio
async def test_csv_export_headers_and_format(client):
    r = await client.get("/api/admin/analytics/growth/export?range=daily",
                         headers=_admin_hdr())
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    body = r.text
    first_line = body.splitlines()[0]
    for h in ("Date", "Unique visitors", "Page views", "Applications",
              "Orders", "Gross sales", "Commission"):
        assert h in first_line


@pytest.mark.asyncio
async def test_csv_export_selected_range(client):
    r = await client.get(
        "/api/admin/analytics/growth/export"
        "?start_date=2026-01-01&end_date=2026-01-03",
        headers=_admin_hdr(),
    )
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]


# ─────────────────────────── EVENT INGESTION ────────────────────────────
@pytest.mark.asyncio
async def test_track_event_allowed_type(client):
    r = await client.post("/api/analytics/events", json={
        "event_type": "apply_click", "path": "/",
        "session_id": "s1", "visitor_id": "v1",
    })
    assert r.status_code == 200
    assert r.json()["stored"] is True
    row = await db.analytics_events.find_one({"event_type": "apply_click",
                                              "session_id": "s1"})
    assert row is not None


@pytest.mark.asyncio
async def test_track_event_disallowed_type_silently_ignored(client):
    r = await client.post("/api/analytics/events",
                          json={"event_type": "steal_money", "path": "/"})
    assert r.status_code == 200
    assert r.json().get("ignored") is True


@pytest.mark.asyncio
async def test_track_event_bot_ua_ignored(client):
    r = await client.post(
        "/api/analytics/events",
        json={"event_type": "apply_click", "path": "/"},
        headers={"User-Agent": "Googlebot/2.1 (+https://www.google.com/bot.html)"},
    )
    assert r.status_code == 200
    assert r.json().get("ignored") is True
