from config import env_get
"""AI Assistant router. Powered by Emergent LLM key + emergentintegrations."""
import os
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from core import db, logger, now_iso
from emergent_optional import get_llm_chat, raise_emergent_unavailable
from email_service import send_ops_new_custom_order

router = APIRouter()

EMERGENT_LLM_KEY = env_get("EMERGENT_LLM_KEY", "")

SYSTEM_PROMPT = """You are the Crafters Market AI helper — a friendly, concise concierge for an
online marketplace of handcrafted CNC art (plasma-cut metal, laser-engraved wood, custom signs,
outdoor pieces).

Your jobs:
1. Site help & navigation — answer FAQ, point users to /shop, /makers, /custom-order, /community,
   /maker/login (for makers), /admin/login (for ops).
2. Product Q&A — when the user asks about a specific piece or category, answer based on the
   PRODUCT CONTEXT block below if present. Mention price, materials, dimensions, lead time
   (5–10 business days). Don't invent SKUs that aren't in context.
3. Custom-order intake — if a user describes a custom project, ask for: name, email, project
   type, material, target size, budget, and a one-line description. Once you have those,
   say: "Got it — I'm sending this brief to the team. You'll get a free quote within 24 hours."
   On the next user message, the system will dispatch the brief automatically.

Style:
- Sharp, direct, no fluff. Short sentences. Use industrial/maker vocabulary.
- Use plain text (no markdown headings). Lists OK.
- If you don't know, say so and suggest contacting team@craftersmarket.org or filling
  /custom-order for a custom brief.
- Never make up shipping carriers, return policies, or warranties beyond: "Free shipping on
  orders over $250. Returns within 14 days unless customised. 30-day craftsmanship guarantee."

Marketplace policies in scope:
- Free shipping over $250. Standard rates: Wall Art $25, Custom Signs $35, Outdoor Art $55.
- Each piece is built to order; lead time 5–10 business days.
- Buyer support: team@craftersmarket.org.
"""


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    page_context: Optional[str] = None    # e.g. "Viewing /shop/mountain-range-silhouette"


class CustomBriefDraft(BaseModel):
    name: str
    email: str
    project_type: str
    material: str
    size: Optional[str] = None
    budget: Optional[str] = None
    description: str


async def _build_product_context() -> str:
    products = await db.products.find({}, {"_id": 0}).to_list(50)
    if not products:
        return ""
    lines = ["PRODUCT CONTEXT (current catalog):"]
    for p in products:
        lines.append(
            f"- {p['title']} ({p['category']} · {p['technique']}) · ${p['price']:.0f} · "
            f"slug={p['slug']} · maker={p['maker_slug']}"
        )
    return "\n".join(lines)


@router.post("/ai/chat")
async def ai_chat(req: ChatRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(503, "AI assistant is not configured.")
    llm = get_llm_chat()
    if llm is None:
        raise_emergent_unavailable("AI assistant")
    LlmChat, UserMessage = llm

    session_id = req.session_id or f"anon-{uuid.uuid4().hex[:12]}"
    product_ctx = await _build_product_context()
    page_ctx = f"\nPAGE CONTEXT: {req.page_context}" if req.page_context else ""

    # Replay prior turns from this session so the model has conversational memory.
    # emergentintegrations LlmChat treats session_id as a transcript key only —
    # history must be supplied each call. We bake the last 20 turns into the
    # system message as a transcript preamble.
    prior = await db.ai_chats.find(
        {"session_id": session_id}, {"_id": 0, "user": 1, "assistant": 1, "created_at": 1}
    ).sort("created_at", 1).to_list(20)
    history_block = ""
    if prior:
        lines = ["CONVERSATION SO FAR (most recent at the bottom — remember these facts):"]
        for t in prior:
            u = (t.get("user") or "").strip()
            a = (t.get("assistant") or "").strip()
            if u:
                lines.append(f"User: {u}")
            if a:
                lines.append(f"Assistant: {a}")
        history_block = "\n\n" + "\n".join(lines)

    system_message = SYSTEM_PROMPT + "\n\n" + product_ctx + page_ctx + history_block

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system_message,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    try:
        reply = await chat.send_message(UserMessage(text=req.message))
    except Exception as e:
        logger.exception("AI chat failed: %s", e)
        raise HTTPException(502, "AI assistant is temporarily unavailable.")

    # Persist a transcript entry per turn for audit / context.
    await db.ai_chats.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "user": req.message,
        "assistant": str(reply),
        "page_context": req.page_context,
        "created_at": now_iso(),
    })
    return {"session_id": session_id, "reply": str(reply)}


@router.post("/ai/submit-brief")
async def ai_submit_brief(brief: CustomBriefDraft, bg: BackgroundTasks):
    """Used by the AI widget when a user has agreed to send their custom brief."""
    payload = brief.model_dump()
    payload["id"] = str(uuid.uuid4())
    payload["created_at"] = now_iso()
    payload["source"] = "ai-assistant"
    await db.custom_orders.insert_one(payload)
    await db.activity_events.insert_one({
        "id": str(uuid.uuid4()),
        "kind": "applied",
        "text": f"AI assistant captured a brief — {brief.project_type}",
        "location": "AI assistant",
        "created_at": now_iso(),
    })
    bg.add_task(
        send_ops_new_custom_order,
        brief.name, brief.email, brief.project_type,
        brief.material, brief.description, brief.budget,
    )
    return {"ok": True}
