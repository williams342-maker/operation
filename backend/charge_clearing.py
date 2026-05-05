"""Monthly invoice-based clearing of maker ledger balances.

Problem this solves
-------------------
Listing fees ($0.20/listing past quota) and promoted-listing fees ($5/wk)
accrue to `maker.pending_charges_cents` and are normally drained from the
next Stripe Connect transfer (netted out of a sale payout). But makers who
post listings without making sales accumulate an ever-growing balance that
never gets collected.

For Crafters Plus subscribers we already have a saved Stripe Customer (+ card
on file), so once a month we can bill those accrued charges directly via a
one-off Stripe Invoice. Non-Plus makers are skipped — their balance keeps
draining sale-by-sale.

Flow per maker
--------------
1. Find `stripe_customer_id` + pending balance.
2. Create an InvoiceItem on the customer with amount = pending_charges_cents.
3. Create an Invoice (auto-advance=true) so Stripe immediately finalises +
   charges the card on file.
4. Mark `pending_charges_cents = 0` and log to `charge_history`. Stripe's
   `invoice.payment_succeeded` webhook double-confirms the charge landed;
   failures surface via `invoice.payment_failed` (future work — currently
   we rely on Stripe's built-in dunning/retry sequence).

Idempotency: we stamp the Invoice with `metadata.kind = "charge_clearing"` +
`metadata.charge_clearing_batch = YYYY-MM` and guard re-runs by checking
whether a charge-clearing entry already exists in `charge_history` for the
current batch.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import stripe as stripe_sdk

from core import STRIPE_API_KEY, db, logger, now_iso

# Skip ledger balances below this threshold — not worth the $0.30 Stripe
# per-invoice fee. Default $1.00. Set to 0 to always clear.
MIN_CLEAR_CENTS = int(os.environ.get("CHARGE_CLEARING_MIN_CENTS", "100"))


def _batch_key() -> str:
    n = datetime.now(timezone.utc)
    return f"{n.year:04d}-{n.month:02d}"


async def _already_cleared(slug: str, batch: str) -> bool:
    doc = await db.makers.find_one(
        {"slug": slug},
        {"_id": 0, "charge_history": 1},
    )
    for entry in (doc or {}).get("charge_history", []) or []:
        if entry.get("kind") == "charge_clearing" and entry.get("batch") == batch:
            return True
    return False


async def clear_plus_ledger_balances(apply: bool = True) -> dict[str, Any]:
    """Sweep Plus makers with pending balances and bill them via Stripe.

    Args:
        apply: if False, returns candidates without creating any Stripe
               invoices. Useful for dry-run / admin preview.

    Returns:
        {
            "batch": "YYYY-MM",
            "candidate_count": int,
            "invoiced": int,
            "skipped": [{"slug": ..., "reason": ...}],
            "errors": [{"slug": ..., "error": ...}],
            "total_cents": int,
        }
    """
    if not STRIPE_API_KEY and apply:
        return {
            "batch": _batch_key(),
            "candidate_count": 0,
            "invoiced": 0,
            "skipped": [{"slug": None, "reason": "stripe-not-configured"}],
            "errors": [],
            "total_cents": 0,
        }

    batch = _batch_key()
    stripe_sdk.api_key = STRIPE_API_KEY

    # Only Plus subscribers — they're the ones with a Stripe Customer on
    # file. Free-tier makers keep draining through sale payouts.
    cursor = db.makers.find(
        {
            "subscription_status": "active",
            "stripe_customer_id": {"$ne": None, "$exists": True},
            "pending_charges_cents": {"$gte": MIN_CLEAR_CENTS},
        },
        {"_id": 0, "slug": 1, "email": 1, "stripe_customer_id": 1,
         "pending_charges_cents": 1},
    )
    candidates = await cursor.to_list(1000)

    invoiced = 0
    total_cents = 0
    skipped: list[dict] = []
    errors: list[dict] = []

    for m in candidates:
        slug = m["slug"]
        amount = int(m.get("pending_charges_cents") or 0)
        if amount < MIN_CLEAR_CENTS:
            skipped.append({"slug": slug, "reason": "below-threshold"})
            continue
        if await _already_cleared(slug, batch):
            skipped.append({"slug": slug, "reason": "already-cleared-this-batch"})
            continue
        if not apply:
            total_cents += amount
            continue
        try:
            stripe_sdk.InvoiceItem.create(
                customer=m["stripe_customer_id"],
                amount=amount,
                currency="usd",
                description=f"Listing + promotion fees through {batch}",
                metadata={
                    "maker_slug": slug,
                    "kind": "charge_clearing",
                    "batch": batch,
                },
            )
            inv = stripe_sdk.Invoice.create(
                customer=m["stripe_customer_id"],
                auto_advance=True,
                collection_method="charge_automatically",
                description=(
                    f"Crafters Market listing + promotion fees ({batch}). "
                    "Billed to your Plus subscription card on file."
                ),
                metadata={
                    "maker_slug": slug,
                    "kind": "charge_clearing",
                    "batch": batch,
                },
            )
            # Finalize so Stripe attempts payment immediately.
            try:
                stripe_sdk.Invoice.finalize_invoice(inv.id)
            except Exception:
                # auto_advance=true will still finalize shortly; carry on.
                pass
            # Zero out the ledger and stamp the history row.
            await db.makers.update_one(
                {"slug": slug},
                {
                    "$set": {"pending_charges_cents": 0},
                    "$push": {"charge_history": {
                        "kind": "charge_clearing",
                        "slug": None,
                        "amount_cents": -amount,
                        "ts": now_iso(),
                        "batch": batch,
                        "invoice_id": inv.id,
                        "note": f"invoiced {amount}c to Stripe ({batch})",
                    }},
                },
            )
            invoiced += 1
            total_cents += amount
            logger.info(
                "[charge_clearing] invoiced maker=%s amount=%sc invoice=%s batch=%s",
                slug, amount, inv.id, batch,
            )
        except Exception as e:
            logger.exception(
                "[charge_clearing] failed maker=%s amount=%sc: %s",
                slug, amount, e,
            )
            errors.append({"slug": slug, "error": str(e)[:240]})

    return {
        "batch": batch,
        "candidate_count": len(candidates),
        "invoiced": invoiced,
        "skipped": skipped,
        "errors": errors,
        "total_cents": total_cents,
        "applied": apply,
    }
