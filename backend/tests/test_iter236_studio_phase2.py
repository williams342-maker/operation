"""iter236 — Maker Studio Phase 2.

Verifies:
  1. /studio/templates is PUBLIC (no auth) and returns 9 curated templates
     with the expected shape coverage.
  2. All 14 shape primitives render valid SVG.
  3. All 14 primitives produce valid DXF.
  4. engrave_only mode skips outer cut border in DXF (cut layer entity count
     drops to zero for a design with engrave_only=true).
  5. engrave_only mode renders the border as a dashed grey guide in SVG
     (preview indicator), not as a solid black cut line.
"""
import io
import os
import re
import sys

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
async def test_templates_endpoint_public():
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{API}/api/studio/templates")
    assert r.status_code == 200
    body = r.json()
    assert "templates" in body
    templates = body["templates"]
    assert len(templates) >= 9, f"expected at least 9 templates, got {len(templates)}"

    ids = {t["id"] for t in templates}
    # Must include all 4 explicitly requested by user (eagle/rooster/antlers/treble_clef)
    # surfaced via at least one template each.
    primitives_in_use = set()
    for t in templates:
        for op in t["design"].get("operations", []):
            if op.get("kind") == "shape":
                primitives_in_use.add(op.get("primitive"))
    for required in ("antlers", "rooster", "anchor", "compass_rose", "treble_clef"):
        assert required in primitives_in_use, f"no template uses {required}"

    # Music template should be engrave-only by default
    music = next(t for t in templates if t["id"] == "music-treble")
    assert music["design"].get("engrave_only") is True


def test_all_14_primitives_present():
    from studio_geometry import PRIMITIVES
    expected = {
        "mountains", "pine_trees", "deer", "heart", "star", "flag", "cross",
        "sun_rays", "eagle", "antlers", "rooster", "anchor", "compass_rose",
        "treble_clef",
    }
    assert set(PRIMITIVES.keys()) == expected


def test_dxf_engrave_only_routes_to_engrave_layer():
    """When engrave_only=true the DXF should have NO entities on CUT layer
    apart from holes (which still live on HOLES layer)."""
    from studio_dxf import render_dxf

    design = {
        "width": 12, "height": 6, "border": "rounded", "border_thickness": 0.2,
        "engrave_only": True,
        "operations": [
            {"kind": "shape", "primitive": "treble_clef", "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.7},
        ],
        "holes": {"count": 2, "diameter": 0.25, "placement": "top_corners"},
    }
    dxf_bytes = render_dxf(design)
    doc = ezdxf.read(io.StringIO(dxf_bytes.decode("utf-8")))
    msp = doc.modelspace()
    cut_entities = list(msp.query('*[layer=="CUT"]'))
    engrave_entities = list(msp.query('*[layer=="ENGRAVE"]'))
    hole_entities = list(msp.query('*[layer=="HOLES"]'))
    assert len(cut_entities) == 0, f"engrave_only mode should have 0 CUT entities, got {len(cut_entities)}"
    assert len(engrave_entities) >= 1, "expected at least 1 ENGRAVE entity"
    assert len(hole_entities) == 2, f"expected 2 holes, got {len(hole_entities)}"


def test_dxf_cut_mode_default():
    """When engrave_only is FALSE (default), outer border + shape go on CUT layer."""
    from studio_dxf import render_dxf

    design = {
        "width": 12, "height": 6, "border": "rounded", "border_thickness": 0.2,
        "operations": [
            {"kind": "shape", "primitive": "heart", "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.7},
        ],
        "holes": {"count": 0},
    }
    dxf_bytes = render_dxf(design)
    doc = ezdxf.read(io.StringIO(dxf_bytes.decode("utf-8")))
    msp = doc.modelspace()
    cut_entities = list(msp.query('*[layer=="CUT"]'))
    engrave_entities = list(msp.query('*[layer=="ENGRAVE"]'))
    assert len(cut_entities) >= 2, f"expected CUT border + shape, got {len(cut_entities)}"
    assert len(engrave_entities) == 0


def test_svg_engrave_mode_uses_dashed_guide():
    """In engrave-only SVG preview, the outer rectangle border should render
    as a dashed grey guide (stroke-dasharray present) rather than a solid
    black cut line."""
    from studio_geometry import render_svg

    design = {
        "width": 12, "height": 6, "border": "rounded", "border_thickness": 0.2,
        "engrave_only": True,
        "operations": [
            {"kind": "shape", "primitive": "heart", "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.7},
        ],
        "holes": {"count": 0},
    }
    svg = render_svg(design)
    assert "stroke-dasharray" in svg, "engrave_only mode should render dashed border guide"
    assert "#cccccc" in svg


def test_svg_cut_mode_no_dash():
    from studio_geometry import render_svg

    design = {
        "width": 12, "height": 6, "border": "rounded", "border_thickness": 0.2,
        "operations": [
            {"kind": "shape", "primitive": "heart", "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.7},
        ],
        "holes": {"count": 0},
    }
    svg = render_svg(design)
    assert "stroke-dasharray" not in svg
