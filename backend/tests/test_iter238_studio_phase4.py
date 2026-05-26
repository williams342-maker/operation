"""iter238 — Maker Studio Phase 4 (parametric machining helpers + refine).

Verifies:
  1. /studio/materials returns 5 materials with depth presets + units list.
  2. SVG render stamps data-material, data-material-depth, data-units, and
     data-engrave-only attributes on the root element.
  3. DXF $INSUNITS header switches between 1 (inches) and 4 (mm) based on
     the design.units field.
  4. DXF includes a NOTES-layer text entity with the material + depth + mode.
  5. /studio/refine applies a small natural-language tweak and counts as 1
     daily-quota prompt.
"""
import io
import os
import sys
import uuid

import ezdxf
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
async def test_materials_endpoint_public_and_complete():
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{API}/api/studio/materials")
    assert r.status_code == 200
    body = r.json()
    assert "materials" in body and "units" in body
    keys = [m["key"] for m in body["materials"]]
    assert set(keys) >= {"wood", "plywood", "steel", "aluminum", "acrylic"}
    assert "inches" in body["units"]
    assert "mm" in body["units"]
    # Every material must declare at least 2 depth presets
    for m in body["materials"]:
        assert len(m["depths"]) >= 2, f"{m['key']} needs depth presets"
        assert m["border_default"] > 0


def test_svg_stamps_parametric_metadata():
    from studio_geometry import render_svg

    design = {
        "width": 12, "height": 6, "border": "rounded", "border_thickness": 0.2,
        "engrave_only": False,
        "material": "steel",
        "units": "mm",
        "material_depth": 0.125,
        "operations": [
            {"kind": "shape", "primitive": "compass_rose", "x": 0.5, "y": 0.5, "w": 0.6, "h": 0.7},
        ],
        "holes": {"count": 0},
    }
    svg = render_svg(design)
    assert 'data-material="steel"' in svg
    assert 'data-material-depth="0.125"' in svg
    assert 'data-units="mm"' in svg
    assert 'data-engrave-only="false"' in svg


def test_dxf_units_switch_and_notes_layer():
    from studio_dxf import render_dxf

    # inches
    d_in = {
        "width": 10, "height": 5, "border": "rounded", "border_thickness": 0.2,
        "material": "wood", "units": "inches", "material_depth": 0.5,
        "operations": [
            {"kind": "shape", "primitive": "heart", "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.6},
        ],
        "holes": {"count": 0},
    }
    dxf_bytes = render_dxf(d_in)
    doc = ezdxf.read(io.StringIO(dxf_bytes.decode("utf-8")))
    assert doc.header["$INSUNITS"] == 1
    # NOTES layer should exist and have at least one TEXT entity
    layers = {ly.dxf.name for ly in doc.layers}
    assert "NOTES" in layers
    notes_entities = list(doc.modelspace().query('TEXT[layer=="NOTES"]'))
    assert len(notes_entities) >= 1
    body_text = "".join(n.dxf.text for n in notes_entities).upper()
    assert "WOOD" in body_text
    assert "0.500" in body_text or "0.5" in body_text
    assert "IN" in body_text

    # mm
    d_mm = dict(d_in)
    d_mm["units"] = "mm"
    d_mm["material"] = "aluminum"
    d_mm["material_depth"] = 3.0
    dxf_mm = render_dxf(d_mm)
    doc_mm = ezdxf.read(io.StringIO(dxf_mm.decode("utf-8")))
    assert doc_mm.header["$INSUNITS"] == 4
    notes_mm = list(doc_mm.modelspace().query('TEXT[layer=="NOTES"]'))
    body_mm = "".join(n.dxf.text for n in notes_mm).upper()
    assert "ALUMINUM" in body_mm
    assert "MM" in body_mm


@pytest.mark.asyncio
async def test_refine_endpoint_applies_and_charges_quota():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_buyer_magic_token

    async with httpx.AsyncClient(timeout=30) as c:
        email = f"p4-{uuid.uuid4().hex[:6]}@craftersmarket.org"
        magic = issue_buyer_magic_token(email)
        v = await c.post(
            f"{API}/api/community/auth/magic/verify",
            json={"token": magic, "accept_eua": True, "eua_version": "2026-04"},
        )
        assert v.status_code == 200
        jwt = v.json()["token"]
        h = {"Authorization": f"Bearer {jwt}"}

        # Fresh quota
        q1 = await c.get(f"{API}/api/studio/quota", headers=h)
        assert q1.status_code == 200
        assert q1.json()["used"] == 0

        base = {
            "width": 12, "height": 6, "border": "rounded",
            "operations": [
                {"kind": "shape", "primitive": "heart", "x": 0.5, "y": 0.4, "w": 0.4, "h": 0.5},
                {"kind": "text", "content": "A & M", "font": "script", "size": 0.2, "x": 0.5, "y": 0.85},
            ],
            "holes": {"count": 0},
        }
        r = await c.post(
            f"{API}/api/studio/refine",
            json={"design": base, "instruction": "change the text to A & B"},
            headers=h,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Quota decremented
        assert body["quota"]["used"] == 1
        assert body["quota"]["remaining"] == 4
        # Returned design still has 2 ops, text content updated
        ops = body["design"]["operations"]
        texts = [o for o in ops if o["kind"] == "text"]
        assert texts, "expected at least one text op"
        # AI may produce slight variation; assert it differs from base text
        assert texts[0]["content"] != "A & M"
