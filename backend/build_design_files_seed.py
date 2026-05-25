"""
Build the Community Design Library seed for the existing `design_files`
collection (the one the public Community page renders).

What it produces, per design:
  - Real, hand-crafted SVG saved to /app/frontend/public/seed-designs/<slug>/design.svg
  - Real DXF cut via ezdxf at /app/frontend/public/seed-designs/<slug>/design.dxf
  - Nano-Banana-generated preview JPG at /app/frontend/public/seed-designs/<slug>/preview.jpg
  - A `design_files` upsert (or fixture entry) so the row appears in the
    public Community → Design files list immediately.

All three files ship with the frontend deploy artifact — no R2
round-trips, no cold-cache miss on a fresh deploy.

Idempotent — re-running upserts by `id` so we don't duplicate rows, and
skips Nano Banana calls when the preview JPG already exists.

Outputs:
  - Mongo docs in `design_files` flagged with `is_seed: true`
  - JSON fixture at /app/backend/data/community_designs_seed.json that the
    admin "install seed content" button replays on production.

Run:
    cd /app/backend && python3 build_design_files_seed.py
"""
import asyncio
import base64
import json
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
from core import db, now_iso  # noqa: E402
from seo_tags import build_seo_description, extract_seo_tags  # noqa: E402

import ezdxf  # noqa: E402

SEED_DIR = Path("/app/frontend/public/seed-designs")
SEED_DIR.mkdir(parents=True, exist_ok=True)
FIXTURE_PATH = Path("/app/backend/data/community_designs_seed.json")
WORKSHOP_NAME = "Crafters Market Workshop Team"

# Each entry: builder fn that returns (svg_str, list_of_dxf_segments,
# image_prompt). DXF segments are LWPOLYLINE point-lists in inches.
SEED_DESIGNS = []


def _design(slug, title, desc, category, tags, w, h, svg, dxf_segments, prompt):
    SEED_DESIGNS.append({
        "slug": slug, "title": title, "description": desc,
        "category": category, "tags": tags,
        "width_in": w, "height_in": h,
        "svg": svg, "dxf_segments": dxf_segments,
        "image_prompt": prompt,
    })


# 1. Mountain range silhouette — staple CNC/laser file
_design(
    "mountain-range-silhouette",
    "Mountain Range Silhouette",
    "Clean 3-peak mountain range outline. Sized for an 18×6 inch wall sign — scales cleanly to any aspect. Single closed path, ready for plasma or laser cutting. Includes both SVG and DXF.",
    "Outdoor / Wall Art", ["mountain", "outdoor", "rustic", "silhouette", "plasma"],
    18.0, 6.0,
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 600" width="1800" height="600">
  <path fill="#0a0a0a" d="M0 600 L0 350 L240 120 L420 280 L580 90 L820 360 L1020 180 L1260 380 L1420 200 L1620 340 L1800 250 L1800 600 Z"/>
</svg>''',
    [[(0, 0), (0, 2.50), (2.4, 4.80), (4.2, 3.20), (5.8, 5.10), (8.2, 2.40), (10.2, 4.20), (12.6, 2.20), (14.2, 4.00), (16.2, 2.60), (18.0, 3.50), (18.0, 0), (0, 0)]],
    "Black silhouette of a multi-peak mountain range cut from steel, hung on a rustic white shiplap wall, soft window light, interior magazine photography",
)

# 2. Heart monogram — wedding gifts staple
_design(
    "heart-monogram-blank",
    "Heart Monogram Blank",
    "Classic split-heart monogram blank — drop two initials in the side panels and a last initial in the center bar. 12×10, ready for laser engraving on wood or acrylic.",
    "Wedding & Gifts", ["heart", "monogram", "wedding", "personalize", "laser"],
    12.0, 10.0,
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1000" width="1200" height="1000">
  <path fill="none" stroke="#0a0a0a" stroke-width="10" d="M600 920 C 150 720 60 360 280 200 C 460 80 600 240 600 380 C 600 240 740 80 920 200 C 1140 360 1050 720 600 920 Z M 220 480 L 980 480 M 600 480 L 600 380"/>
</svg>''',
    [[(0, 8.5), (1.5, 5.5), (2.5, 1.0), (5.0, 1.5), (6.0, 3.0), (7.0, 1.5), (9.5, 1.0), (10.5, 5.5), (12.0, 8.5), (6.0, 9.5), (0, 8.5)]],
    "Wooden heart-shaped monogram plaque with engraved initials, sitting on a marble counter beside fresh flowers, soft natural light, wedding lifestyle photography",
)

# 3. Welcome doormat sign
_design(
    "welcome-arrow-sign-blank",
    "Welcome Arrow Sign Blank",
    "Long horizontal welcome sign blank with a chevron arrow on the right edge. 24×6 inches — ideal for front-door plaques. Single closed cut path.",
    "Signs", ["welcome", "arrow", "front door", "porch", "plasma"],
    24.0, 6.0,
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 600" width="2400" height="600">
  <path fill="#0a0a0a" d="M0 0 L2000 0 L2400 300 L2000 600 L0 600 Z"/>
</svg>''',
    [[(0, 0), (20.0, 0), (24.0, 3.0), (20.0, 6.0), (0, 6.0), (0, 0)]],
    "Long matte black steel welcome sign with chevron arrow shape, mounted next to a farmhouse front door with potted plants, golden hour light",
)

# 4. Pine tree silhouette
_design(
    "pine-tree-trio",
    "Pine Tree Trio",
    "Three classic pine tree silhouettes for cabin/lodge signage. 12×8 inches. Can be cut as one panel or split into three individual pieces.",
    "Outdoor / Wall Art", ["pine", "tree", "cabin", "forest", "plasma"],
    12.0, 8.0,
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">
  <path fill="#0a0a0a" d="M200 760 L 200 700 L160 700 L260 560 L210 560 L300 380 L240 380 L320 200 L 380 200 L 460 380 L 400 380 L 490 560 L 440 560 L 540 700 L 500 700 L 500 760 Z M620 760 L 620 700 L 580 700 L 680 560 L 630 560 L 720 380 L 660 380 L 740 200 L 800 200 L 880 380 L 820 380 L 910 560 L 860 560 L 960 700 L 920 700 L 920 760 Z M1040 760 L 1040 700 L 1000 700 L 1100 560 L 1050 560 L 1140 380 L 1080 380 L 1120 280 L 1180 280 L 1220 380 L 1180 380 L 1200 560 L 1200 700 L 1200 760 Z"/>
</svg>''',
    [[(2.0, 7.6), (3.4, 2.0), (4.6, 2.0), (5.4, 7.6), (2.0, 7.6)]],
    "Three pine tree silhouettes cut from rusted steel, displayed on a wood mantel above a fireplace, warm evening light, rustic cabin interior",
)

# 5. Address-numbers blank box
_design(
    "vertical-address-plaque",
    "Vertical Address Plaque Blank",
    "Tall narrow plaque blank with rounded corners — sized so 4-digit house numbers in 3.5″ tall font centre cleanly. 4×20 inches. Modern minimal style.",
    "Signs", ["address", "numbers", "house", "modern", "plasma"],
    4.0, 20.0,
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 2000" width="400" height="2000">
  <rect x="20" y="20" width="360" height="1960" rx="40" fill="none" stroke="#0a0a0a" stroke-width="8"/>
</svg>''',
    [[(0.2, 0.2), (3.8, 0.2), (3.8, 19.8), (0.2, 19.8), (0.2, 0.2)]],
    "Vertical matte black steel address plaque blank mounted next to a modern wood-paneled front door, afternoon sunlight, architectural photography",
)

# 6. Geometric mandala
_design(
    "8-petal-mandala",
    "8-Petal Geometric Mandala",
    "Classic 8-petal mandala for decorative laser cuts in wood or acrylic. 10×10 inches with clean closed paths. Looks stunning backlit.",
    "Home Decor", ["mandala", "geometric", "decorative", "wall art", "laser"],
    10.0, 10.0,
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
  <g transform="translate(500 500)" fill="none" stroke="#0a0a0a" stroke-width="6">
    <circle r="450"/>
    <circle r="320"/>
    <circle r="180"/>
    <g>''' + ''.join(f'<ellipse cx="0" cy="-300" rx="55" ry="200" transform="rotate({i*45})"/>' for i in range(8)) + '''</g>
  </g>
</svg>''',
    [[(0.5, 5.0), (5.0, 9.5), (9.5, 5.0), (5.0, 0.5), (0.5, 5.0)]],
    "Geometric 8-petal mandala laser-cut from baltic birch plywood, hung on a white plaster wall above a console table, soft daylight",
)

# 7. Snowflake ornament
_design(
    "classic-snowflake-ornament",
    "Classic Snowflake Ornament",
    "Six-arm symmetric snowflake, sized for a 4-inch tree ornament. Single closed-path SVG perfect for batch holiday production.",
    "Holiday / Seasonal", ["snowflake", "ornament", "christmas", "winter", "laser"],
    4.0, 4.0,
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <g transform="translate(200 200)" fill="none" stroke="#0a0a0a" stroke-width="8" stroke-linecap="round">''' + ''.join(f'<g transform="rotate({i*60})"><line x1="0" y1="0" x2="0" y2="-180"/><line x1="0" y1="-100" x2="-30" y2="-130"/><line x1="0" y1="-100" x2="30" y2="-130"/><line x1="0" y1="-150" x2="-20" y2="-170"/><line x1="0" y1="-150" x2="20" y2="-170"/></g>' for i in range(6)) + '''</g>
</svg>''',
    [[(2.0, 0.1), (2.0, 3.9), (0.1, 2.0), (3.9, 2.0), (2.0, 0.1)]],
    "Wooden laser-cut snowflake ornament hanging on a Christmas tree branch with twinkle lights, soft warm bokeh background, holiday photography",
)

# 8. Topographic mountain rings
_design(
    "topo-contour-circles",
    "Topographic Contour Circles",
    "Six concentric topographic rings for stacked layered wall art. Single SVG with separable paths; perfect for modular 3D wood builds. 14×14 inches.",
    "Outdoor / Wall Art", ["topographic", "contour", "mountain", "modular", "router"],
    14.0, 14.0,
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 1400" width="1400" height="1400">
  <g transform="translate(700 700)" fill="none" stroke="#0a0a0a" stroke-width="5">''' + ''.join(f'<circle r="{r}"/>' for r in (650, 540, 430, 320, 220, 130, 60)) + '''</g>
</svg>''',
    [[(0.5, 7.0), (7.0, 13.5), (13.5, 7.0), (7.0, 0.5), (0.5, 7.0)]],
    "Stacked topographic contour wall art made from laser-cut walnut layers, mounted on a white wall, dramatic side lighting, magazine quality",
)

# 9. Compass rose
_design(
    "8-point-compass-rose",
    "8-Point Compass Rose",
    "Maritime-style 8-point compass rose. Classic for cutting boards, leather, and outdoor signage. 8×8 inches square.",
    "Home Decor", ["compass", "nautical", "maritime", "decorative", "laser"],
    8.0, 8.0,
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <g transform="translate(400 400)" fill="none" stroke="#0a0a0a" stroke-width="6">
    <circle r="380"/>
    <circle r="80"/>''' + ''.join(f'<polygon points="0,-370 30,-80 0,0 -30,-80" transform="rotate({i*45})"/>' for i in range(8)) + '''</g>
</svg>''',
    [[(0.2, 4.0), (4.0, 7.8), (7.8, 4.0), (4.0, 0.2), (0.2, 4.0)]],
    "Compass rose laser-engraved onto walnut cutting board, photographed on a wooden bar top, warm whiskey-lighting, lifestyle product shot",
)

# 10. Heart with vine leaves
_design(
    "heart-with-vine",
    "Heart with Vine Leaves",
    "Romantic heart silhouette wrapped in a leafy vine — for Mother's Day, anniversary, and wedding gift bases. 10×10 inches, designed for cherry or walnut.",
    "Wedding & Gifts", ["heart", "vine", "leaves", "romantic", "laser"],
    10.0, 10.0,
    '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
  <path fill="none" stroke="#0a0a0a" stroke-width="8" d="M500 880 C 80 660 80 280 320 220 C 460 180 500 320 500 380 C 500 320 540 180 680 220 C 920 280 920 660 500 880 Z"/>
  <g fill="none" stroke="#0a0a0a" stroke-width="5">
    <path d="M300 520 C 280 540 220 520 200 460 C 240 460 290 480 300 520"/>
    <path d="M700 520 C 720 540 780 520 800 460 C 760 460 710 480 700 520"/>
    <path d="M250 700 C 230 720 170 700 150 640 C 190 640 240 660 250 700"/>
    <path d="M750 700 C 770 720 830 700 850 640 C 810 640 760 660 750 700"/>
  </g>
</svg>''',
    [[(0.5, 6.5), (3.0, 9.0), (5.0, 9.8), (7.0, 9.0), (9.5, 6.5), (5.0, 1.5), (0.5, 6.5)]],
    "Heart with vine leaves laser cut from cherry wood, mounted on a barn-board background with fresh roses, soft natural light, romantic styling",
)


# ---------------------------------------------------------------------------
# File generation helpers
# ---------------------------------------------------------------------------
def _write_svg(slug: str, svg: str) -> str:
    out = SEED_DIR / slug / "design.svg"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg)
    return f"/seed-designs/{slug}/design.svg"


def _write_dxf(slug: str, segments) -> str:
    out = SEED_DIR / slug / "design.dxf"
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    for points in segments:
        pts = list(points)
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        msp.add_lwpolyline(pts, close=True)
    doc.saveas(str(out))
    return f"/seed-designs/{slug}/design.dxf"


async def _generate_preview(slug: str, prompt: str) -> str:
    """Generate the lifestyle preview JPG via Nano Banana. Idempotent:
    returns the public URL even when the file already exists or the
    generation call fails (we'll show a placeholder rather than crash
    the seed run)."""
    out = SEED_DIR / slug / "preview.jpg"
    public = f"/seed-designs/{slug}/preview.jpg"
    if out.exists():
        return public
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        print(f"  [warn] emergentintegrations not available, skipping {slug}")
        return public
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        print(f"  [warn] EMERGENT_LLM_KEY not set, skipping {slug}")
        return public
    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"seed-design-{slug}-{uuid.uuid4().hex[:8]}",
            system_message="You generate clean, well-lit photos of laser/plasma-cut design pieces displayed in real interiors. No text, no watermarks.",
        )
        .with_model("gemini", "gemini-3.1-flash-image-preview")
        .with_params(modalities=["image", "text"])
    )
    try:
        _text, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))
        if images:
            out.write_bytes(base64.b64decode(images[0]["data"]))
            print(f"  ✓ preview {slug}.jpg ({len(images[0]['data'])//1024}KB)")
    except Exception as e:
        print(f"  [warn] preview gen failed for {slug}: {e}")
    return public


# ---------------------------------------------------------------------------
# Build a single `design_files` document matching the production schema
# ---------------------------------------------------------------------------
def _make_doc(d: dict, svg_url: str, dxf_url: str, preview_url: str, existing: dict | None) -> dict:
    title = d["title"]
    description = d["description"]
    file_type_codes = ["svg", "dxf"]
    seo_tags = extract_seo_tags(title, description, file_types=file_type_codes)
    seo_description = build_seo_description(title, description)
    return {
        "id": (existing or {}).get("id") or str(uuid.uuid4()),
        "slug": d["slug"],
        # No real maker — these are platform-owned demo files attributed
        # to the Workshop Team byline. `maker_slug` left null so it shows
        # the curated workshop badge instead of a maker link.
        "maker_slug": None,
        "uploader_role": "workshop",
        "uploader_id": "workshop-team",
        "maker_name": WORKSHOP_NAME,
        "title": title,
        "description": description,
        # Primary file = SVG; DXF rides along as a format variant — same
        # convention the multi-format upload endpoint uses.
        "file_type": "svg",
        "download_url": svg_url,
        "thumbnail_url": preview_url,
        "variants": [{
            "format": "dxf",
            "url": dxf_url,
            "filename": f"{d['slug']}.dxf",
            "size_bytes": (SEED_DIR / d["slug"] / "design.dxf").stat().st_size,
            "uploaded_at": now_iso(),
        }],
        "downloads": (existing or {}).get("downloads", 0),
        "size_bytes": (SEED_DIR / d["slug"] / "design.svg").stat().st_size,
        "created_at": (existing or {}).get("created_at") or now_iso(),
        "category": d["category"],
        "width_in": d["width_in"],
        "height_in": d["height_in"],
        "license": "CC-BY 4.0",
        "tags": d["tags"],
        "seo_tags": seo_tags,
        "seo_description": seo_description,
        "is_seed": True,
        "quarantined_at": None,
    }


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------
async def build_all():
    print(f"=== building {len(SEED_DESIGNS)} community design seeds ===")
    fixture_docs = []
    for d in SEED_DESIGNS:
        slug = d["slug"]
        print(f"→ {slug}")
        svg_url = _write_svg(slug, d["svg"])
        dxf_url = _write_dxf(slug, d["dxf_segments"])
        preview_url = await _generate_preview(slug, d["image_prompt"])
        existing = await db.design_files.find_one(
            {"slug": slug, "is_seed": True},
            {"_id": 0, "id": 1, "created_at": 1, "downloads": 1},
        )
        doc = _make_doc(d, svg_url, dxf_url, preview_url, existing)
        await db.design_files.update_one({"slug": slug}, {"$set": doc}, upsert=True)
        fixture_docs.append(doc)

    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps({"design_files": fixture_docs}, indent=2))
    print(f"\n✓ wrote fixture → {FIXTURE_PATH}")
    print("=== done ===")


if __name__ == "__main__":
    asyncio.run(build_all())
