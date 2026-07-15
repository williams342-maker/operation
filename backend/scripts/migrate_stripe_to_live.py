"""Stripe LIVE-mode migration script (one-shot).

Run this AFTER updating STRIPE_API_KEY (and the two webhook secrets) to
their `sk_live_...` / `whsec_...` live values, but BEFORE the first real
buyer hits checkout.

What it does:
    1. Clears the cached test-mode Crafters Plus product/price from
       `db.platform_meta` so the next subscription auto-creates fresh
       live-mode equivalents.
    2. Wipes test-mode `stripe_customer_id` and `stripe_account_id` from
       every maker so they re-onboard cleanly into live Connect.
    3. Wipes test-mode `subscription_status` flags so makers re-subscribe
       in live mode.
    4. Logs a summary of what was cleared.

Idempotent. Safe to run multiple times. No-op if STRIPE_API_KEY isn't a
live key (refuses to run against a test-mode environment).

Usage:
    cd /app/backend && python -m scripts.migrate_stripe_to_live
"""
from __future__ import annotations

import asyncio
import os

from config import settings
import sys

# Ensure /app/backend is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from motor.motor_asyncio import AsyncIOMotorClient


async def main():
    api_key = settings.stripe_api_key
    if not api_key.startswith("sk_live_"):
        print(f"❌ Refusing to run — STRIPE_API_KEY is not a live key (prefix={api_key[:8]!r}).")
        print("   Update STRIPE_API_KEY=sk_live_... in your .env first, then re-run.")
        sys.exit(1)

    client = AsyncIOMotorClient(settings.mongo_url)
    db = client[settings.db_name]

    print(f"🔐 Stripe mode confirmed LIVE — proceeding with migration.\n")

    # 1. Clear cached Plus product/price
    res = await db.platform_meta.delete_one({"key": "plus_subscription"})
    print(f"  platform_meta.plus_subscription cleared: {res.deleted_count}")

    # 2. Wipe test-mode customer + Connect IDs from makers
    res = await db.makers.update_many(
        {"$or": [
            {"stripe_customer_id": {"$exists": True}},
            {"stripe_account_id": {"$exists": True}},
            {"stripe_subscription_id": {"$exists": True}},
            {"subscription_status": {"$exists": True}},
        ]},
        {"$unset": {
            "stripe_customer_id": "",
            "stripe_account_id": "",
            "stripe_account_ready": "",
            "stripe_subscription_id": "",
            "subscription_status": "",
            "subscription_current_period_end": "",
        }},
    )
    print(f"  makers stripe fields cleared: {res.modified_count}")

    # 3. Wipe any cached webhook-secret rotation overrides (test-mode signatures
    #    won't match live-mode events anyway)
    if "stripe_webhook_secrets" in await db.list_collection_names():
        res = await db.stripe_webhook_secrets.delete_many({})
        print(f"  stripe_webhook_secrets cleared: {res.deleted_count}")

    # 4. Optional: clear pending payouts that were calculated on test-mode amounts
    #    (these would never settle anyway since test transfers don't exist in live)
    if "maker_payouts" in await db.list_collection_names():
        res = await db.maker_payouts.delete_many({"status": "pending"})
        print(f"  pending maker_payouts cleared: {res.deleted_count}")

    print(f"\n✅ Migration complete. Live mode is ready.")
    print(f"   Next: restart the backend so STRIPE_API_KEY is reloaded:")
    print(f"     sudo supervisorctl restart backend")
    print(f"   Then verify the boot log shows: [stripe] mode=LIVE")


if __name__ == "__main__":
    asyncio.run(main())
