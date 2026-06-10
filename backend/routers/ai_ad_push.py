"""iter349 — Admin AI Ad-Creative push handlers (Phase 4a/4b/4c).

Split out of `routers/ai_ad_creative.py` (which was 790 lines; testing
agent flagged it as too large). The generator + drafts CRUD stays in
`ai_ad_creative.py`; this module owns everything that turns a finalized
draft into a real (PAUSED) campaign on Google / Meta / Microsoft Ads.

Each channel exposes:
  GET  /admin/ad-creative/push/{channel}/preflight
  POST /admin/ad-creative/drafts/{draft_id}/push/{channel}

Plus the cross-channel push history endpoint:
  GET  /admin/ad-creative/pushes
"""
from __future__ import annotations
import logging
import os
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_admin

PUBLIC_SITE_URL = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")

router = APIRouter()
log = logging.getLogger("crafters.ai_ad_push")


# ── Shared helper ──────────────────────────────────────────────────────
async def _resolve_subject_for_push(
    draft: dict,
) -> tuple[str, str, str, str, Optional[str]]:
    """Look up maker_slug + listing_title/description/image_url for the
    draft's subject. Returns (maker_slug, listing_title,
    listing_description, listing_url, listing_image_url)."""
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


async def _preflight(channel: str) -> dict:
    """Probe channel eligibility. Logs unexpected exceptions at WARN
    so silent eligibility regressions surface in admin logs (per
    testing-agent code-review note)."""
    try:
        from services.ads_gateway import get_gateway
        gw = get_gateway(channel)
        ok, reason = await gw.is_eligible("__admin__")
        return {"eligible": ok, "reason": reason}
    except Exception as e:
        log.warning("[ad-push] %s preflight failed: %s", channel, e, exc_info=True)
        return {"eligible": False, "reason": f"Probe failed: {str(e)[:200]}"}


# ── Phase 4a — push to Google Ads ──────────────────────────────────────
class GooglePushRequest(BaseModel):
    daily_budget_cents: int = Field(..., ge=500, le=20000)  # $5-$200/day
    keywords: list[str] = Field(default_factory=list)


@router.get("/admin/ad-creative/push/google/preflight")
async def google_push_preflight(_: dict = Depends(current_admin)):
    """Returns whether Google Ads is connected + write-eligible right
    now, plus a human-readable reason if not. Lets the UI grey-out the
    push button before the admin clicks it."""
    return await _preflight("google")


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

    # Customer-ID for the deep link to Google Ads UI.
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


# ── Phase 4b — push to Meta Ads ────────────────────────────────────────
class MetaPushRequest(BaseModel):
    daily_budget_cents: int = Field(..., ge=500, le=20000)  # $5-$200/day


@router.get("/admin/ad-creative/push/meta/preflight")
async def meta_push_preflight(_: dict = Depends(current_admin)):
    """Returns whether Meta Ads is connected + has the ads_management
    scope. Gates the UI push button so admins don't see write errors
    until the App Review has actually landed."""
    return await _preflight("meta")


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
    return await _preflight("microsoft")


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


# ── Cross-channel push history ─────────────────────────────────────────
@router.get("/admin/ad-creative/pushes")
async def list_pushes(limit: int = 30, _: dict = Depends(current_admin)):
    """List recent admin-initiated campaign pushes across channels."""
    limit = max(1, min(100, int(limit)))
    out: list[dict] = []
    async for d in db.admin_ad_pushes.find({}).sort("pushed_at", -1).limit(limit):
        d.pop("_id", None)
        out.append(d)
    return {"pushes": out}
