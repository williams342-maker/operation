"""iter235 — Maker Studio AI design tool.

Verifies the full pipeline:
  1. /studio/quota requires auth
  2. /studio/render produces valid SVG for a known design
  3. /studio/export-dxf produces a non-empty DXF binary
  4. /studio/generate (live AI call) returns a sanitized design and decrements quota
  5. Geometry engine emits SVG with all 8 primitives
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


KNOWN_DESIGN = {
    "width": 12,
    "height": 6,
    "border": "rounded",
    "border_thickness": 0.25,
    "operations": [
        {"kind": "shape", "primitive": "mountains", "x": 0.5, "y": 0.4, "w": 0.85, "h": 0.55},
        {"kind": "shape", "primitive": "pine_trees", "x": 0.2, "y": 0.55, "w": 0.3, "h": 0.4},
        {"kind": "text", "content": "Lake House", "font": "bold_serif", "size": 0.3, "x": 0.5, "y": 0.8},
    ],
    "holes": {"count": 2, "diameter": 0.25, "placement": "top_corners"},
}


@pytest.mark.asyncio
async def test_studio_full_pipeline():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_buyer_magic_token

    async with httpx.AsyncClient(timeout=30) as c:
        # 1. Anonymous calls are blocked
        r = await c.get(f"{API}/api/studio/quota")
        assert r.status_code == 401

        # 2. Sign in a fresh buyer (accept EUA on first verify)
        email = f"studio-pytest-{uuid.uuid4().hex[:8]}@craftersmarket.org"
        magic = issue_buyer_magic_token(email)
        v = await c.post(
            f"{API}/api/community/auth/magic/verify",
            json={"token": magic, "accept_eua": True, "eua_version": "2026-04"},
        )
        assert v.status_code == 200, v.text
        jwt = v.json()["token"]
        h = {"Authorization": f"Bearer {jwt}"}

        # 3. Quota is fresh
        q = await c.get(f"{API}/api/studio/quota", headers=h)
        assert q.status_code == 200
        quota = q.json()
        assert quota["used"] == 0
        assert quota["cap"] == 5

        # 4. Render endpoint emits SVG
        r = await c.post(f"{API}/api/studio/render", json={"design": KNOWN_DESIGN}, headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["svg"].startswith("<svg")
        assert "Lake House" in body["svg"]
        assert body["summary"]["title"] == "Lake House"
        assert "mountains" in body["summary"]["shapes"]

        # 5. DXF export returns binary
        r = await c.post(
            f"{API}/api/studio/export-dxf",
            json={"design": KNOWN_DESIGN},
            headers=h,
        )
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/dxf"
        assert len(r.content) > 1000
        assert r.content.startswith(b"  0\nSECTION")

        # 6. SVG export
        r = await c.post(
            f"{API}/api/studio/export-svg",
            json={"design": KNOWN_DESIGN},
            headers=h,
        )
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("image/svg")

        # 7. Live AI generate call. Costs ~1 prompt; verified against
        # quota decrement so we know the AI call landed.
        r = await c.post(
            f"{API}/api/studio/generate",
            json={"prompt": "Wedding heart sign with names A & M in script font", "width": 14, "height": 6},
            headers=h,
        )
        assert r.status_code == 200, r.text
        gen = r.json()
        assert isinstance(gen["design"], dict)
        assert isinstance(gen["design"]["operations"], list)
        assert gen["quota"]["used"] == 1
        assert gen["quota"]["remaining"] == 4


def test_geometry_emits_all_primitives():
    """Direct unit test on the geometry engine — no auth, no DB.
    Checks that the 8 Phase-1 primitives are still present; full inventory
    test (14 primitives after Phase 2) lives in test_iter236."""
    from studio_geometry import PRIMITIVES, render_svg

    phase1 = {"mountains", "pine_trees", "deer", "heart",
              "star", "flag", "cross", "sun_rays"}
    assert phase1.issubset(set(PRIMITIVES.keys()))
    # Render a 12x6 canvas with each primitive in turn
    for slug in PRIMITIVES.keys():
        design = {
            "width": 12, "height": 6, "border": "none", "border_thickness": 0.1,
            "operations": [
                {"kind": "shape", "primitive": slug, "x": 0.5, "y": 0.5, "w": 0.5, "h": 0.5},
            ],
            "holes": {"count": 0},
        }
        svg = render_svg(design)
        assert svg.startswith("<svg")
        assert "</svg>" in svg
        assert "viewBox" in svg


def test_dxf_generation_for_all_primitives():
    """DXF round-trip must succeed for every primitive."""
    from studio_dxf import render_dxf
    from studio_geometry import PRIMITIVES

    for slug in PRIMITIVES.keys():
        design = {
            "width": 10, "height": 5, "border": "rectangle", "border_thickness": 0.2,
            "operations": [
                {"kind": "shape", "primitive": slug, "x": 0.5, "y": 0.5, "w": 0.5, "h": 0.5},
                {"kind": "text", "content": "TEST", "font": "bold_serif", "size": 0.2, "x": 0.5, "y": 0.85},
            ],
            "holes": {"count": 2, "diameter": 0.25, "placement": "top_corners"},
        }
        b = render_dxf(design)
        assert b.startswith(b"  0\nSECTION"), f"DXF bad header for {slug}"
        assert len(b) > 1000, f"DXF too small for {slug}"
