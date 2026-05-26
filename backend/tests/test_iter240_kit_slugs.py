"""iter240 — Maker Studio Phase 6: shareable kit URLs.

Verifies:
  1. Kit creation now stamps a unique slug derived from the title.
  2. GET /studio/kits/by-slug/{slug} is PUBLIC (no auth) and resolves
     public kits with files inflated.
  3. Unlisted kits 404 on the public slug endpoint.
  4. Slug is unique across kits with the same title.
"""
import os
import sys
import uuid

import httpx
import pytest

sys.path.insert(0, "/app/backend")

API = os.environ.get("REACT_APP_BACKEND_URL")
if not API:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                API = line.split("=", 1)[1].strip()
                break


@pytest.mark.asyncio
async def test_kit_slug_lifecycle():
    """Single combined test to dodge cross-test Motor event-loop issue."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from core import db
    from maker_auth import issue_buyer_magic_token

    async with httpx.AsyncClient(timeout=30) as c:
        email = f"p6-{uuid.uuid4().hex[:8]}@craftersmarket.org"
        magic = issue_buyer_magic_token(email)
        v = await c.post(
            f"{API}/api/community/auth/magic/verify",
            json={"token": magic, "accept_eua": True, "eua_version": "2026-04"},
        )
        assert v.status_code == 200, v.text
        jwt = v.json()["token"]
        h = {"Authorization": f"Bearer {jwt}"}

        # 1. Create two public kits with identical titles — slugs must differ
        a = await c.post(f"{API}/api/studio/kits",
                         json={"title": "Lake House Pack", "visibility": "public"},
                         headers=h)
        b = await c.post(f"{API}/api/studio/kits",
                         json={"title": "Lake House Pack", "visibility": "public"},
                         headers=h)
        assert a.status_code == 200 and b.status_code == 200
        slug_a, slug_b = a.json()["slug"], b.json()["slug"]
        assert slug_a.startswith("lake-house-pack-")
        assert slug_b.startswith("lake-house-pack-")
        assert slug_a != slug_b

        # 2. Unlisted kit
        u = await c.post(f"{API}/api/studio/kits",
                         json={"title": "Secret Pack", "visibility": "unlisted"},
                         headers=h)
        assert u.status_code == 200
        slug_u = u.json()["slug"]

        try:
            # 3. Public lookup by slug works for anonymous viewer
            pub = await c.get(f"{API}/api/studio/kits/by-slug/{slug_a}")
            assert pub.status_code == 200
            body = pub.json()
            assert body["title"] == "Lake House Pack"
            assert body["slug"] == slug_a
            assert body["files"] == []
            assert "owner_name" in body

            # 4. Unlisted kit is NOT publicly resolvable
            denied = await c.get(f"{API}/api/studio/kits/by-slug/{slug_u}")
            assert denied.status_code == 404

            # 5. Missing slug returns 404 too
            miss = await c.get(f"{API}/api/studio/kits/by-slug/never-exists-zzz")
            assert miss.status_code == 404
        finally:
            await db.studio_kits.delete_many({"slug": {"$in": [slug_a, slug_b, slug_u]}})
