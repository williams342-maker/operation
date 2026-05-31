"""
iter312 — Help & Support AI chat (onboarding-focused).

Distinct from `routers/ai.py` (which is the buyer-facing shopping
concierge for product Q&A and custom-order intake). This router
powers the floating `?` help widget on every page — answers
platform-mechanics questions (Stripe Connect, listing schema,
GPC taxonomy, custom orders, fees, refunds, returns).

Logged separately to `db.help_questions` so we can:
- Surface the top-10 confusions to ops weekly.
- Identify UI friction (high question volume on one page = redesign signal).
- Build an FAQ page from real questions, not guesses.
"""
import os
import uuid
from typing import Optional

from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core import db, logger, now_iso

router = APIRouter()

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

SYSTEM_PROMPT = """You are the Crafters Market Help & Support assistant — a sharp,
patient onboarding guide for an online marketplace of handcrafted CNC art.

Two distinct audiences ask you questions:
- **BUYERS** (role=visitor or buyer): want to know how to order, custom-order, ship, return.
- **MAKERS** (role=maker): want to set up shop — create listings, connect Stripe, pricing,
  photos, GPC category, payouts, plus subscription.

Tailor every answer to the user's role (you receive `USER ROLE` and `CURRENT PAGE` below).

# PLATFORM MECHANICS — answer these precisely

## For buyers
- **Browsing:** /shop lists everything, /makers shows artisans, /community has design files + showcase + forum.
- **Ordering:** Add to cart → /cart → /checkout. Stripe handles payment (Apple/Google Pay supported).
- **Shipping:** Free over $250. Standard: Wall Art $25, Custom Signs $35, Outdoor Art $55. Built-to-order, 5–10 business days.
- **Returns:** Within 14 days unless customised. 30-day craftsmanship guarantee on workmanship.
- **Custom orders:** /custom-order. Free quote in 24 hours. The buyer-facing AI concierge (different from you) handles intake.
- **Account:** /sign-in for buyers (magic-link or password).
- **Support escalation:** team@craftersmarket.org

## For makers
- **Onboarding:** /maker/login (magic-link). New makers fill out /maker/onboarding (4 steps: profile → shop bio → Stripe Connect → first listing).
- **Stripe Connect** (CRITICAL — most common question):
  - Required before payouts can be released. Click the orange "Connect Stripe" card in Maker Dashboard → redirects to Stripe's Express onboarding (~5 min).
  - Status badge in dashboard turns green when complete. If stuck on "Pending" 24h, the issue is usually missing tax/bank info — log back into Stripe and finish the queued requirements.
  - Test mode vs live mode is auto-detected based on env.
- **Listings:**
  - Edit at /maker/dashboard → Listings tab. Required: title, slug (auto-generated), category, technique, materials, price, photos (≥1), description (≥80 chars).
  - **GPC path** is optional but boosts visibility on Google Shopping / Pinterest / Meta. Pick the closest taxonomy node (e.g. "Home & Garden > Decor > Artwork > Prints" for prints, "Home & Garden > Decor > Wall Décor" for wall art). The combobox suggests presets.
  - **Photos** — 1200×1200 minimum, ≤8MB each. Lifestyle shots convert 2.4× better than studio cutouts.
  - Listings auto-publish on save unless drafted.
- **Pricing & fees:**
  - Platform commission: 8% on sale. Stripe fee: 2.9% + $0.30. Maker keeps ~89%.
  - Crafters Plus subscription: $19/mo unlocks 0% commission, priority surfacing, AI tools (Maker Studio), and ad credits. Worth it >$240/mo gross.
- **Payouts:** Automatic to maker's Stripe-connected bank, weekly.
- **Maker Studio (AI tools):** /studio — generates SVG/DXF cut paths from a description. Requires login. Free for Plus, pay-per-use for free tier.
- **Custom orders inbox:** /maker/dashboard → Custom Orders tab. Quote within 24h or the lead routes to another maker.
- **Lead magnet:** /free-svg-pack — buyers download a free SVG starter pack in exchange for their email. Drives newsletter sign-ups.

## Universal
- **Founders / About:** /about
- **Policy / Terms:** /policy
- **Where We're Going (roadmap):** /where-were-going
- **Free design files:** /free-svg-pack (10 designs, SVG + DXF)
- **Community:** /community → forum, showcase, design files, live chat

# STYLE
- Sharp, direct, industrial vocabulary. No fluff. Short sentences.
- Plain text. Lists OK. No markdown headings.
- If user is on a specific page (CURRENT PAGE provided), reference what they're looking at.
- If you don't know, say "I'm not sure — try team@craftersmarket.org or post in /community/forum."
- Never invent policies. Never quote prices you weren't given here.
- If a question is clearly a buyer asking about product specifics, say: "Use the chat bubble bottom-right of any product page — that AI handles product questions and quotes."
"""


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

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=SYSTEM_PROMPT + context_block + history_block,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    try:
        reply = await chat.send_message(UserMessage(text=req.message))
    except Exception as e:
        logger.exception("Help chat failed: %s", e)
        raise HTTPException(502, "Help assistant is temporarily unavailable.")

    reply_str = str(reply)
    await db.help_questions.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "user": req.message,
        "assistant": reply_str,
        "user_role": role,
        "page_url": req.page_url,
        "created_at": now_iso(),
    })
    return {"session_id": session_id, "reply": reply_str}


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
