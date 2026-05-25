"""
Weekly forum-thread seeder.

Picks one CNC/maker topic at random from a curated topic bank that's
designed to be **educational + searchable + long-tail SEO friendly**
(NO fake drama, NO emotional fluff). For the picked topic, asks Gemini
Flash to produce:
  • A thread starter — title + 2-3 paragraph body, written like a real
    working maker asking a useful question.
  • 1-2 starter replies, each from a different generic-username
    persona, in the same voice we use elsewhere.

Inserted with `is_seed: true` and `seed_order: 200+` so the purge
endpoint sweeps them and the existing seed UI/styling treats them
correctly. Idempotent — skips topics whose title is already on the
board, and the job is wrapped in a global try/except so a single
failure never breaks the scheduler.

Runs from scheduler.py every Tuesday at 14:00 UTC.
"""
from __future__ import annotations

import json
import logging
import os
import random
import re
import uuid
from datetime import datetime, timedelta, timezone

from core import db

logger = logging.getLogger("crafters.weekly_threads")

# Generic maker usernames — shared with seed_forum_replies.py so the
# new replies blend in with the existing community voices.
_USERNAMES = [
    "SteelCraftFab", "PlasmaForge", "CNCGarage", "LaserBuilt",
    "WorkshopNorth", "BitsAndBytes", "ShopFloor47", "MidwestMaker",
    "ChipBreaker", "GarageCNC", "BackshedBuilds", "TabsAndBridges",
]

# Curated topic bank — each topic is a short prompt seed. The LLM
# turns it into a full thread starter. Topics are SEO-grade
# (specific tools, materials, techniques) so the resulting threads
# pull long-tail organic traffic over time.
_TOPIC_BANK = [
    # CNC & fabrication
    ("CNC & Fabrication", "Best beginner-friendly desktop CNC under $1500 right now?"),
    ("CNC & Fabrication", "How do you actually measure runout on a router collet?"),
    ("CNC & Fabrication", "Climb vs conventional milling on hardwood — what's the consensus?"),
    ("CNC & Fabrication", "Sourcing affordable 6061 aluminum sheet without minimum-order pain"),
    ("CNC & Fabrication", "Dust shoe DIY — what actually keeps shop air clean?"),
    # Plasma
    ("Plasma", "Plasma cutting 14ga steel — what consumables hold up the longest?"),
    ("Plasma", "Slag underside on plasma cuts — is it always air pressure?"),
    ("Plasma", "Best workflow from SVG → DXF → plasma table without losing detail?"),
    # Laser
    ("Laser Engraving", "Air-assist nozzle upgrades that actually made a difference?"),
    ("Laser Engraving", "Best wood for crisp laser-engraved photo reproductions?"),
    ("Laser Engraving", "Cleaning soot off laser-engraved walnut without bleaching the grain"),
    # Finishing & coating
    ("Finishing", "Outdoor finish for raw mild steel — patina vs powder coat vs Cor-Ten?"),
    ("Finishing", "Food-safe finishes for end-grain butcher blocks — what's everyone using?"),
    ("Finishing", "Spray gun vs HVLP turbine for shop-scale finishing — worth the upgrade?"),
    # Business
    ("Selling & Business", "Pricing a one-off commission — formula or gut?"),
    ("Selling & Business", "Shipping heavy steel art without it arriving bent"),
    ("Selling & Business", "Phone camera vs DSLR for product listings — does it move the needle?"),
    ("Selling & Business", "How do you handle scope creep on custom orders without losing the client?"),
    # Workshop
    ("Workshop Setup", "Lighting a 400 sq ft shop on a tight budget — LED panel recs?"),
    ("Workshop Setup", "Compressor sizing for plasma + air-assist laser running together"),
    ("Workshop Setup", "French cleat wall vs pegboard — which actually scales with you?"),
    # Maker showcase prompts
    ("Maker Showcase", "What's the smallest detail you've cut on your machine?"),
    ("Maker Showcase", "Your most-repeat-ordered product — and why you think it works"),
    ("Maker Showcase", "Show your worst first-week mistake — yours and what fixed it"),
]


async def _generate_thread_via_llm(channel: str, seed_prompt: str) -> dict | None:
    """Ask Gemini Flash to expand the seed into a full thread + replies.

    Returns a dict with `title`, `body`, and `replies` (list of dicts
    with `body`). Returns None on any failure.
    """
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.warning("emergentintegrations unavailable: %s", e)
        return None

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        logger.warning("EMERGENT_LLM_KEY missing — skipping weekly thread")
        return None

    reply_count = random.randint(1, 2)
    prompt = f"""You're a community manager seeding a single forum thread for an artisan CNC/maker marketplace. The forum reads like a working-maker community — practical, specific, technical, not marketing.

CHANNEL: {channel}
TOPIC SEED: {seed_prompt}

Generate ONE thread starter + {reply_count} short starter replies.

THREAD RULES:
- title: 60–90 chars. Phrase as a real working maker would (e.g. "Plasma cutting 14ga steel — what consumables actually hold up?"), not as marketing.
- body: 2 short paragraphs, ~80–140 words total. Mention specific tools/brands/materials/settings where natural. Sound like someone genuinely asking, not pitching.
- NO emojis. NO emotional storytelling. NO "Hi everyone!" openers.

REPLY RULES:
- Each reply 1–3 sentences (max ~70 words).
- Specific & helpful: actual feed rates, brand names, supplier tips, settings, gotchas.
- Different angle per reply: practical answer / different experience / follow-up question.
- NO "great post!" filler. NO emojis.

Return ONLY valid JSON, no markdown fencing. Schema:
{{"title": "...", "body": "...", "replies": [{{"body": "..."}}, ...]}}"""

    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"weekly-thread-{uuid.uuid4().hex[:8]}",
            system_message="You generate authentic, specific, helpful CNC/maker forum content. Output strict JSON only.",
        )
        .with_model("gemini", "gemini-3-flash-preview")
    )

    try:
        text = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.warning("LLM call failed: %s", e)
        return None

    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    try:
        data = json.loads(cleaned)
    except Exception:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not m:
            logger.warning("non-JSON response from LLM, skipping")
            return None
        try:
            data = json.loads(m.group(0))
        except Exception:
            logger.warning("still non-JSON, skipping")
            return None

    if not data.get("title") or not data.get("body"):
        return None
    return data


async def seed_weekly_thread() -> dict:
    """Pick a topic, expand it via LLM, write the thread + replies to
    Mongo. Wrapped in try/except by the caller. Returns a small status
    dict so the scheduler can log it.
    """
    # Pull topics that aren't already on the board (case-insensitive
    # title comparison). Shuffle so we don't always hit the same one.
    candidates = list(_TOPIC_BANK)
    random.shuffle(candidates)

    existing_titles = set()
    async for t in db.forum_threads.find({}, {"_id": 0, "title": 1}):
        existing_titles.add((t.get("title") or "").strip().lower())

    chosen = None
    for channel, seed in candidates:
        # Skip topics whose seed already exists as-is. We can't know the
        # LLM-generated title until we ask, so this is a coarse filter —
        # we re-check below with the actual generated title.
        if seed.strip().lower() in existing_titles:
            continue
        chosen = (channel, seed)
        break

    if not chosen:
        logger.info("weekly thread: every topic already seeded — skipping")
        return {"status": "skip", "reason": "topics_exhausted"}

    channel, seed = chosen
    data = await _generate_thread_via_llm(channel, seed)
    if not data:
        return {"status": "skip", "reason": "llm_failure"}

    # Re-check existence on the generated title (LLM might rephrase the
    # seed prompt; we don't want a near-duplicate of a previously-seeded
    # thread).
    title = data["title"].strip()
    if title.lower() in existing_titles:
        logger.info("weekly thread: generated title already exists — skipping")
        return {"status": "skip", "reason": "title_collision"}

    now = datetime.now(timezone.utc)
    thread_id = str(uuid.uuid4())
    thread_doc = {
        "id": thread_id,
        "title": title,
        "body": data["body"].strip(),
        "tag": channel,
        "channel": channel,
        "user_id": "seed-workshop-team",
        "user_email": "workshop@craftersmarket.org",
        "user_name": "Crafters Market Workshop Team",
        "attachments": [],
        "reply_count": 0,
        "created_at": now.isoformat(),
        "last_activity_at": now.isoformat(),
        "is_seed": True,
        "seed_order": 200,
        "ai_mod_action": "allow",
        "ai_mod_reason": "seeded_by_system",
    }
    await db.forum_threads.insert_one(thread_doc)

    # Insert starter replies — 4-36 hours later, varied so the timeline
    # doesn't look auto-generated.
    pool = _USERNAMES.copy()
    random.shuffle(pool)
    used = set()
    reply_count = 0
    for i, r in enumerate(data.get("replies", [])):
        body = (r.get("body") or "").strip()
        if len(body) < 20:
            continue
        username = next((u for u in pool if u not in used), random.choice(_USERNAMES))
        used.add(username)
        offset = random.randint(4, 36) * (i + 1)
        reply_doc = {
            "id": str(uuid.uuid4()),
            "thread_id": thread_id,
            "user_id": f"seed-{username.lower()}",
            "user_email": f"{username.lower()}@craftersmarket.org",
            "user_name": username,
            "body": body,
            "attachments": [],
            "created_at": (now + timedelta(hours=offset)).isoformat(),
            "is_seed": True,
            "seed_order": 201 + i,
            "ai_mod_action": "allow",
            "ai_mod_reason": "seeded_by_system",
        }
        await db.forum_replies.insert_one(reply_doc)
        reply_count += 1

    # Bump reply_count + last_activity_at if we wrote any replies.
    if reply_count:
        await db.forum_threads.update_one(
            {"id": thread_id},
            {"$set": {
                "reply_count": reply_count,
                "last_activity_at": (now + timedelta(hours=random.randint(36, 72))).isoformat(),
            }},
        )

    logger.info("weekly thread seeded: title='%s', replies=%d", title, reply_count)
    return {"status": "ok", "title": title, "channel": channel, "replies": reply_count}
