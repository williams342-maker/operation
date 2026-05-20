"""Migrate existing makers into the new tier system.

Idempotent. Safe to re-run.

Rules:
  • williams-cnc → Inaugural Founder + Beta Tester (lifetime, dual badge)
  • Any maker.email == "williams1cnc@gmail.com" or "williams342@gmail.com" → same
  • All seed @craftersmarket.org demo makers → Inaugural Founder
    (lifetime; not a beta tester) — gives the public /founders wall
    something to render until real Founders join.
  • Any other existing makers → tier="standard" (no Founder perks).

Run:
    cd /app/backend && python -m scripts.migrate_makers_to_tier_system
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from motor.motor_asyncio import AsyncIOMotorClient


BETA_TESTER_EMAILS = {
    "williams1cnc@gmail.com",
    "williams342@gmail.com",
}


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    now = datetime.now(timezone.utc).isoformat()

    # Seed/bump the founder_counter so freshly-promoted makers get
    # monotonic numbers. Start at 1 if absent.
    counter_doc = await db.platform_meta.find_one({"key": "founder_counter"})
    if not counter_doc:
        await db.platform_meta.insert_one({"key": "founder_counter", "value": 0})

    promoted = []
    skipped = []
    async for m in db.makers.find({}, {"_id": 0, "slug": 1, "email": 1, "tier": 1}):
        slug = m["slug"]
        email = (m.get("email") or "").lower()
        is_seed = email.endswith("@craftersmarket.org")
        is_beta = email in BETA_TESTER_EMAILS

        # Skip if already migrated and we're not upgrading status.
        if m.get("tier") == "founder":
            skipped.append({"slug": slug, "reason": "already_founder"})
            continue

        # Real beta tester or seed demo → Inaugural Founder.
        if is_beta or is_seed:
            counter = await db.platform_meta.find_one_and_update(
                {"key": "founder_counter"},
                {"$inc": {"value": 1}},
                return_document=True,
            )
            number = int(counter["value"])
            await db.makers.update_one(
                {"slug": slug},
                {"$set": {
                    "tier": "founder",
                    "founder_status": "inaugural",
                    "founder_started_at": now,
                    "founder_expires_at": None,         # lifetime
                    "founder_grace_until": None,        # they're already shipping
                    "founder_number": number,
                    "is_beta_tester": is_beta,
                }},
            )
            promoted.append({
                "slug": slug, "number": number,
                "beta_tester": is_beta, "status": "inaugural",
            })
        else:
            # Everyone else stays standard. Just ensure the field exists
            # so downstream UI doesn't need null checks everywhere.
            await db.makers.update_one(
                {"slug": slug},
                {"$set": {"tier": "standard"}},
            )
            skipped.append({"slug": slug, "reason": "set_standard"})

    print("=== Founder migration complete ===")
    print(f"\nPromoted ({len(promoted)}):")
    for p in promoted:
        badge = "◆ Beta Tester + " if p["beta_tester"] else ""
        print(f"  {badge}◆ Inaugural Founder #{p['number']:03d} · {p['slug']}")
    print(f"\nUntouched / set-standard ({len(skipped)}):")
    for s in skipped:
        print(f"  {s['slug']} ({s['reason']})")

    # Final inaugural cap check
    n_inaug = await db.makers.count_documents({"tier": "founder", "founder_status": "inaugural"})
    print(f"\nInaugural Founders now in DB: {n_inaug} / 100 cap")


if __name__ == "__main__":
    asyncio.run(main())
