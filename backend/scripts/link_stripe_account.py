"""One-time helper to link a manually-created Stripe Connect account
to an existing maker row. Use when the operator created the Stripe
Connect account directly in the Stripe dashboard (instead of via our
`/api/maker/stripe/connect/onboard` endpoint) — the account ID won't
be on the maker row until we stamp it here.

After stamping, we call the same `_refresh_status` helper the live
onboarding endpoint uses, so `stripe_charges_enabled`,
`stripe_payouts_enabled`, and `stripe_details_submitted` get pulled
straight from Stripe in one round-trip.

Usage:
    cd /app/backend
    python scripts/link_stripe_account.py <maker_slug> <acct_id>

Example:
    python scripts/link_stripe_account.py williams-cnc acct_1TbWz7IqTcQYhwFc
"""
import asyncio
import sys
from pathlib import Path

# make sibling `backend/*.py` modules importable when run as a script
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from core import db, logger  # noqa: E402
from routers.stripe_connect import _refresh_status  # noqa: E402


async def link(slug: str, account_id: str) -> None:
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not maker:
        print(f"FAIL: no maker with slug={slug!r}")
        sys.exit(2)

    existing = maker.get("stripe_account_id")
    if existing and existing != account_id:
        print(f"WARN: maker {slug!r} already has stripe_account_id={existing!r}")
        ans = input(f"Overwrite with {account_id!r}? [y/N] ").strip().lower()
        if ans != "y":
            print("Aborted.")
            sys.exit(1)

    # _refresh_status writes stripe_account_id + the three boolean flags
    # in a single $set, pulling the truth from Stripe via Account.retrieve.
    try:
        update = await _refresh_status(slug, account_id)
    except Exception as e:
        print(f"FAIL: Stripe API error while retrieving {account_id!r}: {e}")
        sys.exit(3)

    print("✓ Linked.")
    print(f"  slug                    = {slug}")
    print(f"  stripe_account_id       = {account_id}")
    print(f"  charges_enabled         = {update['stripe_charges_enabled']}")
    print(f"  payouts_enabled         = {update['stripe_payouts_enabled']}")
    print(f"  details_submitted       = {update['stripe_details_submitted']}")

    if not update["stripe_details_submitted"]:
        print("\n⚠ Stripe says onboarding is NOT yet complete for this account.")
        print("  Finish the Stripe-hosted flow, then the webhook (or a re-run)")
        print("  will flip these flags to true automatically.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(64)
    asyncio.run(link(sys.argv[1], sys.argv[2]))
