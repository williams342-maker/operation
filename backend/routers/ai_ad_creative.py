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

from fastapi import APIRouter, Depends, HTTPException
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
    subject_type: str = Field(..., pattern="^(product|maker)$")
    subject_slug: str = Field(..., min_length=2, max_length=200)
    channels: list[str] = Field(..., min_length=1)
    tone: str = "professional"
    generate_images: bool = False
    num_image_variants: int = Field(default=1, ge=0, le=3)


# ── Subject lookup ─────────────────────────────────────────────────────
async def _find_subject(stype: str, slug: str) -> dict:
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
def _build_copy_prompt(subject: dict, channels: list[str], tone: str) -> str:
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

    return (
        "You are writing platform-compliant ad copy for an artisan marketplace listing.\n\n"
        f"SUBJECT:\n{subject_block}\n\n"
        f"TONE: {tone_hint}\n\n"
        "RULES:\n"
        "1. STRICT character limits — count characters. If a line goes over, rewrite it shorter.\n"
        "2. No emojis, no all-caps, no clickbait phrasing.\n"
        "3. Each variant must be distinct (don't paraphrase the same line 5 times).\n"
        "4. Mention the actual product/maker — never generic filler.\n"
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
async def _generate_copy(subject: dict, channels: list[str], tone: str) -> dict:
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

    prompt = _build_copy_prompt(subject, channels, tone)
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


async def _generate_image_variant(subject: dict, draft_id: str, idx: int) -> Optional[str]:
    if not EMERGENT_LLM_KEY:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
    except Exception:
        return None

    fname = f"{draft_id}-{idx}.jpg"
    out_path = AD_CREATIVE_DIR / fname
    public_path = f"{PUBLIC_AD_CREATIVE_PREFIX}/{fname}"

    # Compose a documentary-style prompt — never AI-rendered look.
    bits: list[str] = []
    if subject["type"] == "product":
        bits.append(f"Product: {subject.get('title')}")
        if subject.get("description"):
            bits.append(f"Description: {subject['description'][:300]}")
        if subject.get("technique"):
            bits.append(f"Technique: {subject['technique']}")
        if subject.get("materials"):
            bits.append(f"Materials: {subject['materials']}")
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
    try:
        _text, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))
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
    return {"products": products, "makers": makers}


@router.post("/admin/ad-creative/generate")
async def generate_creative(body: GenerateRequest, admin: dict = Depends(current_admin)):
    bad = [c for c in body.channels if c not in VALID_CHANNELS]
    if bad:
        raise HTTPException(400, f"Unknown channels: {bad}. Must be subset of {sorted(VALID_CHANNELS)}.")
    if body.tone not in VALID_TONES:
        raise HTTPException(400, f"tone must be one of {sorted(VALID_TONES)}")

    subject = await _find_subject(body.subject_type, body.subject_slug)
    draft_id = "draft_" + secrets.token_urlsafe(10)

    copy = await _generate_copy(subject, body.channels, body.tone)

    images: list[str] = []
    if body.generate_images and body.num_image_variants > 0:
        # Generate in parallel but bounded.
        tasks = [
            _generate_image_variant(subject, draft_id, i)
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


# ── Phase 4a — push to Google Ads ──────────────────────────────────────
class GooglePushRequest(BaseModel):
    daily_budget_cents: int = Field(..., ge=500, le=20000)  # $5-$200/day
    keywords: list[str] = Field(default_factory=list)


@router.get("/admin/ad-creative/push/google/preflight")
async def google_push_preflight(_: dict = Depends(current_admin)):
    """Returns whether Google Ads is connected + write-eligible right
    now, plus a human-readable reason if not. Lets the UI grey-out the
    push button before the admin clicks it."""
    try:
        from services.ads_gateway import get_gateway
        gw = get_gateway("google")
        # is_eligible takes a maker_slug for per-maker checks, but the
        # admin push is platform-level — pass a sentinel. The Google
        # adapter doesn't gate by maker, only by env + OAuth state.
        ok, reason = await gw.is_eligible("__admin__")
        return {"eligible": ok, "reason": reason}
    except Exception as e:
        return {"eligible": False, "reason": f"Probe failed: {str(e)[:200]}"}


@router.post("/admin/ad-creative/drafts/{draft_id}/push/google")
async def push_draft_to_google(draft_id: str, body: GooglePushRequest,
                               admin: dict = Depends(current_admin)):
    """Take a Phase-3 draft and create a real Google Ads campaign in
    PAUSED state with the AI-generated RSA headlines/descriptions.
    Admin must explicitly Activate it inside Google Ads UI before any
    spend happens. We persist the (draft_id ↔ external_campaign_id)
    link in `admin_ad_pushes` for traceability."""
    draft = await db.ad_creative_drafts.find_one({"_id": draft_id})
    if not draft:
        raise HTTPException(404, "Draft not found.")
    google_copy = (draft.get("copy") or {}).get("google_search") or {}
    headlines = [h for h in (google_copy.get("headlines") or []) if h]
    descriptions = [d for d in (google_copy.get("descriptions") or []) if d]
    if len(headlines) < 3:
        raise HTTPException(
            400,
            f"This draft only has {len(headlines)} non-empty Google headlines. "
            "Google RSA requires ≥3. Regenerate the draft with the google_search "
            "channel selected.",
        )

    # Pull the original subject to resolve maker_slug + landing URL.
    subject_type = draft.get("subject_type")
    subject_slug = draft.get("subject_slug")
    landing_path = draft.get("landing_path") or "/"
    listing_url = f"{PUBLIC_SITE_URL}{landing_path}"

    if subject_type == "product":
        product = await db.products.find_one({"slug": subject_slug})
        maker_slug = (product or {}).get("maker_slug") or "platform"
        listing_title = (product or {}).get("title") or subject_slug
        listing_description = (product or {}).get("description") or ""
        images = (product or {}).get("images") or []
        listing_image_url = images[0] if images else (product or {}).get("image_url")
    else:  # maker
        maker = await db.makers.find_one({"slug": subject_slug})
        maker_slug = subject_slug
        listing_title = (maker or {}).get("shop_title") or (maker or {}).get("name") or subject_slug
        listing_description = (maker or {}).get("bio") or ""
        listing_image_url = (maker or {}).get("cover") or (maker or {}).get("portrait")

    from services.ads_gateway import get_gateway, CreateCampaignSpec
    from services.ads_gateway.base import GatewayError, GatewayNotEligible

    spec = CreateCampaignSpec(
        maker_slug=maker_slug,
        listing_slug=subject_slug,
        listing_title=listing_title,
        listing_description=listing_description,
        listing_url=listing_url,
        listing_image_url=listing_image_url,
        daily_budget_cents=int(body.daily_budget_cents),
        keywords=list(body.keywords or []),
        headlines=headlines,
        descriptions=descriptions,
    )
    gw = get_gateway("google")
    try:
        handle = await gw.create_campaign(spec)
    except GatewayNotEligible as e:
        raise HTTPException(409, str(e))
    except GatewayError as e:
        raise HTTPException(502, str(e))

    push_doc = {
        "_id": "push_" + secrets.token_urlsafe(10),
        "draft_id": draft_id,
        "channel": "google",
        "external_campaign_id": handle.external_id,
        "status": handle.status,
        "note": handle.note,
        "subject_type": subject_type,
        "subject_slug": subject_slug,
        "subject_title": draft.get("subject_title"),
        "maker_slug": maker_slug,
        "daily_budget_cents": int(body.daily_budget_cents),
        "headline_count": len(headlines),
        "description_count": len(descriptions),
        "keyword_count": len(body.keywords or []),
        "pushed_by": (admin or {}).get("email") or "admin",
        "pushed_at": now_iso(),
    }
    await db.admin_ad_pushes.insert_one(push_doc)
    push_doc.pop("_id", None)

    # Customer-ID for the deep link to Google Ads UI (so admin can
    # click straight to the paused campaign).
    cred = await db.integration_credentials.find_one({"_id": "google_ads"})
    customer_id = (cred or {}).get("customer_id") or ""
    google_ads_url = None
    if customer_id and handle.external_id:
        cid = customer_id.replace("-", "")
        google_ads_url = (
            f"https://ads.google.com/aw/campaigns?ocid={cid}"
            f"&campaignId={handle.external_id}"
        )

    return {
        "push": push_doc,
        "google_ads_url": google_ads_url,
        "message": (
            f"Created campaign {handle.external_id} in PAUSED state with "
            f"{len(headlines)} headlines and {len(descriptions)} descriptions. "
            "Activate it inside Google Ads when ready — no spend until then."
        ),
    }


@router.get("/admin/ad-creative/pushes")
async def list_pushes(limit: int = 30, _: dict = Depends(current_admin)):
    """List recent admin-initiated campaign pushes across channels."""
    limit = max(1, min(100, int(limit)))
    out: list[dict] = []
    async for d in db.admin_ad_pushes.find({}).sort("pushed_at", -1).limit(limit):
        d.pop("_id", None)
        out.append(d)
    return {"pushes": out}


# ── Phase 4b — push to Meta Ads ────────────────────────────────────────
class MetaPushRequest(BaseModel):
    daily_budget_cents: int = Field(..., ge=500, le=20000)  # $5-$200/day


@router.get("/admin/ad-creative/push/meta/preflight")
async def meta_push_preflight(_: dict = Depends(current_admin)):
    """Returns whether Meta Ads is connected + has the ads_management
    scope. Gates the UI push button so admins don't see write errors
    until the App Review has actually landed."""
    try:
        from services.ads_gateway import get_gateway
        gw = get_gateway("meta")
        ok, reason = await gw.is_eligible("__admin__")
        return {"eligible": ok, "reason": reason}
    except Exception as e:
        return {"eligible": False, "reason": f"Probe failed: {str(e)[:200]}"}


async def _resolve_subject_for_push(draft: dict) -> tuple[str, str, str, str, Optional[str]]:
    """Look up maker_slug + listing_title/description/image_url for the
    draft's subject. Returns (maker_slug, listing_title, listing_description,
    listing_url, listing_image_url)."""
    subject_type = draft.get("subject_type")
    subject_slug = draft.get("subject_slug")
    landing_path = draft.get("landing_path") or "/"
    listing_url = f"{PUBLIC_SITE_URL}{landing_path}"
    if subject_type == "product":
        product = await db.products.find_one({"slug": subject_slug})
        maker_slug = (product or {}).get("maker_slug") or "platform"
        listing_title = (product or {}).get("title") or subject_slug
        listing_description = (product or {}).get("description") or ""
        images = (product or {}).get("images") or []
        listing_image_url = images[0] if images else (product or {}).get("image_url")
    else:  # maker
        maker = await db.makers.find_one({"slug": subject_slug})
        maker_slug = subject_slug
        listing_title = (maker or {}).get("shop_title") or (maker or {}).get("name") or subject_slug
        listing_description = (maker or {}).get("bio") or ""
        listing_image_url = (maker or {}).get("cover") or (maker or {}).get("portrait")
    return maker_slug, listing_title, listing_description, listing_url, listing_image_url


@router.post("/admin/ad-creative/drafts/{draft_id}/push/meta")
async def push_draft_to_meta(draft_id: str, body: MetaPushRequest,
                             admin: dict = Depends(current_admin)):
    """Push a Phase-3 draft to Meta Ads as a paused campaign.

    Maps `meta_feed.headlines[0]` → `link_data.name` (40 char limit)
    and `meta_feed.primary_texts[0]` → `link_data.message` (125 char
    limit). Campaign + AdSet + Creative + Ad all land PAUSED — admin
    must activate inside Meta Ads Manager to spend."""
    draft = await db.ad_creative_drafts.find_one({"_id": draft_id})
    if not draft:
        raise HTTPException(404, "Draft not found.")
    meta_copy = (draft.get("copy") or {}).get("meta_feed") or {}
    headlines = [h for h in (meta_copy.get("headlines") or []) if h]
    primary_texts = [p for p in (meta_copy.get("primary_texts") or []) if p]
    if not headlines or not primary_texts:
        raise HTTPException(
            400,
            "This draft has no Meta headlines or primary texts. "
            "Regenerate the draft with the meta_feed channel selected.",
        )

    (maker_slug, listing_title, listing_description,
     listing_url, listing_image_url) = await _resolve_subject_for_push(draft)

    from services.ads_gateway import get_gateway, CreateCampaignSpec
    from services.ads_gateway.base import GatewayError, GatewayNotEligible

    spec = CreateCampaignSpec(
        maker_slug=maker_slug,
        listing_slug=draft.get("subject_slug") or "",
        listing_title=listing_title,
        listing_description=listing_description,
        listing_url=listing_url,
        listing_image_url=listing_image_url,
        daily_budget_cents=int(body.daily_budget_cents),
        # Hand the AI-generated Meta assets to the gateway. The Meta
        # gateway's `_create_creative` reads `headlines[0]` as the ad
        # name and `descriptions[0]` as the primary text (message).
        headlines=headlines,
        descriptions=primary_texts,
    )
    gw = get_gateway("meta")
    try:
        handle = await gw.create_campaign(spec)
    except GatewayNotEligible as e:
        raise HTTPException(409, str(e))
    except GatewayError as e:
        raise HTTPException(502, str(e))

    push_doc = {
        "_id": "push_" + secrets.token_urlsafe(10),
        "draft_id": draft_id,
        "channel": "meta",
        "external_campaign_id": handle.external_id,
        "status": handle.status,
        "note": handle.note,
        "subject_type": draft.get("subject_type"),
        "subject_slug": draft.get("subject_slug"),
        "subject_title": draft.get("subject_title"),
        "maker_slug": maker_slug,
        "daily_budget_cents": int(body.daily_budget_cents),
        "headline_count": len(headlines),
        "primary_text_count": len(primary_texts),
        "pushed_by": (admin or {}).get("email") or "admin",
        "pushed_at": now_iso(),
    }
    await db.admin_ad_pushes.insert_one(push_doc)
    push_doc.pop("_id", None)

    ad_account = os.environ.get("META_AD_ACCOUNT_ID", "").strip()
    meta_ads_url = None
    if ad_account and handle.external_id:
        acct = ad_account.replace("act_", "")
        meta_ads_url = (
            f"https://business.facebook.com/adsmanager/manage/campaigns"
            f"?act={acct}&selected_campaign_ids={handle.external_id}"
        )

    return {
        "push": push_doc,
        "meta_ads_url": meta_ads_url,
        "message": (
            f"Created Meta campaign {handle.external_id} in PAUSED state. "
            "Activate inside Meta Ads Manager when ready — no spend until then."
        ),
    }


# ── Phase 4c — push to Microsoft (Bing) Ads ────────────────────────────
class MicrosoftPushRequest(BaseModel):
    daily_budget_cents: int = Field(..., ge=500, le=20000)  # $5-$200/day
    keywords: list[str] = Field(default_factory=list)


@router.get("/admin/ad-creative/push/microsoft/preflight")
async def microsoft_push_preflight(_: dict = Depends(current_admin)):
    """Returns whether Microsoft Ads is connected + has customer/account
    IDs configured. Microsoft RSA reuses the Google Search channel copy
    (same 30-char headlines, 90-char descriptions)."""
    try:
        from services.ads_gateway import get_gateway
        gw = get_gateway("microsoft")
        ok, reason = await gw.is_eligible("__admin__")
        return {"eligible": ok, "reason": reason}
    except Exception as e:
        return {"eligible": False, "reason": f"Probe failed: {str(e)[:200]}"}


@router.post("/admin/ad-creative/drafts/{draft_id}/push/microsoft")
async def push_draft_to_microsoft(draft_id: str, body: MicrosoftPushRequest,
                                  admin: dict = Depends(current_admin)):
    """Push a Phase-3 draft to Microsoft (Bing) Ads as a paused campaign.

    Microsoft RSA shares the same spec as Google Search (3-15 headlines
    ≤30 chars · 2-4 descriptions ≤90 chars), so we consume the draft's
    `google_search` copy directly. Campaign + AdGroup + RSA + Keywords
    all land PAUSED — admin must activate inside Microsoft Ads UI to
    spend."""
    draft = await db.ad_creative_drafts.find_one({"_id": draft_id})
    if not draft:
        raise HTTPException(404, "Draft not found.")
    google_copy = (draft.get("copy") or {}).get("google_search") or {}
    headlines = [h for h in (google_copy.get("headlines") or []) if h]
    descriptions = [d for d in (google_copy.get("descriptions") or []) if d]
    if len(headlines) < 3:
        raise HTTPException(
            400,
            f"This draft only has {len(headlines)} non-empty Google/Microsoft "
            "headlines. Bing RSA requires ≥3. Regenerate the draft with the "
            "google_search channel selected (Microsoft reuses that spec).",
        )

    (maker_slug, listing_title, listing_description,
     listing_url, listing_image_url) = await _resolve_subject_for_push(draft)

    from services.ads_gateway import get_gateway, CreateCampaignSpec
    from services.ads_gateway.base import GatewayError, GatewayNotEligible

    spec = CreateCampaignSpec(
        maker_slug=maker_slug,
        listing_slug=draft.get("subject_slug") or "",
        listing_title=listing_title,
        listing_description=listing_description,
        listing_url=listing_url,
        listing_image_url=listing_image_url,
        daily_budget_cents=int(body.daily_budget_cents),
        keywords=list(body.keywords or []),
        headlines=headlines,
        descriptions=descriptions,
    )
    gw = get_gateway("microsoft")
    try:
        handle = await gw.create_campaign(spec)
    except GatewayNotEligible as e:
        raise HTTPException(409, str(e))
    except GatewayError as e:
        raise HTTPException(502, str(e))

    push_doc = {
        "_id": "push_" + secrets.token_urlsafe(10),
        "draft_id": draft_id,
        "channel": "microsoft",
        "external_campaign_id": handle.external_id,
        "status": handle.status,
        "note": handle.note,
        "subject_type": draft.get("subject_type"),
        "subject_slug": draft.get("subject_slug"),
        "subject_title": draft.get("subject_title"),
        "maker_slug": maker_slug,
        "daily_budget_cents": int(body.daily_budget_cents),
        "headline_count": len(headlines),
        "description_count": len(descriptions),
        "keyword_count": len(body.keywords or []),
        "pushed_by": (admin or {}).get("email") or "admin",
        "pushed_at": now_iso(),
    }
    await db.admin_ad_pushes.insert_one(push_doc)
    push_doc.pop("_id", None)

    cred = await db.integration_credentials.find_one({"_id": "microsoft_ads"})
    customer_id = (cred or {}).get("customer_id") or os.environ.get("BING_CUSTOMER_ID", "")
    account_id = (cred or {}).get("account_id") or os.environ.get("BING_ACCOUNT_ID", "")
    microsoft_ads_url = None
    if customer_id and account_id and handle.external_id:
        microsoft_ads_url = (
            f"https://ui.ads.microsoft.com/campaign/vnext/campaigns"
            f"?aid={account_id}&cid={customer_id}"
        )

    return {
        "push": push_doc,
        "microsoft_ads_url": microsoft_ads_url,
        "message": (
            f"Created Microsoft campaign {handle.external_id} in PAUSED "
            f"state with {len(headlines)} headlines and {len(descriptions)} "
            "descriptions. Activate inside Microsoft Advertising when ready — "
            "no spend until then."
        ),
    }
