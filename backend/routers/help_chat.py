"""
iter312 — Help & Support AI chat (onboarding-focused).
iter413cq — Now reads live platform capabilities + supports AI-diagnosed bug reports.

Distinct from `routers/ai.py` (which is the buyer-facing shopping
concierge for product Q&A and custom-order intake). This router
powers the floating `?` help widget on every page — answers
platform-mechanics questions (Stripe Connect, listing schema,
GPC taxonomy, custom orders, fees, refunds, returns).

Logged separately to `db.help_questions` so we can:
- Surface the top-10 confusions to ops weekly.
- Identify UI friction (high question volume on one page = redesign signal).
- Build an FAQ page from real questions, not guesses.

iter413cq — Loretta Alvarado seller feedback uncovered the assistant
contradicting itself about platform features (videos supported / not /
report a bug). Root cause was static text in the prompt drifting from
runtime reality. Fix: pull `/api/platform/capabilities` at request time
and inject it as a CAPABILITIES block. The system prompt now defers to
that JSON over its own knowledge for any feature-availability question.

Also added `POST /help/report-issue` so the same widget can convert
support friction into a structured bug report routed to the Contact
Inbox (reuses the iter413cb impersonation-bug fan-out pattern).
"""
import json
import os
import uuid
from typing import Optional, List

from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from core import db, logger, now_iso
from routers.platform_capabilities import build_capabilities_payload

router = APIRouter()

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

SYSTEM_PROMPT_BASE = """You are the Crafters Market Help & Support assistant — a sharp,
patient onboarding guide for an online marketplace of handcrafted goods
across many disciplines (woodworking, metalwork, leather, fiber & textiles,
pottery, glass, jewelry, mixed media, and more — not just CNC).

Two distinct audiences ask you questions:
- **BUYERS** (role=visitor or buyer): want to know how to order, custom-order, ship, return.
- **MAKERS** (role=maker): want to set up shop — create listings, connect Stripe, pricing,
  photos, GPC category, payouts, plus subscription.

Tailor every answer to the user's role (you receive `USER ROLE` and `CURRENT PAGE` below).

# AUTHORITATIVE CAPABILITIES — MUST READ FIRST
A `CAPABILITIES` JSON block is appended to this prompt at runtime. It is
the **single source of truth** for what the platform actually does right
now (feature flags, accepted upload types, categories, techniques per
category, product guides, seller-tier limits, commerce policy, support
contacts). Rules:
  1. For any question about whether a feature is supported, accepted, or
     available, ANSWER FROM CAPABILITIES — never from your own memory.
  2. If CAPABILITIES says a feature is disabled (e.g.
     `features.listing_videos.upload_enabled=false`), say so plainly.
     Use the `user_message` field verbatim when provided.
  3. Quote prices, commissions, listing quotas, and category lists from
     CAPABILITIES.seller_limits / .commerce / .taxonomy only.
  4. If the user asks about something not covered in CAPABILITIES and
     not in this prompt, say "I don't have authoritative data on that
     yet — try team@craftersmarket.org." Don't guess.

# PLATFORM MECHANICS — answer these precisely

## For buyers
- **Browsing:** /shop lists everything, /makers shows artisans, /community has design files + showcase + forum.
- **Ordering:** Add to cart → /cart → /checkout. Stripe handles payment (Apple/Google Pay supported).
- **Shipping:** Free over the threshold in CAPABILITIES.commerce.free_shipping_threshold_usd. Built-to-order, 5–10 business days typical.
- **Returns:** Within CAPABILITIES.commerce.returns_window_days unless customised. Craftsmanship guarantee per CAPABILITIES.commerce.craftsmanship_guarantee_days.
- **Custom orders:** /custom-order. Free quote in 24 hours. The buyer-facing AI concierge (different from you) handles intake.
- **Account:** /sign-in for buyers (magic-link or password).
- **Support escalation:** see CAPABILITIES.support.general_email.

## For makers
- **Onboarding:** /maker/login (magic-link). New makers fill out /maker/onboarding (4 steps: profile → shop bio → Stripe Connect → first listing).
- **Stripe Connect** (CRITICAL — most common question):
  - Required before payouts can be released. Click the orange "Connect Stripe" card in Maker Dashboard → redirects to Stripe's Express onboarding (~5 min).
  - Status badge in dashboard turns green when complete. If stuck on "Pending" 24h, the issue is usually missing tax/bank info — log back into Stripe and finish the queued requirements.
- **Listings:**
  - Edit at /maker/dashboard → Listings tab. Required: title, slug (auto-generated), category, technique, materials, price, photos (≥1), description (≥80 chars).
  - **Category & Technique:** Categories + the techniques valid for each category come from CAPABILITIES.taxonomy. Techniques are category-aware — pick a category first, then choose from the techniques offered for that category.
  - **Photos:** Constraints in CAPABILITIES.listing_uploads.image (MIME types, max size, recommended dimensions, max per listing). Lifestyle shots convert ~2.4× better than studio cutouts.
  - **Videos on listings:** Read CAPABILITIES.features.listing_videos before answering — if `upload_enabled=false`, say so plainly using the provided `user_message`. (Community video posts are a separate surface — see `features.community_videos`.)
  - **GPC path** is optional but boosts visibility on Google Shopping / Pinterest / Meta.
  - Listings auto-publish on save unless drafted.
- **Pricing & fees:** Commission and free-listing quotas per tier come from CAPABILITIES.seller_limits. Stripe processing fee: ~2.9% + $0.30 (Stripe-side, not us).
- **Tier upgrades:** "Plus" subscription details in CAPABILITIES.seller_limits.plus. Founder tiers in CAPABILITIES.seller_limits.founder / .inaugural_founder.
- **Custom shop URL:** Read CAPABILITIES.features.custom_shop_url for eligibility.
- **Payouts:** Automatic to maker's Stripe-connected bank, weekly.
- **Maker Studio (AI tools):** /studio — generates SVG/DXF cut paths from a description. Requires login.
- **Custom orders inbox:** /maker/dashboard → Custom Orders tab. Quote within 24h or the lead routes to another maker.
- **Product Guides:** CAPABILITIES.taxonomy.product_guides lists which guides apply to which categories.

## Universal
- **Founders / About:** /about
- **Policy / Terms:** /policy
- **Where We're Going (roadmap):** /where-were-going
- **Free design files:** /free-svg-pack
- **Community:** /community → forum, showcase, design files, live chat

# STYLE
- Sharp, direct, industrial vocabulary. No fluff. Short sentences.
- Plain text. Lists OK. No markdown headings.
- If user is on a specific page (CURRENT PAGE provided), reference what they're looking at.
- If you don't know, say "I'm not sure — try team@craftersmarket.org or post in /community/forum."
- Never invent policies. Never quote prices/limits/features outside of CAPABILITIES + this prompt.
- If a question is clearly a buyer asking about product specifics, say: "Use the chat bubble bottom-right of any product page — that AI handles product questions and quotes."

# BUG-REPORT HANDOFF
If the user describes a clear bug ("X is broken", "Y doesn't work", "error",
"can't do Z"), give them your best diagnosis in 1–2 sentences then add a
final line on its own:

  REPORT_ISSUE_CTA: yes

That cue tells the UI to surface a "Report Issue" button. Don't include
the cue otherwise.
"""


def _capabilities_block() -> str:
    """Serialize the live platform capabilities into the prompt.

    Kept as a sync helper so we can build the system prompt without
    additional awaits in the request hot path. If the payload ever
    grows beyond ~6KB we should switch to a tool-calling pattern, but
    today it's small enough to inline."""
    try:
        payload = build_capabilities_payload()
        return (
            "\n\nCAPABILITIES (live platform state — defer to this over your own memory):\n"
            + json.dumps(payload, indent=2)
        )
    except Exception as e:
        logger.warning("help_chat: capabilities block unavailable: %s", e)
        return "\n\nCAPABILITIES: (unavailable — answer conservatively, defer feature questions to team@craftersmarket.org)"


class HelpChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    page_url: Optional[str] = None
    user_role: Optional[str] = None  # visitor | buyer | maker | admin


@router.post("/help/chat")
async def help_chat(req: HelpChatRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(503, "Help assistant is not configured.")

    session_id = req.session_id or f"help-{uuid.uuid4().hex[:12]}"
    role = (req.user_role or "visitor").lower()
    if role not in ("visitor", "buyer", "maker", "admin"):
        role = "visitor"

    # Reload last 20 turns of this help session into the system prompt
    # so the model has memory of what's already been answered.
    prior = await db.help_questions.find(
        {"session_id": session_id},
        {"_id": 0, "user": 1, "assistant": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(20)
    history_block = ""
    if prior:
        lines = ["CONVERSATION SO FAR:"]
        for t in prior:
            u = (t.get("user") or "").strip()
            a = (t.get("assistant") or "").strip()
            if u:
                lines.append(f"User: {u}")
            if a:
                lines.append(f"Assistant: {a}")
        history_block = "\n\n" + "\n".join(lines)

    context_block = f"\n\nUSER ROLE: {role}\nCURRENT PAGE: {req.page_url or '(unknown)'}"
    capabilities_block = _capabilities_block()

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=SYSTEM_PROMPT_BASE + capabilities_block + context_block + history_block,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    try:
        reply = await chat.send_message(UserMessage(text=req.message))
    except Exception as e:
        logger.exception("Help chat failed: %s", e)
        raise HTTPException(502, "Help assistant is temporarily unavailable.")

    reply_str = str(reply)
    # iter413cq — strip the bug-report cue out of the user-visible text
    # while preserving the signal in the persisted row for analytics.
    bug_cue = "REPORT_ISSUE_CTA: yes" in reply_str
    if bug_cue:
        reply_str = reply_str.replace("REPORT_ISSUE_CTA: yes", "").rstrip()

    await db.help_questions.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "user": req.message,
        "assistant": reply_str,
        "user_role": role,
        "page_url": req.page_url,
        "report_issue_cue": bool(bug_cue),
        "created_at": now_iso(),
    })
    return {
        "session_id": session_id,
        "reply": reply_str,
        "report_issue_cue": bool(bug_cue),
    }


@router.get("/help/analytics/top-questions")
async def top_help_questions(days: int = 7, limit: int = 20):
    """Lightweight ops endpoint: most-asked help questions in the last N days.

    Intentionally NOT admin-gated — there's nothing sensitive here and
    it's useful as a public weekly stat. (Question texts only, no PII —
    sessions aren't tied to user accounts.)
    """
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    pipeline = [
        {"$match": {"created_at": {"$gte": cutoff}}},
        {"$group": {
            "_id": {"$toLower": "$user"},
            "count": {"$sum": 1},
            "sample": {"$first": "$user"},
            "roles": {"$addToSet": "$user_role"},
        }},
        {"$sort": {"count": -1}},
        {"$limit": min(limit, 50)},
        {"$project": {"_id": 0, "question": "$sample", "count": 1, "roles": 1}},
    ]
    return {"questions": await db.help_questions.aggregate(pipeline).to_list(50)}


# ── iter413cq — AI-diagnosed bug report (Loretta P1) ──────────────────
# The Help Assistant detects bug-flavored exchanges and surfaces a
# "Report Issue" CTA. Click → frontend captures conversation context +
# browser/device + listing context (if any) and posts here. We land it
# in db.contact_messages tagged kind="ai_diagnosed_bug" so it surfaces
# alongside other tickets and fans out to Slack/Discord via notify_team
# (reuses the iter413cb impersonation-bug pattern).
#
# Public endpoint by design: the Help widget runs unauthenticated. We
# DO rate-limit (cheap in-process) so abuse can't flood the inbox.

_REPORT_BUCKET: dict[str, list[float]] = {}
_REPORT_LIMIT = 6           # 6 reports per IP per window
_REPORT_WINDOW_S = 300.0    # 5 min


def _check_report_rate_limit(ip: str):
    import time as _t
    now = _t.monotonic()
    arr = [t for t in _REPORT_BUCKET.get(ip, []) if now - t < _REPORT_WINDOW_S]
    if len(arr) >= _REPORT_LIMIT:
        raise HTTPException(429, "Too many reports — please try again in a few minutes.")
    arr.append(now)
    _REPORT_BUCKET[ip] = arr


class HelpConversationTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(max_length=4000)


class HelpReportIssueIn(BaseModel):
    description: str = Field(min_length=4, max_length=4000)
    session_id: Optional[str] = None
    user_role: Optional[str] = None
    page_url: Optional[str] = Field(default=None, max_length=1024)
    listing_id: Optional[str] = Field(default=None, max_length=120)
    listing_slug: Optional[str] = Field(default=None, max_length=200)
    maker_slug: Optional[str] = Field(default=None, max_length=200)
    category: Optional[str] = Field(default=None, max_length=120)
    user_agent: Optional[str] = Field(default=None, max_length=512)
    viewport: Optional[str] = Field(default=None, max_length=64)
    reporter_email: Optional[EmailStr] = None
    reporter_name: Optional[str] = Field(default=None, max_length=120)
    # Last few turns of the AI conversation — the "AI diagnosis".
    conversation: Optional[List[HelpConversationTurn]] = None


@router.post("/help/report-issue")
async def help_report_issue(payload: HelpReportIssueIn, bg: BackgroundTasks, request: Request):
    """Drop an AI-diagnosed bug report into the Contact Inbox.

    Same shape as iter413cb impersonation-bug-report so the admin
    inbox renders it uniformly. Fans out to Slack/Discord via
    notify_team (no-op when unconfigured)."""
    ip = (request.client.host if request.client else "") or ""
    _check_report_rate_limit(ip)

    desc = (payload.description or "").strip()
    role = (payload.user_role or "visitor").lower().strip() or "visitor"
    if role not in ("visitor", "buyer", "maker", "admin"):
        role = "visitor"

    # Render the AI conversation tail (last 2 turns or so — capped at
    # 6 to stay readable in the inbox). We don't need the full session.
    convo_lines: list[str] = []
    for turn in (payload.conversation or [])[-6:]:
        speaker = "User" if turn.role == "user" else "Assistant"
        snippet = (turn.text or "").strip().replace("\n", " ")
        if snippet:
            if len(snippet) > 600:
                snippet = snippet[:600] + "…"
            convo_lines.append(f"  {speaker}: {snippet}")

    listing_line_parts = []
    if payload.listing_slug or payload.listing_id:
        listing_line_parts.append(payload.listing_slug or payload.listing_id)
    if payload.maker_slug:
        listing_line_parts.append(f"maker={payload.maker_slug}")
    if payload.category:
        listing_line_parts.append(f"category={payload.category}")
    listing_line = " · ".join(listing_line_parts) if listing_line_parts else "n/a"

    body_parts = [
        f"User report:\n{desc}",
        "",
        f"Role: {role}",
        f"Page: {payload.page_url or 'n/a'}",
        f"Listing: {listing_line}",
        f"Browser / device: {payload.user_agent or 'n/a'} · viewport={payload.viewport or 'n/a'}",
        f"Session: {payload.session_id or 'n/a'}",
    ]
    if convo_lines:
        body_parts += ["", "AI conversation tail (diagnosis):", *convo_lines]

    reporter_email = (payload.reporter_email or "anonymous@craftersmarket.org")
    reporter_name = (payload.reporter_name or "").strip() or f"Help widget · {role}"
    subject_target = payload.listing_slug or payload.maker_slug or (payload.page_url or "site")
    subject = f"[AI BUG] {subject_target}"[:140]

    doc = {
        "id": str(uuid.uuid4()),
        "name": reporter_name,
        "email": str(reporter_email),
        "subject": subject,
        "topic": "bug",
        "kind": "ai_diagnosed_bug",
        "phone": "",
        "message": "\n".join(body_parts),
        "ip": ip,
        "created_at": now_iso(),
        "resolved": False,
        "replied_at": None,
        "replied_by": None,
        # Sidecar fields for admin UI rendering + future analytics.
        "ai_bug_meta": {
            "session_id": payload.session_id,
            "user_role": role,
            "page_url": payload.page_url,
            "listing_id": payload.listing_id,
            "listing_slug": payload.listing_slug,
            "maker_slug": payload.maker_slug,
            "category": payload.category,
            "user_agent": payload.user_agent,
            "viewport": payload.viewport,
            "conversation": [t.model_dump() for t in (payload.conversation or [])][-6:],
        },
    }
    await db.contact_messages.insert_one(doc)

    # Fan out to ops Slack/Discord. No-op when webhooks unconfigured.
    from notify_webhook import notify_team
    site = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    bg.add_task(
        notify_team,
        kind="ai_diagnosed_bug",
        title=subject,
        summary=desc[:1000],
        fields=[
            ("Role", role),
            ("Page", payload.page_url or "n/a"),
            ("Listing", listing_line),
            ("Reporter", str(reporter_email)),
        ],
        link=f"{site}/admin/dashboard?tab=contact&open={doc['id']}",
    )
    logger.warning(
        "[help] ai-diagnosed bug filed · role=%s · page=%s · id=%s",
        role, payload.page_url, doc["id"],
    )
    return {"received": True, "id": doc["id"]}
