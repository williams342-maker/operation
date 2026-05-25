"""
Seed additional forum replies so threads don't have the "dead forum"
look — but kept lean and educational per platform direction:

  - Replies attributed to generic maker usernames (SteelCraftFab,
    PlasmaForge, CNCGarage, etc.) — NOT elaborate fake identities,
    not the Workshop Team monologue.
  - 1–4 new replies per thread → final count 5–8 per thread.
  - Short, practical, on-topic. No "this community is amazing" filler,
    no fake emotional stories, no fake arguments.
  - Each reply takes one of five angles: practical answer · different
    experience · helpful follow-up · tool/setting recommendation ·
    beginner engagement.

Generation: Gemini Flash, one LLM call per thread. Idempotent — if a
thread already has 5+ replies, skip. Re-running is safe.

Run with:
    cd /app/backend && python3 seed_forum_replies.py
"""
import asyncio
import json
import os
import random
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
from core import db  # noqa: E402

# 12 generic maker usernames. Not personas — just handles that look like
# normal forum usernames. Same name can appear on multiple threads (that's
# how real forums work).
GENERIC_USERNAMES = [
    "SteelCraftFab", "PlasmaForge", "CNCGarage", "LaserBuilt",
    "WorkshopNorth", "BitsAndBytes", "ShopFloor47", "MidwestMaker",
    "ChipBreaker", "GarageCNC", "BackshedBuilds", "TabsAndBridges",
]

# Five angles each reply can take. Drives the LLM prompt so we get
# variety per thread instead of five "great point!" filler replies.
REPLY_ANGLES = [
    "practical answer with a specific technique or setting",
    "different experience or alternative approach the OP didn't mention",
    "helpful follow-up question that pushes the discussion forward",
    "tool, supplier, or feed/speed recommendation with reasoning",
    "honest beginner perspective that admits a knowledge gap",
]


async def _generate_replies_for_thread(thread, existing_count) -> list:
    """Ask Gemini Flash for 3–4 short replies tailored to this thread.

    Returns a list of dicts with `username`, `body`. Returns [] on any
    failure so we never crash the seed run.
    """
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        print(f"  [WARN] emergentintegrations unavailable ({e})")
        return []

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        print("  [WARN] EMERGENT_LLM_KEY missing — skipping LLM gen")
        return []

    # Aim for 5–8 total. We already have `existing_count`; ask for the gap.
    target_total = random.randint(6, 8)
    need = max(3, target_total - existing_count)
    need = min(need, 4)  # never more than 4 to keep cost predictable

    chosen_angles = random.sample(REPLY_ANGLES, k=min(need, len(REPLY_ANGLES)))
    angles_block = "\n".join(f"  {i+1}. {a}" for i, a in enumerate(chosen_angles))

    prompt = f"""You're generating realistic forum replies for an artisan CNC/maker marketplace community forum. The thread title and body are below. Generate exactly {need} short, practical replies — each one a different person responding helpfully.

THREAD TITLE: {thread.get('title', '')}
THREAD BODY: {(thread.get('body') or '')[:600]}
CHANNEL: {thread.get('tag') or thread.get('channel') or 'general'}

RULES:
- Each reply 1–4 sentences, max ~80 words.
- Specific, technical, useful — like real maker forum advice (mention amps, feed rates, brands, materials, tooling when relevant).
- NO "great post!" / "thanks for sharing!" / "this community is amazing" filler.
- NO emotional stories, NO fake customer anecdotes longer than one sentence.
- NO fake usernames or quoting other commenters.
- Sound like a real working maker — slightly casual, plain language, no marketing voice.
- Each reply should take a different angle from this list:
{angles_block}

Return ONLY valid JSON, no markdown, no commentary. Schema:
{{"replies": [{{"body": "reply text here"}}, ...]}}"""

    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"forum-reply-{thread['id'][:8]}",
            system_message="You generate authentic, specific, helpful forum replies for a CNC/artisan maker community. Output strict JSON only.",
        )
        .with_model("gemini", "gemini-3-flash-preview")
    )

    try:
        text = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        print(f"  [WARN] LLM call failed: {e}")
        return []

    # Strip ```json fences if the model added them despite instructions.
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    try:
        data = json.loads(cleaned)
    except Exception:
        # Extract the first {...} block as a fallback
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not m:
            print(f"  [WARN] non-JSON response, skipping. First 120 chars: {cleaned[:120]}")
            return []
        try:
            data = json.loads(m.group(0))
        except Exception:
            print("  [WARN] still non-JSON, skipping")
            return []

    replies = data.get("replies", []) or []
    out = []
    used_users = set()
    pool = GENERIC_USERNAMES.copy()
    random.shuffle(pool)
    for r in replies[:need]:
        body = (r.get("body") or "").strip()
        if len(body) < 20:
            continue
        # Pick a username not already used on this thread for visual variety
        username = next((u for u in pool if u not in used_users), random.choice(GENERIC_USERNAMES))
        used_users.add(username)
        out.append({"username": username, "body": body})
    return out


async def seed_replies():
    threads = await db.forum_threads.find({}, {"_id": 0}).to_list(500)
    print(f"=== {len(threads)} threads to process ===\n")

    added = 0
    skipped = 0
    for t in threads:
        existing = await db.forum_replies.count_documents({"thread_id": t["id"]})
        if existing >= 5:
            skipped += 1
            print(f"  SKIP {t['title'][:60]}… (already has {existing} replies)")
            continue

        print(f"  → {t['title'][:70]}… (have {existing}, generating more)")
        replies = await _generate_replies_for_thread(t, existing)
        if not replies:
            print("    no replies generated, moving on")
            continue

        # Sprinkle the new replies across the next 2–10 days after the
        # most recent existing reply so the timeline looks natural.
        latest = await db.forum_replies.find_one(
            {"thread_id": t["id"]}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)],
        )
        try:
            base_ts = datetime.fromisoformat((latest or {}).get("created_at", "").replace("Z", "+00:00"))
        except Exception:
            base_ts = datetime.now(timezone.utc) - timedelta(days=7)
        if base_ts.tzinfo is None:
            base_ts = base_ts.replace(tzinfo=timezone.utc)

        for i, r in enumerate(replies):
            offset_hours = random.randint(8, 72) * (i + 1)
            ts = base_ts + timedelta(hours=offset_hours)
            doc = {
                "id": str(uuid.uuid4()),
                "thread_id": t["id"],
                "user_id": f"seed-{r['username'].lower()}",
                "user_email": f"{r['username'].lower()}@craftersmarket.org",
                "user_name": r["username"],
                "body": r["body"],
                "attachments": [],
                "created_at": ts.isoformat(),
                "is_seed": True,
                "seed_order": 100 + i,
                "ai_mod_action": "allow",
                "ai_mod_reason": "seeded_by_system",
            }
            await db.forum_replies.insert_one(doc)
            added += 1
            print(f"    + {r['username']}: {r['body'][:80]}…")

        # Bump the thread's last_activity_at if the schema tracks it
        last_ts = (base_ts + timedelta(hours=random.randint(72, 240))).isoformat()
        await db.forum_threads.update_one(
            {"id": t["id"]},
            {"$set": {"last_activity_at": last_ts}, "$inc": {"reply_count": len(replies)}},
        )

    print(f"\n=== Done. Added {added} replies across {len(threads) - skipped} threads. Skipped {skipped}. ===")


if __name__ == "__main__":
    asyncio.run(seed_replies())
