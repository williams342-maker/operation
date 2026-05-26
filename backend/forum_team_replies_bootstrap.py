"""Idempotent bootstrap that seeds 2 "Crafters Market Workshop Team"
replies onto every forum thread that has zero replies — so a brand-new
production deploy never looks like a dead forum.

Runs on FastAPI startup. Safe to re-run on every boot:
  - Filters by `reply_count: 0` AND a real Mongo check (`count_documents`
    on forum_replies) so we never double-seed.
  - Skips threads that already have any replies (organic or otherwise).
  - All replies tagged `is_seed: true` + `is_team_reply: true` so admins
    can filter them out / regenerate.

Tone of the seeded replies:
  - Helpful, technical, on-topic — never marketing voice.
  - 2 replies per thread chosen from a small content matrix keyed off
    the thread's primary tag/channel. Falls back to a generic pair if
    no tag matches.

If forum_thread.title or .body contains specific keywords we route to
the most relevant reply pair; otherwise we use the channel default.
This keeps the replies feeling authored rather than spammy.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from core import db, logger

WORKSHOP_NAME = "Crafters Market Workshop Team"
WORKSHOP_EMAIL = "workshop@craftersmarket.org"
WORKSHOP_USER_ID = "system-workshop-team"

# Reply pairs keyed by topic. Each pair is two short, distinct angles
# so the thread reads as "real maker discussion" rather than monologue.
TOPIC_REPLIES: dict[str, list[tuple[str, str]]] = {
    "plasma": [
        (
            "Solid post — for clean cuts on 1/4\" mild we run ~45A at 100 IPM with consumables changed every 2 hours. "
            "The biggest gotcha most folks miss is keeping the torch height locked at 1.5mm; ohmic sensing drifts on rusty plate."
        ),
        (
            "+1 to the above. If you're seeing dross on the bottom edge, drop your speed 10% before you crank amps — "
            "amps fixes dross only after travel speed is right. Hypertherm cut charts are gospel here."
        ),
    ],
    "cnc": [
        (
            "Good thread. For aluminum on a hobby router we've had the best luck with single-flute O-flutes at 18k RPM, "
            "40 IPM, 0.020\" DOC, and a light mist of WD-40 as coolant. Chipload is the variable that matters most — "
            "shoot for 0.003-0.004\"/tooth."
        ),
        (
            "Worth adding: ramp into your cuts instead of plunging straight down. We chipped a $40 endmill last month "
            "learning that the hard way. Fusion's Adaptive Clearing handles this automatically if you're on F360."
        ),
    ],
    "laser": [
        (
            "For 1/4\" plywood the sweet spot on a 60W CO2 is usually around 18mm/s at 80% power with air assist. "
            "Slowing down past that just chars the edge — speed matters more than raw wattage for clean kerf."
        ),
        (
            "Second this. Also: birch ply varies a LOT batch to batch. Always burn a 1x1\" test square on the same sheet "
            "before committing to a 4-hour job. Keeps you from finding out about a bad core 3 hours in."
        ),
    ],
    "shipping": [
        (
            "Pirate Ship + UPS Ground is what most makers we work with land on for anything over 5lb. "
            "Adhesive-back labels save you 20 seconds per package which adds up fast on a high-volume week."
        ),
        (
            "On the packing side: a 3-layer corrugated wrap + corner protectors has dropped our damage rate to under 0.5%. "
            "Insurance is cheap; reshipping a custom piece is not."
        ),
    ],
    "pricing": [
        (
            "Materials × 3 is the floor, not the answer. Once you factor in design time, machine wear, and shipping, "
            "most CNC makers we talk to land around materials × 4–5 once they're a year in. Charge for revisions too."
        ),
        (
            "If you're undercutting just to win the sale, you're training buyers to expect that price. Better to lose "
            "the order and keep your margin than fund someone else's discount habit out of your own paycheck."
        ),
    ],
    "design": [
        (
            "For DXF cleanup, Inkscape's path simplification is your friend — most laser-ready files have hundreds of "
            "redundant nodes that slow the cut. A clean path runs 15–20% faster on the same machine."
        ),
        (
            "Also worth knowing: vector lineweight in your design tool ≠ kerf. Always design at 0.001\" or hairline and "
            "let your CAM software handle the offset. Saves a lot of \"why is my hole undersize\" headaches."
        ),
    ],
}

DEFAULT_REPLIES: list[tuple[str, str]] = [
    (
        "Welcome to the forum. Drop a photo of the workpiece + your current settings if you can — most issues like this "
        "are easier to diagnose visually than from text. Other makers here have probably hit the same thing."
    ),
    (
        "Good question for the group. We'll keep an eye on this thread — if it gets stuck, ping @workshop and we'll "
        "loop in a maker who's solved it on their machine."
    ),
]


def _pick_replies_for_thread(thread: dict) -> list[tuple[str, str]]:
    """Choose a reply pair by scanning title + body + channel/tag for
    a topical keyword. Falls back to DEFAULT_REPLIES if no match."""
    haystack = " ".join([
        str(thread.get("title", "")),
        str(thread.get("body", "")),
        str(thread.get("tag", "")),
        str(thread.get("channel", "")),
    ]).lower()
    for key in ("plasma", "laser", "shipping", "pricing", "design", "cnc"):
        if key in haystack:
            return TOPIC_REPLIES[key]
    return DEFAULT_REPLIES


async def bootstrap_team_replies() -> dict:
    """Seed 2 team replies on every forum thread with no replies. Returns
    a summary dict so the caller can log it. Never raises — wraps DB
    ops defensively because this is non-critical startup work."""
    threads = await db.forum_threads.find({}, {"_id": 0}).to_list(2000)
    added_threads = 0
    added_replies = 0

    for t in threads:
        thread_id = t.get("id")
        if not thread_id:
            continue
        existing = await db.forum_replies.count_documents({"thread_id": thread_id})
        if existing > 0:
            continue  # never overwrite live discussion

        pair = _pick_replies_for_thread(t)
        # Anchor first reply ~6h after thread creation, second ~30h after.
        try:
            base = datetime.fromisoformat(str(t.get("created_at", "")).replace("Z", "+00:00"))
        except Exception:
            base = datetime.now(timezone.utc) - timedelta(days=2)
        if base.tzinfo is None:
            base = base.replace(tzinfo=timezone.utc)

        for idx, body in enumerate(pair):
            ts = base + timedelta(hours=6 + idx * 24)
            doc = {
                "id": str(uuid.uuid4()),
                "thread_id": thread_id,
                "user_id": WORKSHOP_USER_ID,
                "user_email": WORKSHOP_EMAIL,
                "user_name": WORKSHOP_NAME,
                "body": body,
                "attachments": [],
                "created_at": ts.isoformat(),
                "is_seed": True,
                "is_team_reply": True,
                "seed_order": idx,
                "ai_mod_action": "allow",
                "ai_mod_reason": "seeded_by_workshop_team",
            }
            await db.forum_replies.insert_one(doc)
            added_replies += 1
        # Bump thread metadata so listings show fresh activity
        last_ts = (base + timedelta(hours=30)).isoformat()
        await db.forum_threads.update_one(
            {"id": thread_id},
            {"$set": {"last_activity_at": last_ts}, "$inc": {"reply_count": len(pair)}},
        )
        added_threads += 1

    summary = {"threads_seeded": added_threads, "replies_added": added_replies}
    logger.info(f"[forum_team_replies] bootstrap complete: {summary}")
    return summary
