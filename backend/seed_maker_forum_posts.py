"""Seed maker-attributed forum threads — one per founding maker.

iter230 — Per the user's brief, each of the 10 founding makers has
specialty forum topics they'd realistically post in. This seeder
creates exactly that: 10 threads, each authored by one founding maker
who's asking a question from their wheelhouse. Then cross-maker
replies — when Cascade asks about powder coat re-cure temps, NorthForge
(commercial fab) and Hill Country (also runs a powder booth) reply with
their experience. That cross-pollination is what makes the forum read
like a working community rather than a Q&A board.

Idempotent: re-runs skip seeded threads (matched on seed_key, never
title — admins can rename). Re-runs also skip making duplicate
community_users for makers that already have one.

Run with:
    cd /app/backend && python3 seed_maker_forum_posts.py
"""
import asyncio
import json
import os
import random
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
from core import db, now_iso  # noqa: E402


# Each entry binds a maker to (a) ONE thread they'd realistically post,
# from their specialty wheelhouse and (b) the slugs of 2 OTHER makers who
# should reply (chosen for overlapping expertise — that's the "ecosystem
# connection" the user's brief called out).
#
# Categories use the existing FORUM_CATEGORIES (defined in
# routers/community_forum.py): machine-help, techniques, finishing,
# resources, show-tell, general.
MAKER_THREADS = [
    # ── Cascade Iron Works (plasma + powder coat) ──────────────────────
    {
        "maker_slug": "cascade-iron-works",
        "seed_key": "maker-cascade-powder-recure-temp",
        "category": "finishing",
        "title": "Powder coat re-cure temps for parts pulled too early — what's your real ceiling?",
        "body": (
            "We had a batch of 14ga steel panels come out of the booth and "
            "go to packaging before someone realized the cure timer hadn't "
            "reset properly. They were soft to the fingernail test. "
            "Manufacturer says 400°F for 20 minutes is the recipe — but "
            "what's your actual ceiling for a re-cure without yellowing "
            "the matte black? I've heard 425 for 10, but I'm nervous "
            "about the topcoat shift. Has anyone pushed it and lived?"
        ),
        "reply_from_makers": ["northforge-customs", "hill-country-forge"],
    },
    # ── Hill Country Forge (laser signs + hand patina) ─────────────────
    {
        "maker_slug": "hill-country-forge",
        "seed_key": "maker-hillcountry-patina-consistency",
        "category": "finishing",
        "title": "Hand-rubbed patina on powder coat — how do you keep batch-to-batch consistency?",
        "body": (
            "We hand-rub our matte black powder coat with a steel-wool + "
            "tinted-wax process to get the weathered look on our farmhouse "
            "name signs. Customers love the depth, but reorders are the "
            "problem — match a 6-month-old sign and someone notices the "
            "rub direction. What's your photography reference protocol? "
            "Do you keep a stepped 'patina sample card' that travels with "
            "the order, or just trust the rubbing motion?"
        ),
        "reply_from_makers": ["cascade-iron-works", "emberline-metalworks"],
    },
    # ── Appalachian Steel & Slab (epoxy + walnut) ──────────────────────
    {
        "maker_slug": "appalachian-steel-slab",
        "seed_key": "maker-appalachian-epoxy-degas-bubbles",
        "category": "techniques",
        "title": "Pigmented epoxy river pours — pressure-pot or torch-only for degassing?",
        "body": (
            "Doing 1.5\" deep river pours through black walnut slabs with "
            "pigmented epoxy. Even after 24h dwell I'm getting micro-"
            "bubbles trapped in the bottom third of the pour, especially "
            "where the epoxy meets a rough live-edge contour. I've tried "
            "preheating the slab + a propane torch crawl during the pour, "
            "but the deep bubbles still appear. Anyone here jumped to a "
            "pressure pot for the cure and seen a real difference? Worth "
            "the equipment cost?"
        ),
        "reply_from_makers": ["forge-and-grain", "redwood-cnc-collective"],
    },
    # ── Great Lakes Fabworks (industrial fab + brackets) ───────────────
    {
        "maker_slug": "great-lakes-fabworks",
        "seed_key": "maker-greatlakes-laser-air-assist-pressure",
        "category": "machine-help",
        "title": "6kW fiber laser — air assist pressure for 3/16\" steel brackets, what's your sweet spot?",
        "body": (
            "We run a 6kW fiber on a lot of structural bracket sets in "
            "3/16\" cold-rolled. Standard nitrogen at 250 PSI gives us "
            "clean cuts but our gas burn is killing margin on the "
            "high-volume jobs. Dropped to 180 PSI on a test set — edge "
            "finish was acceptable but I'm worried about long-term "
            "consumable wear on the nozzle. Where's everyone landing on "
            "the PSI-vs-consumable-life curve?"
        ),
        "reply_from_makers": ["blackriver-laserworks", "northforge-customs"],
    },
    # ── BlackRiver Laserworks (CO2 + fiber engraving) ──────────────────
    {
        "maker_slug": "blackriver-laserworks",
        "seed_key": "maker-blackriver-walnut-engrave-depth",
        "category": "techniques",
        "title": "Deep engraving on walnut — power/speed/passes for that hand-carved feel?",
        "body": (
            "100W CO2 on figured walnut. I'm trying to hit ~0.040\" "
            "engraving depth so the text feels carved-in under the finger, "
            "not just darkened on the surface. Single pass at 30% speed / "
            "85% power leaves char I have to hand-sand out. Two-pass at "
            "lower power gets cleaner but the depth varies with the grain "
            "density. Anyone here doing multi-pass with a vector-fill on "
            "the first pass and a bitmap raster on the second?"
        ),
        "reply_from_makers": ["redwood-cnc-collective", "appalachian-steel-slab"],
    },
    # ── Emberline Metalworks (layered wildlife steel art) ──────────────
    {
        "maker_slug": "emberline-metalworks",
        "seed_key": "maker-emberline-multilayer-standoff-spacing",
        "category": "techniques",
        "title": "Multi-layer wall panels — what's your standoff spacing formula for the depth illusion?",
        "body": (
            "Building 3-4 layer wildlife scenes. The depth illusion "
            "works at gallery distance but feels flat once a buyer "
            "leans in. I've been using 3/4\" standoffs between every "
            "layer. Curious if anyone runs variable spacing — wider "
            "between the front 2 layers and tighter to the back — to "
            "give a more atmospheric falloff? Or is that overthinking "
            "what should be 1/2\" - 3/4\" - 1\" by feel?"
        ),
        "reply_from_makers": ["cascade-iron-works", "copperedge-makers"],
    },
    # ── NorthForge Customs (commercial signage + ranch entrances) ──────
    {
        "maker_slug": "northforge-customs",
        "seed_key": "maker-northforge-cor-ten-cure-time",
        "category": "finishing",
        "title": "Cor-Ten rust patina — accelerating the cure for a 60-day-out install?",
        "body": (
            "Customer needs their ranch entrance arch installed in 6 "
            "weeks. Natural Cor-Ten cure to a stable patina is closer to "
            "60-90 days outdoors. I've heard makers spraying a saltwater "
            "+ vinegar bath to force the initial bloom, then sealing "
            "after 7 days. Anyone done this in production and had the "
            "rust hold consistent vs naturally-aged work? Don't want to "
            "deliver something that looks two-tone in a year."
        ),
        "reply_from_makers": ["cascade-iron-works", "great-lakes-fabworks"],
    },
    # ── Redwood CNC Collective (artistic CNC carving) ──────────────────
    {
        "maker_slug": "redwood-cnc-collective",
        "seed_key": "maker-redwood-stepover-figured-maple",
        "category": "techniques",
        "title": "Stepover for finishing pass on figured western maple — how tight is too tight?",
        "body": (
            "We're holding 1/32\" stepover on topographic relief panels in "
            "figured maple. Surface finish is glass-smooth but a 24×18 "
            "panel takes 11 hours on the table. Has anyone gone tighter "
            "(0.015\" or less) and seen a measurable jump in finish "
            "quality, or are we already past the point of diminishing "
            "returns at 1/32\"? Curious if there's a hand-sanding step "
            "that bridges the gap between 1/16\" and 1/32\" without "
            "burning machine time."
        ),
        "reply_from_makers": ["appalachian-steel-slab", "forge-and-grain"],
    },
    # ── CopperEdge Makers (premium architectural metal) ────────────────
    {
        "maker_slug": "copperedge-makers",
        "seed_key": "maker-copperedge-brass-fingerprint-protection",
        "category": "finishing",
        "title": "Brushed brass installs — what's your fingerprint-protection sealer that doesn't yellow?",
        "body": (
            "Brass sunburst pieces look incredible the day they install. "
            "Two weeks of hospitality traffic later, every guest has "
            "touched them and we're getting service tickets for "
            "fingerprint haze. Lacquers are easy but they yellow under "
            "warm interior lighting within a year. I've heard of ProtectaClear "
            "and Everbrite Coatings — anyone running these in commercial "
            "installs and seen real 3-year wear?"
        ),
        "reply_from_makers": ["emberline-metalworks", "northforge-customs"],
    },
    # ── Forge & Grain Workshop (wood + steel hybrid) ───────────────────
    {
        "maker_slug": "forge-and-grain",
        "seed_key": "maker-forgegrain-steel-wood-joint-seasoning",
        "category": "techniques",
        "title": "Wood-to-steel joints — how do you handle the seasonal movement at the seam?",
        "body": (
            "We thru-bolt steel hairpin legs into thick walnut slabs. "
            "Six months in, customers are seeing the slab cup very "
            "slightly around the bolt locations as the wood seasons. "
            "Steel doesn't move; wood does. Are you running slotted "
            "holes in the steel side to let the slab breathe? "
            "Threaded inserts with washers? Or is the answer fully "
            "sealing the slab before assembly and pretending it won't "
            "move?"
        ),
        "reply_from_makers": ["appalachian-steel-slab", "redwood-cnc-collective"],
    },
]


# ════════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════════
async def _ensure_maker_community_user(maker: dict) -> dict:
    """Get-or-create a community_users row tied to this maker. Allows
    the maker to author forum content without re-authentication. The
    `is_maker_team` flag is cosmetic — drives any future "verified
    maker" badge in the forum UI."""
    email = maker.get("email") or f"{maker['slug']}@craftersmarket.org"
    existing = await db.community_users.find_one({"email": email}, {"_id": 0})
    if existing:
        return existing
    user = {
        "user_id": str(uuid.uuid4()),
        "email": email,
        "name": maker.get("name") or maker["slug"],
        "auth_provider": "system_seed_maker",
        "created_at": now_iso(),
        "is_maker_team": True,
        "linked_maker_slug": maker["slug"],
    }
    await db.community_users.insert_one(user)
    user.pop("_id", None)
    return user


async def _generate_replies(thread: dict, replier_makers: list[dict]) -> list[dict]:
    """Ask Gemini for one short reply per replier maker. Each reply
    written in that maker's voice (their specialty + region) so the
    cross-pollination feels real, not random."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        print(f"  [WARN] emergentintegrations unavailable ({e})")
        return []

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        print("  [WARN] EMERGENT_LLM_KEY missing")
        return []

    out = []
    for replier in replier_makers:
        prompt = f"""You are writing ONE forum reply from a specific maker to another maker's question on a CNC/artisan marketplace forum.

THE THREAD (asked by another maker):
TITLE: {thread['title']}
BODY: {thread['body']}

YOU ARE:
- Name: {replier['name']}
- Region: {replier.get('location', '—')}
- Specialty: {', '.join(replier.get('techniques') or [])}
- Machinery: {', '.join(replier.get('machinery') or [])}
- Years in craft: {replier.get('years_crafting') or 'several'}
- Voice cue (one short maker bio for tone): {(replier.get('bio') or '')[:200]}

WRITE ONE REPLY that:
- 2-4 sentences, max 90 words
- Specific and useful — share a real number, temperature, brand, technique, or experience
- First-person ("we") — you're a working shop, not a guru
- Reference YOUR OWN machinery, region, or specialty naturally if it fits — but don't force it
- Don't quote the OP. Don't say "great question." Don't introduce yourself.
- Don't use exclamation marks or emoji
- Plain language. Sounds like a working maker, not a brochure.

OUTPUT: just the reply body. No quotes. No headers."""

        chat = (
            LlmChat(
                api_key=api_key,
                session_id=f"maker-reply-{replier['slug']}-{uuid.uuid4().hex[:8]}",
                system_message=(
                    "You write authentic, specific, first-person-plural forum "
                    "replies in the voice of a small artisan shop. 2-4 sentences. "
                    "No marketing speak. No emoji."
                ),
            )
            .with_model("gemini", "gemini-3-flash-preview")
        )
        try:
            text = await chat.send_message(UserMessage(text=prompt))
        except Exception as e:
            print(f"    [WARN] reply gen failed for {replier['slug']}: {e}")
            continue
        # Clean: strip quotes, markdown leftovers
        cleaned = (text or "").strip().strip('"').strip("'").strip()
        # Strip any leading "Here's our take:" preambles the model sometimes adds
        for lead in ("Here's our take:", "Here is our reply:", "Reply:"):
            if cleaned.lower().startswith(lead.lower()):
                cleaned = cleaned[len(lead):].strip()
        if len(cleaned) >= 30:
            out.append({"maker": replier, "body": cleaned})
    return out


async def seed():
    print(f"\n════ Maker forum seeder · {len(MAKER_THREADS)} threads ════\n")
    # Preload all 10 makers in one pass
    all_slugs = set()
    for t in MAKER_THREADS:
        all_slugs.add(t["maker_slug"])
        for s in t["reply_from_makers"]:
            all_slugs.add(s)
    makers_by_slug = {
        m["slug"]: m
        async for m in db.makers.find({"slug": {"$in": list(all_slugs)}}, {"_id": 0})
    }

    base_time = datetime.now(timezone.utc) - timedelta(days=6)

    threads_inserted = 0
    threads_skipped = 0
    replies_inserted = 0

    for idx, t in enumerate(MAKER_THREADS):
        author = makers_by_slug.get(t["maker_slug"])
        if not author:
            print(f"  ✗ {t['seed_key']}: maker {t['maker_slug']} not found, skipping")
            continue

        existing = await db.forum_threads.find_one(
            {"seed_key": t["seed_key"]}, {"_id": 0, "id": 1},
        )
        if existing:
            threads_skipped += 1
            print(f"  → {t['seed_key']}: thread already exists, skipping")
            continue

        author_user = await _ensure_maker_community_user(author)
        thread_ts = (base_time + timedelta(hours=idx * 11)).isoformat()
        thread_doc = {
            "id": str(uuid.uuid4()),
            "user_id": author_user["user_id"],
            "user_email": author_user["email"],
            "user_name": author_user["name"],
            "linked_maker_slug": author["slug"],   # exposes the shop on the post
            "title": t["title"],
            "body": t["body"],
            "category": t["category"],
            "attachments": [],
            "tag": t["category"],
            "reply_count": 0,
            "created_at": thread_ts,
            "seed_key": t["seed_key"],
            "is_seed": True,
            "ai_mod_action": "allow",
            "ai_mod_reason": "seeded_by_system",
        }
        await db.forum_threads.insert_one(thread_doc)
        threads_inserted += 1
        print(f"  ✓ thread: {t['seed_key']} (by {author['name']})")

        # Replies
        repliers = [makers_by_slug.get(s) for s in t["reply_from_makers"]]
        repliers = [r for r in repliers if r]
        replies = await _generate_replies(thread_doc, repliers)
        for r_idx, r in enumerate(replies):
            replier_user = await _ensure_maker_community_user(r["maker"])
            reply_ts = (
                datetime.fromisoformat(thread_ts) + timedelta(hours=4 + r_idx * 9)
            ).isoformat()
            reply_doc = {
                "id": str(uuid.uuid4()),
                "thread_id": thread_doc["id"],
                "user_id": replier_user["user_id"],
                "user_email": replier_user["email"],
                "user_name": replier_user["name"],
                "linked_maker_slug": r["maker"]["slug"],
                "body": r["body"],
                "attachments": [],
                "created_at": reply_ts,
                "is_seed": True,
                "seed_order": 200 + r_idx,
                "ai_mod_action": "allow",
                "ai_mod_reason": "seeded_by_system",
            }
            await db.forum_replies.insert_one(reply_doc)
            replies_inserted += 1
            preview = r["body"][:75] + ("…" if len(r["body"]) > 75 else "")
            print(f"      + reply by {r['maker']['name']}: {preview}")

        # Bump the thread's reply_count + last_activity_at
        last_activity = (
            datetime.fromisoformat(thread_ts) + timedelta(hours=4 + len(replies) * 9)
        ).isoformat()
        await db.forum_threads.update_one(
            {"id": thread_doc["id"]},
            {"$set": {"last_activity_at": last_activity, "reply_count": len(replies)}},
        )

    print(
        f"\n✓ Done. {threads_inserted} threads inserted, {threads_skipped} skipped, "
        f"{replies_inserted} cross-maker replies."
    )


if __name__ == "__main__":
    asyncio.run(seed())
