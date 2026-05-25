"""
AI-driven generator for fresh community design files.

Triggered from the admin "Generate fresh design file" button. Picks one
of a handful of parametric SVG/DXF templates, has Gemini Flash fill in
the creative variables (theme, text, tags), then composes:
  - real SVG (cut-ready paths + a single text element where applicable)
  - real DXF via ezdxf
  - lifestyle preview JPG via Nano Banana

…and inserts the result into the existing `design_files` collection,
flagged with `is_seed: true` + `ai_generated: true` so the admin can
distinguish them from the hand-curated workshop seeds if they ever want
to purge separately.

Designed to be safe & deterministic at the SVG/DXF layer — the LLM only
picks copy and tags, never raw vector data — so plasma/laser shops can
trust the geometry every time.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import random
import re
import uuid
from pathlib import Path
from typing import Any

import ezdxf
from emergentintegrations.llm.chat import LlmChat, UserMessage

from core import db, now_iso
from seo_tags import build_seo_description, extract_seo_tags

logger = logging.getLogger("crafters.design_seeder")

SEED_DIR = Path("/app/frontend/public/seed-designs")
SEED_DIR.mkdir(parents=True, exist_ok=True)
WORKSHOP_NAME = "Crafters Market Workshop Team"


# ---------------------------------------------------------------------------
# SVG / DXF templates
#
# Each template is a pure function: takes a dict of LLM-picked parameters,
# returns (svg_str, dxf_segments, width_in, height_in). The DXF segments
# are LWPOLYLINE point lists in inches — ezdxf turns them into closed
# polylines. We intentionally don't add text to the DXF (text doesn't
# cut cleanly in DXF anyway — most makers convert it to path in their
# CAM software). SVG keeps the text so it renders in the preview UI.
# ---------------------------------------------------------------------------

def _arch_path(cx: float, cy: float, rx: float, ry: float) -> str:
    """Top half of an ellipse — used as the WELCOME banner backing."""
    return f"M {cx-rx} {cy} A {rx} {ry} 0 0 1 {cx+rx} {cy}"


def template_welcome_arch(p: dict) -> tuple[str, list, float, float]:
    """Top arch with banner text + bottom silhouette (mountains | trees |
    heart). The arch is always a half-ellipse; the silhouette varies by
    parameter so the LLM has interesting choices to make."""
    text = (p.get("banner_text") or "WELCOME").upper()[:14]
    silhouette = (p.get("silhouette") or "mountain").lower()

    # Bottom silhouette path — three options.
    if silhouette == "tree":
        bot = "M 0 600 L 0 480 L 150 200 L 300 480 L 0 480 M 600 480 L 750 200 L 900 480 L 600 480 M 1200 480 L 1350 200 L 1500 480 L 1200 480 L 1800 480 L 1800 600 Z"
    elif silhouette == "heart":
        bot = "M 900 580 C 600 420 540 240 720 220 C 820 210 900 280 900 360 C 900 280 980 210 1080 220 C 1260 240 1200 420 900 580 Z"
        bot = "M 0 600 L 1800 600 L 1800 480 L 0 480 Z " + bot
    else:  # mountain (default)
        bot = "M 0 600 L 0 480 L 280 220 L 460 380 L 620 180 L 860 460 L 1060 280 L 1300 480 L 1460 300 L 1660 440 L 1800 360 L 1800 600 Z"

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 700" width="1800" height="700">
  <path fill="#0a0a0a" stroke="none" d="{bot}"/>
  <path fill="none" stroke="#0a0a0a" stroke-width="10" d="{_arch_path(900, 180, 720, 140)}"/>
  <text x="900" y="170" text-anchor="middle" font-family="Anton, Impact, sans-serif"
        font-size="120" font-weight="900" fill="#0a0a0a" letter-spacing="6">{text}</text>
</svg>'''

    # DXF: arch + ground-line silhouette as closed polyline. Coordinates
    # in inches scale to an 18 × 7 nominal sign.
    arch_pts = [(9 + 7.2 * (i / 60), 6.5 - 1.4 * (1 - ((9 - (9 + 7.2 * (i / 60))) / 7.2) ** 2) ** 0.5) for i in range(0, 61)]
    arch_pts = [(round(x, 3), round(y, 3)) for x, y in arch_pts]
    arch_pts.append((arch_pts[-1][0], 5.5))
    arch_pts.append((arch_pts[0][0], 5.5))
    arch_pts.append(arch_pts[0])
    silhouette_pts = [(0, 0), (0, 4.8), (2.8, 2.2), (4.6, 3.8), (6.2, 1.8), (8.6, 4.6),
                      (10.6, 2.8), (13.0, 4.8), (14.6, 3.0), (16.6, 4.4), (18.0, 3.6),
                      (18.0, 0), (0, 0)]
    return svg, [arch_pts, silhouette_pts], 18.0, 7.0


def template_family_est(p: dict) -> tuple[str, list, float, float]:
    """Bordered rectangle with `THE [LAST_NAME] FAMILY · EST. [YEAR]`."""
    last_name = (p.get("last_name") or "Henderson").strip()[:18].upper()
    year = re.sub(r"\D", "", str(p.get("year") or "1978"))[:4] or "1978"
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 600" width="1800" height="600">
  <rect x="40" y="40" width="1720" height="520" rx="20" fill="none" stroke="#0a0a0a" stroke-width="10"/>
  <rect x="80" y="80" width="1640" height="440" rx="10" fill="none" stroke="#0a0a0a" stroke-width="3"/>
  <text x="900" y="240" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="80" font-weight="900" fill="#0a0a0a" letter-spacing="6">THE {last_name} FAMILY</text>
  <line x1="240" y1="290" x2="1560" y2="290" stroke="#0a0a0a" stroke-width="4"/>
  <text x="900" y="430" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="110" font-weight="700" fill="#0a0a0a" letter-spacing="14">EST. {year}</text>
</svg>'''
    outer = [(0.4, 0.4), (17.6, 0.4), (17.6, 5.6), (0.4, 5.6), (0.4, 0.4)]
    inner = [(0.8, 0.8), (17.2, 0.8), (17.2, 5.2), (0.8, 5.2), (0.8, 0.8)]
    return svg, [outer, inner], 18.0, 6.0


def template_garage_sign(p: dict) -> tuple[str, list, float, float]:
    """`[NAME]'S GARAGE · EST. [YEAR]` with crossed-wrenches silhouette."""
    name = (p.get("name") or "Henderson").strip()[:14].upper()
    year = re.sub(r"\D", "", str(p.get("year") or "1962"))[:4] or "1962"
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 700" width="1800" height="700">
  <g transform="translate(900 360) rotate(45)" fill="#0a0a0a">
    <path d="M -260 -16 L 260 -16 L 260 16 L -260 16 Z M -260 0 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0 M 260 0 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0"/>
  </g>
  <g transform="translate(900 360) rotate(-45)" fill="#0a0a0a">
    <path d="M -260 -16 L 260 -16 L 260 16 L -260 16 Z M -260 0 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0 M 260 0 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0"/>
  </g>
  <text x="900" y="140" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="110" font-weight="900" fill="#0a0a0a" letter-spacing="8">{name}&#39;S GARAGE</text>
  <text x="900" y="640" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="80" font-weight="700" fill="#0a0a0a" letter-spacing="12">EST. {year}</text>
</svg>'''
    plate = [(0, 0), (18.0, 0), (18.0, 7.0), (0, 7.0), (0, 0)]
    return svg, [plate], 18.0, 7.0


def template_heart_quote(p: dict) -> tuple[str, list, float, float]:
    """Heart outline with a short 2-line quote inside."""
    line1 = (p.get("line1") or "Love grows here").upper()[:18]
    line2 = (p.get("line2") or "EST 2024").upper()[:18]
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 920" width="1000" height="920">
  <path fill="none" stroke="#0a0a0a" stroke-width="10" d="M 500 880 C 80 660 80 280 320 200 C 460 140 500 280 500 360 C 500 280 540 140 680 200 C 920 280 920 660 500 880 Z"/>
  <text x="500" y="470" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="70" font-weight="900" fill="#0a0a0a" letter-spacing="4">{line1}</text>
  <text x="500" y="580" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="50" font-weight="700" fill="#0a0a0a" letter-spacing="8">{line2}</text>
</svg>'''
    heart = [(5.0, 8.8), (0.8, 6.6), (0.8, 2.8), (3.2, 2.0), (5.0, 3.6), (6.8, 2.0),
             (9.2, 2.8), (9.2, 6.6), (5.0, 8.8)]
    return svg, [heart], 10.0, 9.2


def template_star_ornament(p: dict) -> tuple[str, list, float, float]:
    """Geometric N-point star ornament with optional center text."""
    points_n = max(5, min(int(p.get("points") or 8), 16))
    center_text = (p.get("center_text") or "").upper()[:6]
    # Build star path: outer/inner radii alternating around N points.
    cx = cy = 500
    outer = 460
    inner = 200
    pts = []
    import math
    for i in range(points_n * 2):
        r = outer if i % 2 == 0 else inner
        a = -math.pi / 2 + i * math.pi / points_n
        pts.append(f"{cx + r * math.cos(a):.1f},{cy + r * math.sin(a):.1f}")
    path_d = "M " + " L ".join(pts) + " Z"
    text_el = ""
    if center_text:
        text_el = f'<text x="500" y="540" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="120" font-weight="900" fill="#0a0a0a">{center_text}</text>'
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
  <path fill="none" stroke="#0a0a0a" stroke-width="6" d="{path_d}"/>
  {text_el}
</svg>'''
    # DXF — feed the same star points scaled to 10 in.
    dxf_pts = []
    for i in range(points_n * 2):
        r = (outer if i % 2 == 0 else inner) / 100.0
        a = -math.pi / 2 + i * math.pi / points_n
        dxf_pts.append((5 + r * math.cos(a), 5 + r * math.sin(a)))
    dxf_pts.append(dxf_pts[0])
    return svg, [dxf_pts], 10.0, 10.0


TEMPLATES: dict[str, dict] = {
    "welcome_arch": {
        "fn": template_welcome_arch,
        "category": "Signs",
        "description_lead": "Arched welcome sign with bold display lettering above a clean silhouette base.",
        "default_tags": ["welcome", "porch", "front-door", "plasma"],
        "params_schema": {
            "banner_text": "WELCOME · 1-14 chars · all caps (default WELCOME)",
            "silhouette": "one of: mountain | tree | heart",
        },
        "image_prompt": "Matte black steel welcome sign mounted on a wood porch wall with potted plants nearby, golden hour lighting, lifestyle photography",
    },
    "family_est": {
        "fn": template_family_est,
        "category": "Wedding & Gifts",
        "description_lead": "Bordered family-name plaque with EST year — wedding-gift staple, scales cleanly to any size.",
        "default_tags": ["family", "est", "wedding", "personalize", "laser"],
        "params_schema": {
            "last_name": "Family surname, 2-18 chars",
            "year": "4-digit year, 1900-2099",
        },
        "image_prompt": "Wooden bordered family-name plaque with EST year, hung above a fireplace mantel beside fresh greenery, warm interior lighting, lifestyle home photography",
    },
    "garage_sign": {
        "fn": template_garage_sign,
        "category": "Garage & Workshop",
        "description_lead": "Garage / workshop sign with EST year and crossed wrenches silhouette — built for the gearhead audience.",
        "default_tags": ["garage", "workshop", "wrench", "mancave", "plasma"],
        "params_schema": {
            "name": "Owner's last name, 2-14 chars",
            "year": "4-digit year, 1900-2099",
        },
        "image_prompt": "Matte black steel garage sign with crossed wrenches mounted above a workshop tool bench with a vintage car in the background, dramatic side lighting, photoreal",
    },
    "heart_quote": {
        "fn": template_heart_quote,
        "category": "Wedding & Gifts",
        "description_lead": "Heart outline framing a 2-line quote — perfect for anniversaries and weddings, ready for laser or plasma.",
        "default_tags": ["heart", "quote", "anniversary", "wedding", "laser"],
        "params_schema": {
            "line1": "Top line, 4-18 chars",
            "line2": "Bottom line, 4-18 chars (often EST year)",
        },
        "image_prompt": "Laser-cut wooden heart with engraved quote, mounted on a barnwood wall beside fresh flowers, soft natural light, romantic styling",
    },
    "star_ornament": {
        "fn": template_star_ornament,
        "category": "Home Decor",
        "description_lead": "Geometric N-point star ornament with optional center letter — modular wall art that batches well for retail.",
        "default_tags": ["star", "geometric", "ornament", "decorative", "laser"],
        "params_schema": {
            "points": "Integer 5-16 (default 8)",
            "center_text": "Optional 1-6 char monogram (leave blank for clean star)",
        },
        "image_prompt": "Geometric metal star wall ornament mounted on a white plaster wall above a wooden console table, soft daylight, magazine quality",
    },
}


# ---------------------------------------------------------------------------
# LLM — pick a template + creative parameters
# ---------------------------------------------------------------------------
async def _pick_template_and_params() -> dict:
    """Round-robin through templates (newest-first to maximize diversity)
    + Gemini Flash fills in the creative parameters. The model gets the
    template's parameter schema so it can't pick anything we can't render.
    """
    # Round-robin: count what's been generated and pick the least-used template.
    counts = {}
    for tid in TEMPLATES:
        counts[tid] = await db.design_files.count_documents({"ai_template_id": tid})
    picked_tid = min(counts.items(), key=lambda kv: (kv[1], random.random()))[0]
    tmpl = TEMPLATES[picked_tid]

    api_key = os.getenv("EMERGENT_LLM_KEY")
    params: dict = {}
    title = ""
    description = ""
    tags: list = []

    if api_key:
        chat = (
            LlmChat(
                api_key=api_key,
                session_id=f"design-gen-{uuid.uuid4().hex[:8]}",
                system_message=(
                    "You generate creative parameters for laser/plasma-cut design files. "
                    "Return ONLY a single valid JSON object — no commentary, no markdown fences. "
                    "Use realistic, varied themes that appeal to homeowners, gearheads, and gift buyers."
                ),
            )
            .with_model("gemini", "gemini-3-flash-preview")
        )
        prompt = (
            f"Template: {picked_tid}\n"
            f"Template description: {tmpl['description_lead']}\n"
            f"Parameter schema (fill these): {json.dumps(tmpl['params_schema'])}\n\n"
            "Return a JSON object with EXACTLY these keys:\n"
            "  params  — object matching the parameter schema above\n"
            "  title   — punchy 3-7 word title for the design listing\n"
            "  description — 1-2 sentence description (max 280 chars) mentioning size and intended use\n"
            "  tags    — array of 4-6 short lowercase tags (single or double word, no '#')\n"
            "\nMake every generation feel fresh — vary the names, years, themes, and silhouettes."
        )
        try:
            raw = await chat.send_message(UserMessage(text=prompt))
            # Strip any accidental markdown fences.
            clean = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
            data = json.loads(clean)
            params = data.get("params") or {}
            title = (data.get("title") or "").strip()
            description = (data.get("description") or "").strip()
            tags = [str(t).strip().lower() for t in (data.get("tags") or []) if t][:8]
        except Exception as e:
            logger.warning("[design_seeder] LLM param gen failed (%s); falling back", e)

    # Fallback values when the LLM is unavailable or returned garbage.
    if not title:
        title = f"{picked_tid.replace('_', ' ').title()} — Variant {counts[picked_tid] + 1}"
    if not description:
        description = tmpl["description_lead"]
    if not tags:
        tags = list(tmpl["default_tags"])

    return {
        "template_id": picked_tid,
        "params": params,
        "title": title[:120],
        "description": description[:600],
        "tags": tags[:8],
        "image_prompt": tmpl["image_prompt"],
    }


# ---------------------------------------------------------------------------
# Nano Banana — lifestyle preview JPG
# ---------------------------------------------------------------------------
async def _generate_preview_jpg(slug: str, prompt: str) -> str | None:
    out = SEED_DIR / slug / "preview.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        return f"/seed-designs/{slug}/preview.jpg"
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        return None
    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"design-preview-{slug}-{uuid.uuid4().hex[:8]}",
            system_message="You generate clean, well-lit photos of laser/plasma-cut design pieces displayed in real interiors. No text overlays, no watermarks.",
        )
        .with_model("gemini", "gemini-3.1-flash-image-preview")
        .with_params(modalities=["image", "text"])
    )
    try:
        _t, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))
        if images:
            out.write_bytes(base64.b64decode(images[0]["data"]))
            return f"/seed-designs/{slug}/preview.jpg"
    except Exception as e:
        logger.warning("[design_seeder] preview gen failed for %s: %s", slug, e)
    return None


# ---------------------------------------------------------------------------
# Slug + file writers
# ---------------------------------------------------------------------------
def _slugify(title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80]
    return base or f"design-{uuid.uuid4().hex[:8]}"


async def _unique_slug(base: str) -> str:
    candidate = base
    n = 1
    while await db.design_files.find_one({"slug": candidate}, {"_id": 0, "slug": 1}):
        n += 1
        candidate = f"{base}-{n}"
    return candidate


def _write_svg(slug: str, svg: str) -> str:
    out = SEED_DIR / slug / "design.svg"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg)
    return f"/seed-designs/{slug}/design.svg"


def _write_dxf(slug: str, segments: list) -> str:
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


# ---------------------------------------------------------------------------
# Main entry — generate one fresh design and insert into design_files
# ---------------------------------------------------------------------------
async def generate_one_design() -> dict[str, Any]:
    """Produce one new design file and write it into MongoDB.

    Returns a structured status dict so the admin UI can render a toast.
    """
    picked = await _pick_template_and_params()
    tmpl = TEMPLATES[picked["template_id"]]

    # Build the SVG + DXF first (cheap, deterministic). If the template
    # raises, we never make the LLM image call.
    svg_str, dxf_segments, w_in, h_in = tmpl["fn"](picked["params"])
    slug = await _unique_slug(_slugify(picked["title"]))
    svg_url = _write_svg(slug, svg_str)
    dxf_url = _write_dxf(slug, dxf_segments)

    # Preview is best-effort — if Nano Banana is down the design still
    # lands in the library (we just don't get a hero shot).
    preview_url = await _generate_preview_jpg(slug, picked["image_prompt"]) or svg_url

    file_type_codes = ["svg", "dxf"]
    seo_tags = extract_seo_tags(picked["title"], picked["description"], file_types=file_type_codes)
    seo_description = build_seo_description(picked["title"], picked["description"])

    doc = {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "maker_slug": None,
        "uploader_role": "workshop",
        "uploader_id": "workshop-team",
        "maker_name": WORKSHOP_NAME,
        "title": picked["title"],
        "description": picked["description"],
        "file_type": "svg",
        "download_url": svg_url,
        "thumbnail_url": preview_url,
        "variants": [{
            "format": "dxf",
            "url": dxf_url,
            "filename": f"{slug}.dxf",
            "size_bytes": (SEED_DIR / slug / "design.dxf").stat().st_size,
            "uploaded_at": now_iso(),
        }],
        "downloads": 0,
        "size_bytes": (SEED_DIR / slug / "design.svg").stat().st_size,
        "created_at": now_iso(),
        "category": tmpl["category"],
        "width_in": w_in,
        "height_in": h_in,
        "license": "CC-BY 4.0",
        "tags": picked["tags"],
        "seo_tags": seo_tags,
        "seo_description": seo_description,
        "is_seed": True,
        "ai_generated": True,
        "ai_template_id": picked["template_id"],
        "quarantined_at": None,
    }
    await db.design_files.insert_one(doc)
    doc.pop("_id", None)
    return {
        "status": "ok",
        "design": {
            "id": doc["id"],
            "slug": slug,
            "title": doc["title"],
            "category": tmpl["category"],
            "template_id": picked["template_id"],
            "preview_url": preview_url,
            "svg_url": svg_url,
            "dxf_url": dxf_url,
        },
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(generate_one_design()), indent=2))
