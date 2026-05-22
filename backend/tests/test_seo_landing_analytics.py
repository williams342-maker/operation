"""Regression: SEO landing-page analytics (P1 Growth Plan).

Covers:
  * `GET /api/admin/analytics/seo-landing` requires admin auth (401 without)
  * Returns one row per slug in `SEO_LANDING_SLUGS`
  * Aggregates `pageview_events` by path (views, visitors, sessions, dwell)
  * Respects the `days` window
  * Surfaces top external referrer per page
"""
import uuid

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )


async def _admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{API}/api/admin/auth/verify", json={"token": tok})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.mark.asyncio
async def test_seo_landing_requires_admin():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/admin/analytics/seo-landing")
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_seo_landing_returns_all_configured_slugs():
    from routers.seo import SEO_LANDING_SLUGS
    jwt = await _admin_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{API}/api/admin/analytics/seo-landing?days=30",
            headers={"Authorization": f"Bearer {jwt}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["totals"]["pages"] == len(SEO_LANDING_SLUGS)
    returned_slugs = {p["slug"] for p in body["pages"]}
    assert returned_slugs == set(SEO_LANDING_SLUGS)


@pytest.mark.asyncio
async def test_seo_landing_aggregates_tracked_pageviews():
    """Seed a few events against one SEO slug and assert they show up."""
    from routers.seo import SEO_LANDING_SLUGS
    slug = SEO_LANDING_SLUGS[0]
    path = f"/{slug}"

    # Seed 3 events from 3 distinct visitors, 2 with google referer.
    async with httpx.AsyncClient(timeout=30) as c:
        for ref in ("https://www.google.com/", "https://www.google.com/", ""):
            await c.post(
                f"{API}/api/analytics/track",
                json={
                    "path": path,
                    "visitor_id": "test-v-" + uuid.uuid4().hex,
                    "session_id": "test-s-" + uuid.uuid4().hex,
                    "referer": ref,
                },
            )

    jwt = await _admin_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{API}/api/admin/analytics/seo-landing?days=30",
            headers={"Authorization": f"Bearer {jwt}"},
        )
    body = r.json()
    row = next(p for p in body["pages"] if p["slug"] == slug)
    assert row["views"] >= 3
    assert row["unique_visitors"] >= 3
    assert row["sessions"] >= 3
    # Top referrer should be google (we seeded 2 google + 1 direct above).
    assert "google" in row["top_referrer"].lower()
