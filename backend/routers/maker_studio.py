"""Maker Studio — AI-powered SVG/DXF design tool.

Endpoints:
  POST /api/studio/generate     — prompt → design-intent JSON (Gemini Flash)
  POST /api/studio/render       — design JSON → SVG string
  POST /api/studio/export-svg   — design JSON → SVG file download
  POST /api/studio/export-dxf   — design JSON → DXF file download
  POST /api/studio/publish      — save SVG+DXF to R2 + community_files
  GET  /api/studio/quota        — daily AI-generate quota for the caller

Rate limit policy (iter235):
  • Anonymous: NOT allowed to generate (must sign in)
  • Buyer / free maker: 5 prompts/day
  • Founder / Plus maker: 50 prompts/day
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import io

from core import db, logger, now_iso
from maker_auth import optional_buyer, decode_session_jwt
from fastapi import Header

from studio_geometry import PRIMITIVES, FONTS, BORDER_STYLES, MATERIALS, UNITS, render_svg, design_summary
from studio_dxf import render_dxf

router = APIRouter(tags=["studio"])

FREE_DAILY_QUOTA = 5
PAID_DAILY_QUOTA = 50

# ── Auth helper — accept buyer OR maker JWT, return claims + role ──────────
async def _current_studio_user(authorization: str | None = Header(default=None)) -> dict:
    """Studio is gated to signed-in users (any role). Anonymous → 401.
    Accepts buyer OR maker JWT in the Authorization header."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in to use Maker Studio")
    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = decode_session_jwt(token)
    except Exception:
        raise HTTPException(401, "Invalid session")
    role = claims.get("role") or "buyer"
    sub = claims.get("sub") or claims.get("slug") or claims.get("email")
    if not sub:
        raise HTTPException(401, "Session missing subject")
    return {"sub": sub, "role": role, "claims": claims}


async def _user_daily_quota(user: dict) -> dict:
    """Returns {used, cap, remaining, role, tier}."""
    today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    used = await db.studio_prompts.count_documents({
        "user_id": user["sub"],
        "day": today_utc,
    })
    tier = "free"
    cap = FREE_DAILY_QUOTA
    if user["role"] == "maker":
        maker = await db.makers.find_one(
            {"slug": user["claims"].get("slug") or user["sub"]},
            {"_id": 0, "tier": 1, "plan": 1},
        )
        if maker:
            mt = maker.get("tier") or ""
            mp = (maker.get("plan") or "").lower()
            if mt == "founder" or "plus" in mp or mt == "plus":
                tier = "founder" if mt == "founder" else "plus"
                cap = PAID_DAILY_QUOTA
    return {
        "used": used,
        "cap": cap,
        "remaining": max(0, cap - used),
        "role": user["role"],
        "tier": tier,
        "day": today_utc,
    }


@router.get("/studio/quota")
async def studio_quota(user: dict = Depends(_current_studio_user)):
    return await _user_daily_quota(user)


# ── AI generation ──────────────────────────────────────────────────────────
class GenerateBody(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=400)
    width: Optional[float] = Field(default=12.0, ge=1, le=48)
    height: Optional[float] = Field(default=6.0, ge=1, le=48)


_AI_SYSTEM = """You are the Maker Studio AI for an artisan CNC marketplace. Convert a user prompt into ONE strict JSON object describing a clean black-on-white silhouette design ready for plasma/laser cutting. Output ONLY the JSON object — no prose, no markdown, no code fences.

ALLOWED VALUES:
- primitive (shapes): mountains | pine_trees | deer | heart | star | flag | cross | sun_rays | eagle | antlers | rooster | anchor | compass_rose | treble_clef
- font: bold_serif | script | western | sans
- border: none | rectangle | rounded | circle | oval
- holes.placement: top_corners | bottom_corners | four_corners | top_center

SCHEMA (return EXACTLY this shape):
{
  "width": <number, inches, copy from input>,
  "height": <number, inches, copy from input>,
  "border": "rounded",
  "border_thickness": 0.2,
  "engrave_only": false,
  "operations": [
    { "kind": "shape", "primitive": "mountains", "x": 0.5, "y": 0.40, "w": 0.85, "h": 0.55 },
    { "kind": "text",  "content": "Lake House", "font": "bold_serif", "size": 0.30, "x": 0.5, "y": 0.78 }
  ],
  "holes": { "count": 2, "diameter": 0.25, "placement": "top_corners" }
}

CONSTRAINTS:
- Position fields x, y, w, h are FRACTIONS of canvas (0.0 to 1.0).
- text size is a fraction of canvas HEIGHT (0.05 to 0.5).
- Aim for 1-2 shapes and 1-2 text lines. Never more than 4 total operations.
- If the user says "cabin / mountains / lake" → mountains + pine_trees.
- If "patriotic / vet / military" → flag + bold_serif text, or eagle for military.
- If "religious / faith / memorial" → cross.
- If "ranch / hunting / wildlife" → deer or antlers + pine_trees.
- If "love / wedding / family" → heart + script font.
- If "sunshine / kids" → sun_rays.
- If "nautical / boat / sea" → anchor or compass_rose.
- If "rooster / farm / country" → rooster.
- If "music / band / song" → treble_clef.
- If user mentions "engrave only / surface burn / no cut" → set engrave_only: true.
- Default to 2 top-corner mounting holes for hanging signs.
- Text should be the literal phrase the user requested. If user gave no text, use ONE plain noun.

OUTPUT ONLY THE JSON. Nothing else."""


def _extract_json(text: str) -> Optional[dict]:
    """Best-effort JSON extraction from LLM output."""
    text = text.strip()
    # Strip code fences if any
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE)
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def _sanitize_design(d: Any, fallback_w: float, fallback_h: float) -> dict:
    """Hard-guard the AI output: drop unknown primitives, clamp values,
    cap operation count. Never trust the model with raw output."""
    if not isinstance(d, dict):
        d = {}
    out: dict[str, Any] = {
        "width":  float(d.get("width",  fallback_w)) if isinstance(d.get("width", fallback_w), (int, float)) else fallback_w,
        "height": float(d.get("height", fallback_h)) if isinstance(d.get("height", fallback_h), (int, float)) else fallback_h,
        "border": d.get("border") if d.get("border") in BORDER_STYLES else "rounded",
        "border_thickness": float(d.get("border_thickness", 0.2)),
        "engrave_only": bool(d.get("engrave_only", False)),
        # iter238 — parametric machining metadata
        "material": d.get("material") if d.get("material") in MATERIALS else "wood",
        "units": d.get("units") if d.get("units") in UNITS else "inches",
        "material_depth": float(d.get("material_depth", 0.25)) if isinstance(d.get("material_depth", 0.25), (int, float)) else 0.25,
    }
    ops_in = d.get("operations") or []
    ops_out: list[dict] = []
    for op in ops_in[:4]:  # cap at 4 ops
        if not isinstance(op, dict):
            continue
        kind = op.get("kind")
        if kind == "shape" and op.get("primitive") in PRIMITIVES:
            ops_out.append({
                "kind": "shape",
                "primitive": op["primitive"],
                "x": float(op.get("x", 0.5)),
                "y": float(op.get("y", 0.5)),
                "w": float(op.get("w", 0.6)),
                "h": float(op.get("h", 0.4)),
            })
        elif kind == "text":
            content = str(op.get("content", "")).strip()[:80]
            if not content:
                continue
            ops_out.append({
                "kind": "text",
                "content": content,
                "font": op.get("font") if op.get("font") in FONTS else "bold_serif",
                "size": float(op.get("size", 0.20)),
                "x": float(op.get("x", 0.5)),
                "y": float(op.get("y", 0.5)),
            })
    out["operations"] = ops_out
    holes_in = d.get("holes") or {}
    out["holes"] = {
        "count": int(holes_in.get("count", 2)),
        "diameter": float(holes_in.get("diameter", 0.25)),
        "placement": holes_in.get("placement", "top_corners"),
    }
    return out


@router.post("/studio/generate")
async def studio_generate(body: GenerateBody, user: dict = Depends(_current_studio_user)):
    # Quota check
    q = await _user_daily_quota(user)
    if q["remaining"] <= 0:
        raise HTTPException(429, f"Daily quota of {q['cap']} reached. Comes back tomorrow or upgrade to Founder for {PAID_DAILY_QUOTA}/day.")

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(503, "AI temporarily unavailable")

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key,
            session_id=f"studio-{user['sub'][:8]}-{uuid.uuid4().hex[:6]}",
            system_message=_AI_SYSTEM,
        ).with_model("gemini", "gemini-3-flash-preview")
        user_text = (
            f"Canvas: {body.width} x {body.height} inches.\n"
            f"User prompt: {body.prompt}\n\n"
            f"Return strict JSON ONLY."
        )
        raw = await chat.send_message(UserMessage(text=user_text))
    except Exception as e:
        logger.exception("[studio] AI call failed: %s", e)
        raise HTTPException(503, "AI design generation failed")

    parsed = _extract_json(raw or "")
    design = _sanitize_design(parsed, body.width, body.height)

    # Log the prompt for quota accounting
    today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.studio_prompts.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["sub"],
        "role": user["role"],
        "prompt": body.prompt[:400],
        "design": design,
        "day": today_utc,
        "created_at": now_iso(),
    })

    new_q = await _user_daily_quota(user)
    return {"design": design, "quota": new_q}


# ── Render-only endpoints ──────────────────────────────────────────────────
class DesignBody(BaseModel):
    design: dict


@router.post("/studio/render")
async def studio_render(body: DesignBody, user: dict = Depends(_current_studio_user)):
    """Return SVG string for instant preview (no DB write)."""
    design = _sanitize_design(body.design, body.design.get("width", 12), body.design.get("height", 6))
    svg = render_svg(design)
    return {"svg": svg, "summary": design_summary(design)}


# ── Template library — curated quick-start designs ─────────────────────────
# Public (no auth) so guests can browse and get nudged to sign in. The actual
# design generation/render still requires a JWT.
STUDIO_TEMPLATES: list[dict] = [
    {
        "id": "lake-house",
        "name": "Lake House Cabin Sign",
        "category": "Cabin & Outdoor",
        "tag": "mountains",
        "prompt": "Rustic cabin sign with mountains and pine trees that says Lake House",
        "design": {
            "width": 14, "height": 6, "border": "rounded", "border_thickness": 0.2,
            "operations": [
                {"kind": "shape", "primitive": "mountains", "x": 0.5, "y": 0.40, "w": 0.85, "h": 0.55},
                {"kind": "shape", "primitive": "pine_trees", "x": 0.20, "y": 0.55, "w": 0.30, "h": 0.40},
                {"kind": "text", "content": "Lake House", "font": "bold_serif", "size": 0.30, "x": 0.5, "y": 0.80},
            ],
            "holes": {"count": 2, "diameter": 0.25, "placement": "top_corners"},
        },
    },
    {
        "id": "patriotic-veteran",
        "name": "Veteran Flag Plaque",
        "category": "Patriotic",
        "tag": "flag",
        "prompt": "American flag with bold text Land Of The Free for a veteran's home",
        "design": {
            "width": 16, "height": 8, "border": "rectangle", "border_thickness": 0.18,
            "operations": [
                {"kind": "shape", "primitive": "flag", "x": 0.5, "y": 0.35, "w": 0.7, "h": 0.50},
                {"kind": "text", "content": "Land Of The Free", "font": "bold_serif", "size": 0.18, "x": 0.5, "y": 0.85},
            ],
            "holes": {"count": 2, "diameter": 0.30, "placement": "top_corners"},
        },
    },
    {
        "id": "wedding-heart",
        "name": "Wedding Heart Sign",
        "category": "Wedding & Family",
        "tag": "heart",
        "prompt": "Wedding heart sign with the names A & M in script font",
        "design": {
            "width": 12, "height": 12, "border": "circle", "border_thickness": 0.15,
            "operations": [
                {"kind": "shape", "primitive": "heart", "x": 0.5, "y": 0.40, "w": 0.6, "h": 0.55},
                {"kind": "text", "content": "A & M", "font": "script", "size": 0.20, "x": 0.5, "y": 0.80},
            ],
            "holes": {"count": 0, "diameter": 0.25, "placement": "top_corners"},
        },
    },
    {
        "id": "hunting-cabin",
        "name": "Hunting Cabin Antlers",
        "category": "Hunting & Country",
        "tag": "antlers",
        "prompt": "Hunting cabin sign with antlers above and pine trees below — text The Lodge",
        "design": {
            "width": 18, "height": 10, "border": "rounded", "border_thickness": 0.18,
            "operations": [
                {"kind": "shape", "primitive": "antlers", "x": 0.5, "y": 0.32, "w": 0.55, "h": 0.42},
                {"kind": "text", "content": "The Lodge", "font": "western", "size": 0.22, "x": 0.5, "y": 0.80},
            ],
            "holes": {"count": 2, "diameter": 0.30, "placement": "top_corners"},
        },
    },
    {
        "id": "memorial-cross",
        "name": "Memorial Cross",
        "category": "Memorial & Faith",
        "tag": "cross",
        "prompt": "Memorial cross with name John Doe and dates in western font",
        "design": {
            "width": 10, "height": 14, "border": "none", "border_thickness": 0,
            "operations": [
                {"kind": "shape", "primitive": "cross", "x": 0.5, "y": 0.40, "w": 0.6, "h": 0.65},
                {"kind": "text", "content": "John Doe", "font": "western", "size": 0.10, "x": 0.5, "y": 0.85},
            ],
            "holes": {"count": 1, "diameter": 0.25, "placement": "top_center"},
        },
    },
    {
        "id": "nautical-anchor",
        "name": "Nautical Anchor",
        "category": "Nautical",
        "tag": "anchor",
        "prompt": "Nautical anchor sign for a beach house — text Ahoy",
        "design": {
            "width": 12, "height": 14, "border": "rounded", "border_thickness": 0.16,
            "operations": [
                {"kind": "shape", "primitive": "anchor", "x": 0.5, "y": 0.40, "w": 0.55, "h": 0.55},
                {"kind": "text", "content": "Ahoy", "font": "bold_serif", "size": 0.18, "x": 0.5, "y": 0.85},
            ],
            "holes": {"count": 2, "diameter": 0.25, "placement": "top_corners"},
        },
    },
    {
        "id": "compass-explorer",
        "name": "Compass Adventure",
        "category": "Adventure",
        "tag": "compass_rose",
        "prompt": "Compass rose with the text Wander Often Wander Far",
        "design": {
            "width": 14, "height": 14, "border": "circle", "border_thickness": 0.15,
            "operations": [
                {"kind": "shape", "primitive": "compass_rose", "x": 0.5, "y": 0.45, "w": 0.65, "h": 0.65},
                {"kind": "text", "content": "Wander Often", "font": "bold_serif", "size": 0.10, "x": 0.5, "y": 0.88},
            ],
            "holes": {"count": 0, "diameter": 0.25, "placement": "top_corners"},
        },
    },
    {
        "id": "rooster-farm",
        "name": "Country Rooster",
        "category": "Farmhouse",
        "tag": "rooster",
        "prompt": "Country rooster farmhouse sign — text Farm Fresh",
        "design": {
            "width": 16, "height": 8, "border": "rounded", "border_thickness": 0.18,
            "operations": [
                {"kind": "shape", "primitive": "rooster", "x": 0.32, "y": 0.50, "w": 0.45, "h": 0.80},
                {"kind": "text", "content": "Farm Fresh", "font": "western", "size": 0.24, "x": 0.70, "y": 0.55},
            ],
            "holes": {"count": 2, "diameter": 0.25, "placement": "top_corners"},
        },
    },
    {
        "id": "music-treble",
        "name": "Music Studio Engraving",
        "category": "Music",
        "tag": "treble_clef",
        "prompt": "Music studio name plate with treble clef — engrave only",
        "design": {
            "width": 12, "height": 6, "border": "rounded", "border_thickness": 0.15,
            "engrave_only": True,
            "operations": [
                {"kind": "shape", "primitive": "treble_clef", "x": 0.20, "y": 0.50, "w": 0.20, "h": 0.80},
                {"kind": "text", "content": "Studio 8", "font": "sans", "size": 0.28, "x": 0.62, "y": 0.55},
            ],
            "holes": {"count": 0, "diameter": 0.25, "placement": "top_corners"},
        },
    },
]


@router.get("/studio/templates")
async def studio_templates():
    """Public catalog of curated starter templates — anonymous OK."""
    return {"templates": STUDIO_TEMPLATES}


@router.get("/studio/materials")
async def studio_materials():
    """Public catalog of materials + depth presets + unit options."""
    return {
        "materials": [
            {"key": k, "label": v["label"], "depths": v["depths"], "border_default": v["border_default"]}
            for k, v in MATERIALS.items()
        ],
        "units": sorted(list(UNITS)),
    }


# ── Refine — AI tweak on existing design (counts as 1 prompt) ──────────────
class RefineBody(BaseModel):
    design: dict
    instruction: str = Field(..., min_length=3, max_length=200)


_REFINE_SYSTEM = """You are the Maker Studio refine assistant. The user has an existing design and wants a small tweak. Output a NEW design JSON object that mirrors the input, applying ONLY the requested change. Use the SAME schema and allowed values as the generator. NEVER drop existing operations unless explicitly told to. Never exceed 4 operations. OUTPUT ONLY THE JSON. No prose."""


@router.post("/studio/refine")
async def studio_refine(body: RefineBody, user: dict = Depends(_current_studio_user)):
    """Apply a small natural-language tweak to an existing design.
    Counts as 1 prompt against the daily quota.
    Example instructions: 'make the heart bigger', 'change the text to Lakeside',
    'switch border to circle', 'add 2 mounting holes at the top'."""
    q = await _user_daily_quota(user)
    if q["remaining"] <= 0:
        raise HTTPException(429, f"Daily quota of {q['cap']} reached. Comes back tomorrow.")

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(503, "AI temporarily unavailable")

    base = _sanitize_design(body.design, body.design.get("width", 12), body.design.get("height", 6))

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key,
            session_id=f"studio-refine-{user['sub'][:8]}-{uuid.uuid4().hex[:6]}",
            system_message=_REFINE_SYSTEM + "\n\n" + _AI_SYSTEM.split("SCHEMA")[0],
        ).with_model("gemini", "gemini-3-flash-preview")
        user_text = (
            f"CURRENT DESIGN JSON:\n{json.dumps(base)}\n\n"
            f"USER INSTRUCTION: {body.instruction}\n\n"
            "Return the FULL updated design JSON only."
        )
        raw = await chat.send_message(UserMessage(text=user_text))
    except Exception as e:
        logger.exception("[studio/refine] AI call failed: %s", e)
        raise HTTPException(503, "AI refine failed")

    parsed = _extract_json(raw or "")
    refined = _sanitize_design(parsed, base["width"], base["height"])

    # Quota accounting (counts as a prompt)
    today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.studio_prompts.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["sub"],
        "role": user["role"],
        "prompt": f"[refine] {body.instruction[:200]}",
        "design": refined,
        "day": today_utc,
        "created_at": now_iso(),
        "kind": "refine",
    })
    new_q = await _user_daily_quota(user)
    return {"design": refined, "quota": new_q}


@router.post("/studio/export-svg")
async def studio_export_svg(body: DesignBody, user: dict = Depends(_current_studio_user)):
    design = _sanitize_design(body.design, body.design.get("width", 12), body.design.get("height", 6))
    svg = render_svg(design)
    summary = design_summary(design)
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", summary["title"].lower())[:32] or "design"
    return StreamingResponse(
        io.BytesIO(svg.encode("utf-8")),
        media_type="image/svg+xml",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.svg"'},
    )


@router.post("/studio/export-dxf")
async def studio_export_dxf(body: DesignBody, user: dict = Depends(_current_studio_user)):
    design = _sanitize_design(body.design, body.design.get("width", 12), body.design.get("height", 6))
    dxf_bytes = render_dxf(design)
    summary = design_summary(design)
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", summary["title"].lower())[:32] or "design"
    return StreamingResponse(
        io.BytesIO(dxf_bytes),
        media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.dxf"'},
    )


# ── Publish to community design files ──────────────────────────────────────
class PublishBody(BaseModel):
    design: dict
    title: Optional[str] = None
    description: Optional[str] = None
    visibility: str = "public"  # public | unlisted
    prompt: Optional[str] = None  # the original prompt the user typed
    also_post_to_showcase: bool = True


@router.post("/studio/publish")
async def studio_publish(body: PublishBody, user: dict = Depends(_current_studio_user)):
    design = _sanitize_design(body.design, body.design.get("width", 12), body.design.get("height", 6))
    svg = render_svg(design)
    dxf_bytes = render_dxf(design)
    summary = design_summary(design)
    title = (body.title or summary["title"] or "AI design").strip()[:80]
    description = (body.description or f"Generated in Maker Studio · {summary['size']} in.").strip()[:400]
    prompt_text = (body.prompt or "").strip()[:400]

    file_id = str(uuid.uuid4())
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", title.lower())[:32] or "design"

    # Upload to R2 if configured, else fall back to data URLs (preview only).
    svg_url: str
    dxf_url: str
    try:
        import r2_storage
        if r2_storage.is_configured():
            svg_url = r2_storage.upload_bytes(
                svg.encode("utf-8"),
                key=f"studio/{file_id}/{safe}.svg",
                content_type="image/svg+xml",
            )
            dxf_url = r2_storage.upload_bytes(
                dxf_bytes,
                key=f"studio/{file_id}/{safe}.dxf",
                content_type="application/dxf",
            )
        else:
            raise RuntimeError("r2 not configured")
    except Exception:
        import base64
        svg_url = "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")
        dxf_url = ""

    # Maker attribution for the design_files feed. Buyer-published designs
    # are tagged with the synthetic 'community-studio' slug so the feed UI
    # can render a buyer badge instead of a maker portrait.
    maker_slug = user["sub"] if user["role"] == "maker" else "community-studio"
    maker_name = "Studio Member"
    if user["role"] == "maker":
        m = await db.makers.find_one({"slug": user["sub"]}, {"_id": 0, "name": 1, "shop_name": 1})
        if m:
            maker_name = m.get("shop_name") or m.get("name") or user["sub"]

    # Write to `design_files` — the canonical community files collection
    # that powers /community?tab=files. The earlier prototype wrote to
    # `community_files` which the feed UI does NOT read; iter237 fixes this.
    doc = {
        "id": file_id,
        "file_id": file_id,
        "title": title,
        "description": description,
        "thumbnail_url": svg_url,
        "primary_url": svg_url,
        "file_type": "svg",
        "file_size_kb": max(1, len(svg.encode("utf-8")) // 1024),
        "variants": [
            {"format": "svg", "url": svg_url, "size": len(svg.encode("utf-8"))},
        ] + ([{"format": "dxf", "url": dxf_url, "size": len(dxf_bytes)}] if dxf_url else []),
        "maker_slug": maker_slug,
        "maker_name": maker_name,
        "owner_id": user["sub"],
        "owner_role": user["role"],
        "visibility": body.visibility if body.visibility in ("public", "unlisted") else "public",
        "source": "maker_studio_ai",
        "design_intent": design,
        "ai_prompt": prompt_text,
        "downloads": 0,
        "created_at": now_iso(),
        "file_verified": True,
        "ai_generated": True,
        "quarantined_at": None,
    }
    await db.design_files.insert_one(doc)

    # iter237 — Surface AI designs in the community showcase carousel too.
    # Public-only; unlisted designs stay in the files feed only. Use the
    # same SVG as the showcase image_url so it renders inline alongside
    # buyer + maker photos.
    showcase_post_id: Optional[str] = None
    if doc["visibility"] == "public" and body.also_post_to_showcase:
        try:
            showcase_post_id = str(uuid.uuid4())
            await db.showcase_posts.insert_one({
                "id": showcase_post_id,
                "user_id": (f"maker:{user['sub']}" if user["role"] == "maker" else user["sub"]),
                "user_email": user["claims"].get("email", ""),
                "user_name": maker_name if user["role"] == "maker" else "Studio Member",
                "user_picture": "",
                "user_role": user["role"],
                "maker_slug": maker_slug if user["role"] == "maker" else None,
                "title": title,
                "caption": prompt_text or f"AI-generated · {summary['size']} in.",
                "image_url": svg_url,
                "image_urls": [svg_url],
                "tags": ["ai-design", "maker-studio"] + [s for s in summary["shapes"][:2] if s],
                "likes": 0,
                "created_at": now_iso(),
                "source": "maker_studio_ai",
                "design_file_id": file_id,
                "ai_generated": True,
            })
        except Exception:
            logger.exception("[studio] showcase mirror insert failed (non-fatal)")
            showcase_post_id = None

    doc.pop("_id", None)
    return {"file": doc, "showcase_post_id": showcase_post_id}


# ── Remix — pre-load an existing AI design as the starting point ───────────
@router.get("/studio/remix/{file_id}")
async def studio_remix(file_id: str, user: dict = Depends(_current_studio_user)):
    """Fetch the original prompt + sanitized design for a previously-published
    Studio file so the frontend can pre-fill the prompt box and preview.
    Public designs are visible to everyone signed in; unlisted designs are
    only visible to their owner."""
    f = await db.design_files.find_one(
        {"id": file_id, "source": "maker_studio_ai"},
        {"_id": 0},
    )
    if not f:
        raise HTTPException(404, "Design not found or not remixable")
    if f.get("visibility") == "unlisted" and f.get("owner_id") != user["sub"]:
        raise HTTPException(403, "This design is unlisted")
    intent = f.get("design_intent") or {}
    return {
        "id": f["id"],
        "title": f.get("title", ""),
        "prompt": f.get("ai_prompt", ""),
        "design": _sanitize_design(intent, intent.get("width", 12), intent.get("height", 6)),
        "maker_name": f.get("maker_name"),
    }
