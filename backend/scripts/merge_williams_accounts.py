"""iter246 — Merge williams1cnc@gmail.com → williams342@gmail.com (Option A).

Result:
  • maker `williams-cnc` rebound to williams342@gmail.com (Founder · 5 products intact)
  • zombie community_user row for williams1cnc deleted (0 activity tied to it)
  • historical rows (maker_applications, login_attempts, audit_log) point at the new email
  • admin login + ops email unchanged (already williams342)

Usage:
  python3 -m scripts.merge_williams_accounts            # dry-run, shows planned changes
  python3 -m scripts.merge_williams_accounts --commit   # actually writes changes
"""
from __future__ import annotations
import asyncio
import sys
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

import os
from motor.motor_asyncio import AsyncIOMotorClient

OLD_EMAIL = "williams1cnc@gmail.com"
NEW_EMAIL = "williams342@gmail.com"
MAKER_SLUG = "williams-cnc"


async def main(commit: bool):
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    mode = "COMMIT" if commit else "DRY-RUN"
    print(f"=== {mode} · merge {OLD_EMAIL} → {NEW_EMAIL} ===\n")

    # 1) Re-bind the maker shop's contact email
    m_before = await db.makers.find_one({"slug": MAKER_SLUG}, {"_id": 0, "slug": 1, "email": 1, "tier": 1})
    print(f"[1] maker `{MAKER_SLUG}` — current email: {m_before.get('email') if m_before else '(missing)'}")
    print(f"     → rebind to: {NEW_EMAIL}")
    if commit and m_before:
        await db.makers.update_one(
            {"slug": MAKER_SLUG},
            {"$set": {"email": NEW_EMAIL}},
        )

    # 2) Delete the zombie community_user (verified 0 downstream activity)
    cu_old = await db.community_users.find_one({"email": OLD_EMAIL}, {"_id": 0, "user_id": 1, "name": 1})
    print(f"\n[2] community_users row for {OLD_EMAIL}: {cu_old}")
    print(f"     → delete (orphan, 0 activity by user_id)")
    if commit and cu_old:
        await db.community_users.delete_one({"email": OLD_EMAIL})

    # 3) Update historical rows so audit + login trails point at the merged email
    print(f"\n[3] rewriting historical email field across collections:")
    historical = [
        ("maker_applications", "email"),
        ("login_attempts", "email"),
        ("audit_log", "email"),
    ]
    for col, field in historical:
        n = await db[col].count_documents({field: OLD_EMAIL})
        print(f"     {col}.{field}: {n} docs")
        if commit and n:
            await db[col].update_many({field: OLD_EMAIL}, {"$set": {field: NEW_EMAIL}})

    # 4) Verify final state
    print(f"\n[4] post-merge verification:")
    if commit:
        m_after = await db.makers.find_one({"slug": MAKER_SLUG}, {"_id": 0, "slug": 1, "email": 1, "tier": 1})
        cu_old_after = await db.community_users.count_documents({"email": OLD_EMAIL})
        print(f"     makers.{MAKER_SLUG}.email = {m_after.get('email')}")
        print(f"     community_users with {OLD_EMAIL} = {cu_old_after} (should be 0)")
        leftover = 0
        for col, field in historical:
            leftover += await db[col].count_documents({field: OLD_EMAIL})
        print(f"     leftover historical rows still pointing at OLD = {leftover} (should be 0)")

    print(f"\n=== {mode} complete ===")
    if not commit:
        print("Re-run with `--commit` to apply.")
    client.close()


if __name__ == "__main__":
    commit = "--commit" in sys.argv
    asyncio.run(main(commit))
