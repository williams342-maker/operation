"""iter347 — AI Ad-Creative Workshop.

Phase 3 of the admin-creates-ads roadmap. Admin picks a product or maker
and we generate platform-ready ad copy variants (Google Search, Meta,
Pinterest) plus optional Nano Banana image variants. Output is saved to
the `ad_creative_drafts` collection so admin can revisit drafts later.

Important: this *does not* push ads to any platform. It's a copy/paste
factory. The Phase 4 "campaign push" router will consume these drafts.

Char limits we enforce (verified against each platform's 2025 docs):
  google_search:  5 headlines (≤30 chars), 4 descriptions (≤90 chars)
  meta_feed:      3 primary texts (≤125 chars), 3 headlines (≤40 chars),
                  2 descriptions (≤30 chars)
  pinterest:      2 titles (≤100 chars), 2 descriptions (≤500 chars)
"""
from __future__ import annotations
import asyncio
import base64
import json
import logging
import os
import re
import secrets
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_admin

PUBLIC_SITE_URL = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")

router = APIRouter()
log = logging.getLogger("crafters.ai_ad_creative")

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
AD_CREATIVE_DIR = Path("/app/frontend/public/ad-creatives")
AD_CREATIVE_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_AD_CREATIVE_PREFIX = "/ad-creatives"

VALID_CHANNELS = {"google_search", "meta_feed", "pinterest"}
VALID_TONES = {"professional", "playful", "rustic", "premium", "urgent", "minimal"}

# Char-limit spec for prompt + post-generation enforcement.
CHANNEL_SPEC = {
    "google_search": {
        "label": "Google Search (Responsive Search Ads)",
        "fields": [
            {"key": "headlines",    "count": 5, "max": 30, "label": "Headlines"},
            {"key": "descriptions", "count": 4, "max": 90, "label": "Descriptions"},
        ],
    },
    "meta_feed": {
        "label": "Meta (Facebook + Instagram Feed)",
        "fields": [
            {"key": "primary_texts", "count": 3, "max": 125, "label": "Primary text"},
            {"key": "headlines",     "count": 3, "max": 40,  "label": "Headlines"},
            {"key": "descriptions",  "count": 2, "max": 30,  "label": "Descriptions"},
        ],
    },
    "pinterest": {
        "label": "Pinterest Ads",
        "fields": [
            {"key": "titles",       "count": 2, "max": 100, "label": "Titles"},
            {"key": "descriptions", "count": 2, "max": 500, "label": "Descriptions"},
        ],
    },
}


# ── Schemas ────────────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    # iter413r — `site` subject type lets admin generate brand-level
    # marketplace ads (Crafters Market itself) alongside per-product and
    # per-maker ads. The site subject is synthetic — `subject_slug` is
    # always "crafters-market" for this type.
    subject_type: str = Field(..., pattern="^(product|maker|site)$")
    subject_slug: str = Field(..., min_length=2, max_length=200)
    channels: list[str] = Field(..., min_length=1)
    tone: str = "professional"
    generate_images: bool = False
    num_image_variants: int = Field(default=1, ge=0, le=3)
    # iter355 — Reference-asset IDs from the Workshop library to use as
    # style/subject anchors for both copy and image generation. Only image
    # assets are passed to the image model; video assets are noted in the
    # copy prompt but ignored by the visual generator (Nano Banana cannot
    # consume video as a reference).
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=4)
    # iter379 — Proven Google Search Console queries (from the SEO wins
    # rollup) the admin wants woven into the copy. Terms the site already
    # ranks/clicks for convert better as ad keywords.
    seo_keywords: list[str] = Field(default_factory=list, max_length=10)


# ── Subject lookup ─────────────────────────────────────────────────────
# iter413r — Brand-level "site" subject. Synthetic marketplace metadata
# used when the admin wants to run a self-promoting brand campaign
# rather than a product- or maker-specific one. We deliberately keep
# the description short + on-brand so the LLM has clear copy direction
# without needing to scrape the homepage at request-time.
SITE_SUBJECT = {
    "type": "site",
    "slug": "crafters-market",
    "title": "Crafters Market",
    "tagline": "The American Handmade Marketplace",
    "description": (
        "An American handmade marketplace connecting buyers directly with "
        "independent makers — woodworking, pottery, jewelry, leather goods, "
        "metalwork, fiber arts, and more. Every piece shipped direct from "
        "the workshop. No middlemen, no factory-line resellers."
    ),
    "value_props": [
        "Direct from the workshop",
        "Veteran-owned shops welcome",
        "Made in the USA",
        "No resellers, no mass-production",
        "Support independent craftspeople",
    ],
    "image_url": "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    "landing_path": "/",
}


async def _find_subject(stype: str, slug: str) -> dict:
    if stype == "site":
        # The site subject is fixed — slug is informational only.
        # We do NOT 404 on slug mismatch; admin UI passes the canonical
        # slug and any drift here would just confuse the operator.
        return dict(SITE_SUBJECT)
    if stype == "product":
        doc = await db.products.find_one({"slug": slug, "status": "published"})
        if not doc:
            raise HTTPException(404, "Product not found (or not published).")
        maker = await db.makers.find_one({"slug": doc.get("maker_slug")}) if doc.get("maker_slug") else None
        images = doc.get("images") or ([doc.get("image_url")] if doc.get("image_url") else [])
        return {
            "type": "product",
            "slug": doc["slug"],
            "title": doc.get("title") or doc["slug"],
            "description": doc.get("description") or "",
            "category": doc.get("category"),
            "technique": doc.get("technique"),
            "materials": doc.get("materials"),
            "dimensions": doc.get("dimensions"),
            "price": doc.get("price"),
            "maker_slug": doc.get("maker_slug"),
            "maker_name": (maker or {}).get("shop_title") or (maker or {}).get("name"),
            "maker_location": (maker or {}).get("location"),
            "is_veteran_owned": bool((maker or {}).get("is_veteran_owned")),
            "image_url": images[0] if images else None,
            "landing_path": f"/shop/{doc['slug']}",
        }
    # maker
    doc = await db.makers.find_one({"slug": slug, "status": "approved"})
    if not doc:
        raise HTTPException(404, "Maker not found (or not approved).")
    return {
        "type": "maker",
        "slug": doc["slug"],
        "title": doc.get("shop_title") or doc.get("name") or doc["slug"],
        "description": doc.get("bio") or "",
        "techniques": doc.get("techniques"),
        "location": doc.get("location"),
        "is_veteran_owned": bool(doc.get("is_veteran_owned")),
        "image_url": doc.get("cover") or doc.get("portrait"),
        "landing_path": f"/makers/{doc['slug']}",
    }


# ── Prompt builder ─────────────────────────────────────────────────────
def _build_copy_prompt(subject: dict, channels: list[str], tone: str,
                       seo_keywords: list[str] | None = None) -> str:
    spec_lines: list[str] = []
    json_schema_lines: list[str] = []
    for ch in channels:
        spec = CHANNEL_SPEC[ch]
        fields_desc = ", ".join(
            f"{f['count']}× {f['label']} ≤{f['max']} chars" for f in spec["fields"]
        )
        spec_lines.append(f"- {ch} ({spec['label']}): {fields_desc}")
        field_obj = {f["key"]: [f'<string ≤{f["max"]} chars>'] * f["count"] for f in spec["fields"]}
        json_schema_lines.append(f'  "{ch}": {json.dumps(field_obj)}')

    subject_block = "\n".join(f"- {k}: {v}" for k, v in subject.items() if v not in (None, "", []))

    tone_hint = {
        "professional": "Clear, benefit-led, no hype.",
        "playful":      "Warm, conversational, light wordplay welcome.",
        "rustic":       "Earthy, handmade, evokes workshop authenticity.",
        "premium":      "Refined, restrained, signals craftsmanship.",
        "urgent":       "Action-led, time-sensitive (e.g. 'this week').",
        "minimal":      "Spare, declarative, never more than one idea per line.",
    }.get(tone, "Clear, benefit-led.")

    # iter379 — Proven search queries from GSC: terms Google already sends
    # clicks for. The model should reuse this exact language where natural.
    seo_block = ""
    if seo_keywords:
        seo_block = (
            "\nPROVEN SEARCH QUERIES (real Google Search Console terms this site "
            "already ranks and gets clicks for — weave the most relevant ones "
            "NATURALLY into headlines/descriptions, exact or close phrasing, "
            "never keyword-stuff):\n- " + "\n- ".join(seo_keywords[:10]) + "\n"
        )

    # iter413r — Brand-level reframing for the site subject. Without
    # this, the LLM treats the marketplace's title as if it were a
    # single product and writes weird product-style copy.
    brand_block = ""
    if subject.get("type") == "site":
        brand_block = (
            "\nBRAND-LEVEL AD: This subject is the MARKETPLACE ITSELF — "
            "not a product, not a maker. Copy MUST:\n"
            "  - Speak to BUYERS (handmade discovery, supporting "
            "independent American makers, gift-worthy, real craftspeople).\n"
            "  - Use the marketplace's value props naturally: direct from "
            "the workshop, no resellers/no mass-production, US makers.\n"
            "  - NEVER invent specific items, prices, or maker names.\n"
            "  - Send buyers to the shop landing page (the site root), "
            "not a product URL.\n"
        )

    return (
        "You are writing platform-compliant ad copy for an artisan marketplace listing.\n\n"
        f"SUBJECT:\n{subject_block}\n"
        f"{brand_block}"
        f"\nTONE: {tone_hint}\n"
        f"{seo_block}\n"
        "RULES:\n"
        "1. STRICT character limits — count characters. If a line goes over, rewrite it shorter.\n"
        "2. No emojis, no all-caps, no clickbait phrasing.\n"
        "3. Each variant must be distinct (don't paraphrase the same line 5 times).\n"
        "4. Mention the actual product/maker — never generic filler.\n"
        "   (For brand-level ads, mention the marketplace's actual value "
        "    props — Crafters Market, handmade, American makers, direct "
        "    from workshop. NEVER 'generic filler'.)\n"
        "5. If 'is_veteran_owned' is true, at least one variant per channel should subtly reference it.\n"
        "6. Output VALID JSON only — no prose, no markdown fences.\n\n"
        "CHANNEL SPECS:\n"
        + "\n".join(spec_lines) + "\n\n"
        "OUTPUT JSON SHAPE:\n{\n" + ",\n".join(json_schema_lines) + "\n}\n"
    )


def _enforce_limits(channel: str, payload: dict) -> dict:
    """Best-effort guard: trims overlong strings to spec, pads short
    fields with safe defaults so the admin UI never shows missing rows."""
    spec = CHANNEL_SPEC[channel]
    out: dict[str, list[str]] = {}
    for f in spec["fields"]:
        items = payload.get(f["key"]) or []
        if not isinstance(items, list):
            items = []
        items = [str(x).strip() for x in items if x is not None and str(x).strip()]
        items = [x[: f["max"]] for x in items][: f["count"]]
        while len(items) < f["count"]:
            items.append("")  # surface gap in UI rather than fabricate
        out[f["key"]] = items
    return out


# ── LLM calls ──────────────────────────────────────────────────────────
async def _generate_copy(subject: dict, channels: list[str], tone: str,
                          reference_summary: list[str] | None = None,
                          seo_keywords: list[str] | None = None) -> dict:
    if not EMERGENT_LLM_KEY:
        raise HTTPException(503, "EMERGENT_LLM_KEY not set — cannot generate copy.")
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
    except Exception as e:
        raise HTTPException(503, f"emergentintegrations not installed: {e}")

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"adcopy-{subject['slug']}-{uuid.uuid4().hex[:8]}",
        system_message=(
            "You generate platform-compliant ad copy for an artisan marketplace. "
            "Always output strict, valid JSON. Never add prose or markdown fences."
        ),
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    prompt = _build_copy_prompt(subject, channels, tone, seo_keywords=seo_keywords)
    if reference_summary:
        # iter355 — surface the reference assets so the LLM can align
        # tone/imagery in headlines (e.g. mention "tactile texture" when
        # the references are workshop close-ups).
        prompt += (
            "\n\nREFERENCE CREATIVE ATTACHED (visual style anchors):\n- "
            + "\n- ".join(reference_summary[:10])
            + "\nKeep the copy consistent with these references in tone and subject focus."
        )
    reply = await chat.send_message(UserMessage(text=prompt))
    text = str(reply or "").strip()
    # Strip code fences if the model adds them despite instructions.
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE | re.MULTILINE).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # Last-ditch: extract first {...} block.
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            raise HTTPException(502, "LLM returned unparseable copy. Try again.")
        parsed = json.loads(m.group(0))

    return {ch: _enforce_limits(ch, parsed.get(ch) or {}) for ch in channels}


async def _generate_image_variant(subject: dict, draft_id: str, idx: int,
                                   reference_images: list[dict] | None = None) -> Optional[str]:
    """Generate one ad image variant via Nano Banana.

    iter355 — when `reference_images` is non-empty, attach each one as a
    `FileContent` input so Nano Banana uses them as visual style/subject
    anchors. Each reference is a dict shaped `{content_type, b64}` —
    callers pass at most 4 to keep the prompt manageable.
    """
    if not EMERGENT_LLM_KEY:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContent  # type: ignore
    except Exception:
        return None

    fname = f"{draft_id}-{idx}.jpg"
    out_path = AD_CREATIVE_DIR / fname
    public_path = f"{PUBLIC_AD_CREATIVE_PREFIX}/{fname}"

    # Compose a documentary-style prompt — never AI-rendered look.
    bits: list[str] = []
    # iter413s — Brand-level image generation. When subject is the
    # marketplace itself, render a documentary-style multi-craft scene
    # that reads as "American handmade marketplace" rather than any
    # single product. Three rotating compositions keep variants distinct.
    if subject["type"] == "site":
        bits.append(
            "Subject: Crafters Market — an American handmade marketplace. "
            "Render a documentary-style composition that signals BREADTH "
            "of crafts (no single hero product). The image should feel "
            "like a magazine spread photographing several maker workshops."
        )
        if subject.get("value_props"):
            bits.append("Brand notes: " + " · ".join(subject["value_props"]))
        brand_styles = [
            # idx 0 — Workshop overhead flat-lay (Pinterest favourite)
            "Overhead flat-lay on weathered oak workbench: a hand-thrown "
            "ceramic mug, a finished walnut cutting board with planer "
            "shavings beside it, a coil of brown leather, and a small "
            "hand-forged iron hook arranged in loose grid. Soft natural "
            "north-light from above. Subtle workshop ambience — paper "
            "patterns, a metal ruler, a sliver of sawdust. Square 1:1, "
            "no text, no watermark, no logo, no people.",
            # idx 1 — Triptych workshop scene (Meta carousel-friendly)
            "Three real workshop vignettes composed as a horizontal "
            "triptych within one square frame: a potter's wheel mid-spin "
            "on the left, a maker's hands gluing leather in the centre, "
            "a CNC walnut sign close-up on the right. Warm tungsten + "
            "natural daylight mix. Slightly out-of-focus backgrounds. "
            "Documentary style, no AI gloss. Square 1:1, no text, no "
            "logo, no watermark.",
            # idx 2 — Single-frame brand collage with shallow depth
            "Single magazine-style shot through an open workshop door: "
            "in the foreground a freshly-fired ceramic vase on a wooden "
            "stool; mid-ground a maker's hands carefully wrapping it in "
            "kraft paper for shipping; background a sun-lit shelf of "
            "finished pieces (mugs, leather goods, small wooden boxes). "
            "Late-afternoon golden light. Shallow depth of field. Real "
            "photography, no AI artifacts. Square 1:1, no text, no logo.",
        ]
        style = brand_styles[idx % len(brand_styles)]
    elif subject["type"] == "product":
        bits.append(f"Product: {subject.get('title')}")
        if subject.get("description"):
            bits.append(f"Description: {subject['description'][:300]}")
        if subject.get("technique"):
            bits.append(f"Technique: {subject['technique']}")
        if subject.get("materials"):
            bits.append(f"Materials: {subject['materials']}")
        styles = [
            "Lifestyle photo, natural daylight, shallow depth of field, in-context use, "
            "documentary style. Square 1:1 framing, no text, no watermark.",
            "Product hero on neutral concrete or oak surface, soft side lighting, "
            "clean composition, magazine quality. Square 1:1, no text.",
            "Maker hands-at-work shot, workshop ambiance, slightly out-of-focus background, "
            "warm tungsten light. Square 1:1, no text.",
        ]
        style = styles[idx % len(styles)]
    else:
        bits.append(f"Maker: {subject.get('title')}")
        if subject.get("description"):
            bits.append(f"Bio: {subject['description'][:300]}")
        if subject.get("techniques"):
            bits.append(f"Techniques: {subject['techniques']}")
        styles = [
            "Lifestyle photo, natural daylight, shallow depth of field, in-context use, "
            "documentary style. Square 1:1 framing, no text, no watermark.",
            "Product hero on neutral concrete or oak surface, soft side lighting, "
            "clean composition, magazine quality. Square 1:1, no text.",
            "Maker hands-at-work shot, workshop ambiance, slightly out-of-focus background, "
            "warm tungsten light. Square 1:1, no text.",
        ]
        style = styles[idx % len(styles)]

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"adimage-{draft_id}-{idx}-{uuid.uuid4().hex[:6]}",
        system_message=(
            "You generate photorealistic, documentary-style photography for an "
            "artisan marketplace. Avoid AI-rendered look, watermarks, and on-image text."
        ),
    ).with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])

    prompt = "\n".join(bits) + "\n\nStyle: " + style
    if reference_images:
        prompt += (
            "\n\nReference images are attached. Match their colour palette, "
            "lighting, and overall mood while keeping the product/subject as "
            "the focus. Do NOT copy the references — generate a new image "
            "that feels consistent with them."
        )
    try:
        file_contents = [
            FileContent(content_type=ref["content_type"], file_content_base64=ref["b64"])
            for ref in (reference_images or [])
        ]
        user_msg = UserMessage(text=prompt, file_contents=file_contents or None)
        _text, images = await chat.send_message_multimodal_response(user_msg)
        if not images:
            return None
        img_bytes = base64.b64decode(images[0]["data"])
        out_path.write_bytes(img_bytes)
        return public_path
    except Exception as e:
        log.warning("[ad-image] variant %d failed for %s: %s", idx, draft_id, e)
        return None


# ── Endpoints ──────────────────────────────────────────────────────────
@router.get("/admin/ad-creative/subjects")
async def list_subjects(q: str = "", limit: int = 12, _: dict = Depends(current_admin)):
    """Search products + makers for the subject picker. Returns merged list."""
    limit = max(1, min(50, int(limit)))
    q = (q or "").strip()
    # Products
    p_query: dict = {"status": "published", "category": {"$exists": True}}
    if q:
        p_query["$or"] = [
            {"slug": {"$regex": re.escape(q), "$options": "i"}},
            {"title": {"$regex": re.escape(q), "$options": "i"}},
        ]
    products: list[dict] = []
    async for d in db.products.find(p_query, {"slug": 1, "title": 1, "maker_slug": 1, "image_url": 1, "images": 1}).limit(limit):
        images = d.get("images") or []
        products.append({
            "type": "product",
            "slug": d["slug"],
            "title": d.get("title") or d["slug"],
            "maker_slug": d.get("maker_slug"),
            "image_url": (images[0] if images else d.get("image_url")) or "",
        })
    # Makers
    m_query: dict = {"status": "approved"}
    if q:
        m_query["$or"] = [
            {"slug": {"$regex": re.escape(q), "$options": "i"}},
            {"name": {"$regex": re.escape(q), "$options": "i"}},
            {"shop_title": {"$regex": re.escape(q), "$options": "i"}},
        ]
    makers: list[dict] = []
    async for d in db.makers.find(m_query, {"slug": 1, "name": 1, "shop_title": 1, "portrait": 1, "cover": 1}).limit(limit):
        makers.append({
            "type": "maker",
            "slug": d["slug"],
            "title": d.get("shop_title") or d.get("name") or d["slug"],
            "image_url": d.get("portrait") or d.get("cover") or "",
        })

    # iter413r — Synthetic "site" subject for brand-level ads. Surfaced
    # whenever the query is empty OR matches brand/site terminology so
    # admin can find it without scrolling past products/makers. Always
    # present in the response so UI knows to render the brand entry.
    site_match = (not q) or any(
        token in q.lower()
        for token in ("site", "brand", "marketplace", "crafters", "self")
    )
    site_entries = [{
        "type": "site",
        "slug": SITE_SUBJECT["slug"],
        "title": f"{SITE_SUBJECT['title']} — {SITE_SUBJECT['tagline']}",
        "image_url": SITE_SUBJECT["image_url"],
    }] if site_match else []

    return {"products": products, "makers": makers, "site": site_entries}


@router.post("/admin/ad-creative/generate")
async def generate_creative(body: GenerateRequest, admin: dict = Depends(current_admin)):
    bad = [c for c in body.channels if c not in VALID_CHANNELS]
    if bad:
        raise HTTPException(400, f"Unknown channels: {bad}. Must be subset of {sorted(VALID_CHANNELS)}.")
    if body.tone not in VALID_TONES:
        raise HTTPException(400, f"tone must be one of {sorted(VALID_TONES)}")

    subject = await _find_subject(body.subject_type, body.subject_slug)
    draft_id = "draft_" + secrets.token_urlsafe(10)

    # iter355 — Load reference assets (image bytes for Nano Banana,
    # filenames for the copy LLM). Caps at 4 image refs to keep the
    # multimodal prompt under typical token budgets.
    reference_images: list[dict] = []
    reference_summary: list[str] = []
    if body.reference_asset_ids:
        async for a in db.ad_workshop_assets.find(
            {"_id": {"$in": list(body.reference_asset_ids)}}
        ):
            reference_summary.append(
                f"{a.get('kind', 'image')} · {a.get('original_filename') or a.get('_id')}"
            )
            if a.get("kind") == "image" and len(reference_images) < 4:
                try:
                    path = Path(a.get("stored_path") or "")
                    if path.exists():
                        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
                        reference_images.append({
                            "content_type": a.get("mime") or "image/jpeg",
                            "b64": b64,
                        })
                except Exception as e:
                    log.warning("[ad-generate] could not load reference asset %s: %s",
                                a.get("_id"), e)

    seo_keywords = [str(k).strip()[:80] for k in (body.seo_keywords or []) if str(k).strip()][:10]
    copy = await _generate_copy(subject, body.channels, body.tone,
                                reference_summary=reference_summary,
                                seo_keywords=seo_keywords)

    images: list[str] = []
    if body.generate_images and body.num_image_variants > 0:
        # Generate in parallel but bounded.
        tasks = [
            _generate_image_variant(subject, draft_id, i,
                                    reference_images=reference_images)
            for i in range(body.num_image_variants)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        images = [r for r in results if isinstance(r, str)]

    doc = {
        "_id": draft_id,
        "draft_id": draft_id,
        "subject_type": body.subject_type,
        "subject_slug": body.subject_slug,
        "subject_title": subject.get("title"),
        "subject_image": subject.get("image_url"),
        "landing_path": subject.get("landing_path"),
        "channels": body.channels,
        "tone": body.tone,
        "copy": copy,
        "images": images,
        # iter355 — persist the reference list so the admin UI can re-render
        # what was used and the push handlers can include them in audit rows.
        "reference_asset_ids": list(body.reference_asset_ids),
        "reference_asset_count": len(body.reference_asset_ids),
        "reference_images_used": len(reference_images),
        # iter379 — GSC-proven queries used for this generation.
        "seo_keywords": seo_keywords,
        "created_by": (admin or {}).get("email") or "admin",
        "created_at": now_iso(),
    }
    await db.ad_creative_drafts.insert_one(doc)
    doc.pop("_id", None)
    return {"draft": doc, "channel_spec": {ch: CHANNEL_SPEC[ch] for ch in body.channels}}


@router.get("/admin/ad-creative/drafts")
async def list_drafts(limit: int = 20, _: dict = Depends(current_admin)):
    limit = max(1, min(100, int(limit)))
    out: list[dict] = []
    async for d in db.ad_creative_drafts.find({}).sort("created_at", -1).limit(limit):
        d.pop("_id", None)
        out.append(d)
    return {"drafts": out}


@router.get("/admin/ad-creative/drafts/{draft_id}")
async def get_draft(draft_id: str, _: dict = Depends(current_admin)):
    d = await db.ad_creative_drafts.find_one({"_id": draft_id})
    if not d:
        raise HTTPException(404, "Draft not found.")
    d.pop("_id", None)
    return {"draft": d, "channel_spec": {ch: CHANNEL_SPEC[ch] for ch in (d.get("channels") or [])}}


@router.delete("/admin/ad-creative/drafts/{draft_id}")
async def delete_draft(draft_id: str, _: dict = Depends(current_admin)):
    d = await db.ad_creative_drafts.find_one({"_id": draft_id})
    if not d:
        raise HTTPException(404, "Draft not found.")
    # Best-effort unlink image files (so we don't leak disk space).
    for img in d.get("images") or []:
        try:
            if isinstance(img, str) and img.startswith(PUBLIC_AD_CREATIVE_PREFIX + "/"):
                p = AD_CREATIVE_DIR / Path(img).name
                if p.exists():
                    p.unlink()
        except Exception:
            pass
    await db.ad_creative_drafts.delete_one({"_id": draft_id})
    return {"deleted": True}



# ── iter354 — Workshop reference-asset uploads ─────────────────────────
# Admins can upload pre-shot photos / videos to attach to a draft so the
# generated ad copy is informed by the actual creative they'll run.
# Used as Pinterest Ad references, Meta carousel sources, etc.
UPLOAD_DIR = Path("/app/backend/static/ad_workshop_uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_MIMES = {
    # Images
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
    # Videos
    "video/mp4", "video/quicktime", "video/webm", "video/mpeg",
}
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB caps Pinterest's video size


@router.post("/admin/ad-creative/uploads")
async def upload_workshop_asset(
    file: UploadFile = File(...),
    draft_id: Optional[str] = Form(None),
    _: dict = Depends(current_admin),
):
    """Accept an image or video file (≤50 MB) and persist it for reuse
    in the AI Workshop. If `draft_id` is supplied, the asset is attached
    to that draft's `reference_assets` array. Otherwise it lives in the
    workshop's standalone library and can be attached later."""
    ctype = (file.content_type or "").lower()
    if ctype not in ALLOWED_MIMES:
        raise HTTPException(
            415,
            f"Unsupported type {ctype!r}. Allowed: "
            "JPG/PNG/WEBP/GIF images, MP4/MOV/WEBM videos.",
        )
    # Stream-read so we don't load 50 MB into memory at once.
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1 << 20)  # 1 MB
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "File exceeds 50 MB cap.")
        chunks.append(chunk)
    blob = b"".join(chunks)

    # Stable id + sniffed extension
    asset_id = "asset_" + secrets.token_urlsafe(10)
    ext_map = {
        "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
        "image/webp": ".webp", "image/gif": ".gif",
        "video/mp4": ".mp4", "video/quicktime": ".mov",
        "video/webm": ".webm", "video/mpeg": ".mpeg",
    }
    ext = ext_map.get(ctype, "")
    path = UPLOAD_DIR / f"{asset_id}{ext}"
    path.write_bytes(blob)

    kind = "video" if ctype.startswith("video/") else "image"
    doc = {
        "_id": asset_id,
        "kind": kind,
        "mime": ctype,
        "size_bytes": total,
        "original_filename": (file.filename or "")[:200],
        "stored_path": str(path),
        "url": f"{PUBLIC_SITE_URL}/api/admin/ad-creative/uploads/{asset_id}",
        "uploaded_at": now_iso(),
        "draft_id": draft_id or None,
    }
    await db.ad_workshop_assets.insert_one(doc)

    if draft_id:
        # Attach to draft for one-click reuse from the generator UI.
        await db.ad_creative_drafts.update_one(
            {"_id": draft_id},
            {"$push": {"reference_assets": asset_id}},
        )

    out = dict(doc)
    out.pop("stored_path", None)
    out.pop("_id", None)
    out["id"] = asset_id
    return out


@router.get("/admin/ad-creative/uploads")
async def list_workshop_assets(
    draft_id: Optional[str] = None, limit: int = 50,
    _: dict = Depends(current_admin),
):
    """List uploaded reference assets. Pass `draft_id` to scope to one
    draft's library, omit it to see the global workshop library."""
    limit = max(1, min(200, int(limit)))
    q: dict = {}
    if draft_id:
        q["draft_id"] = draft_id
    out: list[dict] = []
    async for d in db.ad_workshop_assets.find(q).sort("uploaded_at", -1).limit(limit):
        d["id"] = d.pop("_id", None)
        d.pop("stored_path", None)
        out.append(d)
    return {"assets": out}


@router.get("/admin/ad-creative/uploads/{asset_id}")
async def get_workshop_asset(asset_id: str):
    """Serve a previously-uploaded workshop asset. Intentionally PUBLIC
    (read-only) so admin-generated ads can hot-link the asset URL into
    Google Ads / Meta Ads previews without needing admin JWT plumbing
    on those external platforms. Asset IDs are cryptographically random
    so enumeration is infeasible."""
    from fastapi.responses import FileResponse
    doc = await db.ad_workshop_assets.find_one({"_id": asset_id})
    if not doc:
        raise HTTPException(404, "Asset not found")
    path = Path(doc.get("stored_path") or "")
    if not path.exists():
        raise HTTPException(410, "Asset file missing from disk.")
    return FileResponse(
        path,
        media_type=doc.get("mime") or "application/octet-stream",
        filename=doc.get("original_filename") or asset_id,
    )


@router.delete("/admin/ad-creative/uploads/{asset_id}")
async def delete_workshop_asset(asset_id: str,
                                _: dict = Depends(current_admin)):
    """Delete an uploaded asset + remove the draft attachment if any."""
    doc = await db.ad_workshop_assets.find_one({"_id": asset_id})
    if not doc:
        raise HTTPException(404, "Asset not found")
    try:
        Path(doc.get("stored_path") or "").unlink(missing_ok=True)
    except Exception as e:
        log.warning("[workshop-upload] file unlink failed for %s: %s",
                    asset_id, e)
    await db.ad_workshop_assets.delete_one({"_id": asset_id})
    # Detach from any drafts.
    await db.ad_creative_drafts.update_many(
        {"reference_assets": asset_id},
        {"$pull": {"reference_assets": asset_id}},
    )
    return {"ok": True, "deleted": asset_id}

