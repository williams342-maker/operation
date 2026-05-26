"""iter237 — Maker Studio Phase 3 (community sharing).

Verifies:
  1. Publish writes to the CORRECT `design_files` collection so the
     community files feed surfaces the design.
  2. Publish saves the original AI prompt + design_intent for remixing.
  3. Publish auto-creates a showcase_posts entry with source=maker_studio_ai
     for the public showcase carousel (P2 surface).
  4. /studio/remix/{id} returns the prompt + sanitized design.
  5. Unlisted designs are gated to the owner only.
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


_DESIGN = {
    "width": 12, "height": 6, "border": "rounded", "border_thickness": 0.2,
    "operations": [
        {"kind": "shape", "primitive": "heart", "x": 0.5, "y": 0.45, "w": 0.5, "h": 0.6},
        {"kind": "text", "content": "Phase 3 Test", "font": "bold_serif", "size": 0.22, "x": 0.5, "y": 0.85},
    ],
    "holes": {"count": 0, "diameter": 0.25, "placement": "top_corners"},
}


async def _mint_buyer_jwt(c, email_suffix):
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_buyer_magic_token
    email = f"p3-{email_suffix}-{uuid.uuid4().hex[:6]}@craftersmarket.org"
    magic = issue_buyer_magic_token(email)
    v = await c.post(
        f"{API}/api/community/auth/magic/verify",
        json={"token": magic, "accept_eua": True, "eua_version": "2026-04"},
    )
    assert v.status_code == 200, v.text
    return v.json()["token"]


@pytest.mark.asyncio
async def test_studio_phase3_publish_remix_and_unlisted_gate():
    """Combined test: avoids Motor's "Event loop is closed" recurrence
    that happens when multiple pytest-asyncio tests share DB fixtures."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from core import db

    async with httpx.AsyncClient(timeout=30) as c:
        jwt_a = await _mint_buyer_jwt(c, "owner")
        jwt_b = await _mint_buyer_jwt(c, "remixer")
        h_a = {"Authorization": f"Bearer {jwt_a}"}
        h_b = {"Authorization": f"Bearer {jwt_b}"}
        prompt_text = "Wedding heart sign — Phase 3 Test"

        # ── PART A — PUBLIC publish + design_files + showcase mirror + remix
        r = await c.post(
            f"{API}/api/studio/publish",
            json={"design": _DESIGN, "prompt": prompt_text, "visibility": "public"},
            headers=h_a,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        file_id = body["file"]["id"]
        showcase_id = body.get("showcase_post_id")

        # ── PART B — UNLISTED publish (separate file)
        r2 = await c.post(
            f"{API}/api/studio/publish",
            json={
                "design": _DESIGN,
                "prompt": "secret prompt",
                "visibility": "unlisted",
            },
            headers=h_a,
        )
        assert r2.status_code == 200
        unlisted_id = r2.json()["file"]["id"]
        assert r2.json().get("showcase_post_id") is None, "unlisted should not mirror to showcase"

        try:
            # ── Assertions on PART A
            doc = await db.design_files.find_one({"id": file_id}, {"_id": 0})
            assert doc is not None
            assert doc["source"] == "maker_studio_ai"
            assert doc["ai_prompt"] == prompt_text
            assert doc["design_intent"]["operations"]
            assert doc["maker_slug"] == "community-studio"

            files = await c.get(f"{API}/api/community/files")
            assert files.status_code == 200
            assert any(f["id"] == file_id for f in files.json())

            assert showcase_id, "expected showcase mirror id"
            sc = await db.showcase_posts.find_one({"id": showcase_id}, {"_id": 0})
            assert sc is not None
            assert sc["source"] == "maker_studio_ai"
            assert sc["design_file_id"] == file_id

            rx = await c.get(f"{API}/api/studio/remix/{file_id}", headers=h_b)
            assert rx.status_code == 200, rx.text
            assert rx.json()["prompt"] == prompt_text
            assert len(rx.json()["design"]["operations"]) == 2

            r404 = await c.get(f"{API}/api/studio/remix/does-not-exist", headers=h_b)
            assert r404.status_code == 404

            # ── Assertions on PART B
            ok = await c.get(f"{API}/api/studio/remix/{unlisted_id}", headers=h_a)
            assert ok.status_code == 200, ok.text

            denied = await c.get(f"{API}/api/studio/remix/{unlisted_id}", headers=h_b)
            assert denied.status_code == 403
        finally:
            await db.design_files.delete_one({"id": file_id})
            await db.design_files.delete_one({"id": unlisted_id})
            if showcase_id:
                await db.showcase_posts.delete_one({"id": showcase_id})
