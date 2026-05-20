"""Regression for the Founder Marketing Kit (iter — Feb 2026).

Verifies:
  • GET /api/founders/slots         → public counter shape + slot math
  • GET /api/founders/list          → public Founders Wall payload (no _id leak)
  • GET /api/founders/card/{slug}   → mime detection + cache hit reuse

Founder card test is conditional — skipped when EMERGENT_LLM_KEY is unset
so CI on a key-less environment doesn't burn LLM credits.
"""
from __future__ import annotations

import os
import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

API = os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001"
if not API.startswith("http"):
    # frontend/.env style — re-read it
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                API = line.split("=", 1)[1].strip()
                break


@pytest.mark.asyncio
async def test_slots_shape():
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{API}/api/founders/slots")
    assert r.status_code == 200
    body = r.json()
    for key in ("inaugural_total", "inaugural_taken", "inaugural_remaining",
                "founders_total", "enabled"):
        assert key in body, f"missing {key}"
    assert body["inaugural_total"] == 100
    assert body["inaugural_taken"] + body["inaugural_remaining"] == body["inaugural_total"]


@pytest.mark.asyncio
async def test_list_wall_payload():
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{API}/api/founders/list?limit=5")
    assert r.status_code == 200
    body = r.json()
    assert "founders" in body
    founders = body["founders"]
    assert len(founders) > 0, "no founders seeded — wall would be empty"
    for f in founders:
        assert "_id" not in f, "ObjectId leak"
        assert "slug" in f
        assert "founder_number" in f
        assert f.get("founder_status") in ("inaugural", "regular", None)


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.environ.get("EMERGENT_LLM_KEY"),
    reason="EMERGENT_LLM_KEY missing — skip Gemini card generation",
)
async def test_card_endpoint_returns_image():
    # Pick the first Founder slug
    async with httpx.AsyncClient(timeout=60) as c:
        listing = (await c.get(f"{API}/api/founders/list?limit=1")).json()
        if not listing.get("founders"):
            pytest.skip("no founders to test against")
        slug = listing["founders"][0]["slug"]

        r1 = await c.get(f"{API}/api/founders/card/{slug}")
        assert r1.status_code == 200
        assert r1.headers["content-type"] in ("image/png", "image/jpeg", "image/webp")
        body = r1.content
        assert len(body) > 1000, "image suspiciously small"
        # Validate magic bytes match declared mime
        if r1.headers["content-type"] == "image/png":
            assert body[:8] == b"\x89PNG\r\n\x1a\n"
        elif r1.headers["content-type"] == "image/jpeg":
            assert body[:3] == b"\xff\xd8\xff"

        # Second call should be cache-hit — same size, same mime.
        r2 = await c.get(f"{API}/api/founders/card/{slug}")
        assert r2.status_code == 200
        assert len(r2.content) == len(body)
        assert r2.headers["content-type"] == r1.headers["content-type"]
