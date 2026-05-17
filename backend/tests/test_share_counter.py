"""Tests for the share-counter API (iter148).

  • POST /share/track + GET /share/count → counter monotonically
    increments up to the per-IP daily cap, then plateaus.
  • Bogus `kind` value → 422 from Pydantic (defense at the boundary).
  • Admin top-shared aggregation surfaces the right ordering.

We hit the live local FastAPI at port 8001 (same pattern as
test_og_share_endpoint.py). Each test uses a unique slug + cleans up
its own rows so they're idempotent and order-independent.
"""
import uuid

import httpx
import pytest


BASE = "http://localhost:8001"
KIND = "product"


async def _cleanup(slug: str) -> None:
    """Delete any share_events row our test inserted. Imported lazily so
    pytest collection doesn't bind to the global db pool early."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from core import db
    await db.share_events.delete_many({"slug": slug})


@pytest.mark.asyncio
async def test_share_counter_increments_and_caps():
    slug = f"itest-{uuid.uuid4().hex[:10]}"
    try:
        async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
            # Empty listing → 0, never 404.
            r = await client.get(f"/api/share/count/{KIND}/{slug}")
            assert r.status_code == 200
            assert r.json() == {"count": 0}

            # Track 5 clicks — counter should walk 1..5.
            for expected in range(1, 6):
                r = await client.post(
                    "/api/share/track",
                    json={"kind": KIND, "slug": slug},
                )
                assert r.status_code == 200
                assert r.json()["count"] == expected, \
                    f"click {expected}: expected count={expected}, got {r.json()}"

            # Cap is 5/day/IP — 6th click should plateau at 5.
            r = await client.post(
                "/api/share/track",
                json={"kind": KIND, "slug": slug},
            )
            assert r.status_code == 200
            assert r.json()["count"] == 5, \
                f"6th click should be capped at 5, got {r.json()}"

            # Cross-check via GET — same 5.
            r = await client.get(f"/api/share/count/{KIND}/{slug}")
            assert r.json() == {"count": 5}
    finally:
        await _cleanup(slug)


@pytest.mark.asyncio
async def test_share_track_rejects_invalid_kind():
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
        r = await client.post(
            "/api/share/track",
            json={"kind": "bogus", "slug": "x"},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_admin_top_shared_ranks_by_count():
    """Two slugs share-tracked; the one clicked more should rank first."""
    slug_hi = f"itest-hi-{uuid.uuid4().hex[:8]}"
    slug_lo = f"itest-lo-{uuid.uuid4().hex[:8]}"
    try:
        async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
            # 3 clicks for slug_hi, 1 for slug_lo. (1st row inserted before
            # the cap kicks in; cap is 5/day so we're well under.)
            for _ in range(3):
                await client.post("/api/share/track",
                                  json={"kind": KIND, "slug": slug_hi})
            await client.post("/api/share/track",
                              json={"kind": KIND, "slug": slug_lo})

            r = await client.get("/api/admin/share/top?days=1&limit=50")
            assert r.status_code == 200
            rows = r.json()["rows"]
            hi_row = next((x for x in rows if x["slug"] == slug_hi), None)
            lo_row = next((x for x in rows if x["slug"] == slug_lo), None)
            assert hi_row and lo_row, f"missing rows: {rows[:5]}"
            assert hi_row["count"] == 3
            assert lo_row["count"] == 1
            assert rows.index(hi_row) < rows.index(lo_row), \
                "hi_row should rank above lo_row"
    finally:
        await _cleanup(slug_hi)
        await _cleanup(slug_lo)
