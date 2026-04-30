"""Weekly maker-shipping invoice job.

Rolls up each maker's unbilled `shipping_ledger` rows into a single
Stripe invoice. Cadence is per-maker (`maker.shipping_billing_cadence`):

    * "weekly"   — invoiced every Monday (ISO week day 0 here)
    * "biweekly" — invoiced every 2nd Monday (even ISO week number)

Flow for each eligible maker:
    1. Pull all rows with `billed_at IS NULL` AND `maker_slug == slug`.
    2. Require `maker.stripe_customer_id` — if missing, log + skip.
       (We store the Customer id on the maker doc when they subscribe to
       Crafters Plus; makers without a Plus sub have no Customer yet.
       Phase-2.5 will be "auto-create Customer at first label purchase".)
    3. Create a Stripe InvoiceItem per ledger row for line-item clarity.
    4. Create + finalize + send a Stripe Invoice.
    5. Stamp each row with `billed_at` + `invoice_id`.

Idempotency: each Stripe InvoiceItem is created with an
`idempotency_key` = ledger row id, so a retry never double-charges.
"""
from __future__ import annotations
import os
from datetime import datetime, timezone
from typing import Optional

from core import db, logger, now_iso


async def _eligible_makers_today() -> list[dict]:
    """All makers with at least one unbilled row, whose cadence fires today."""
    # Distinct maker_slugs with unbilled rows.
    slugs = await db.shipping_ledger.distinct(
        "maker_slug", {"billed_at": None},
    )
    if not slugs:
        return []
    makers = await db.makers.find(
        {"slug": {"$in": slugs}}, {"_id": 0},
    ).to_list(1000)
    out = []
    today = datetime.now(timezone.utc)
    # ISO week number — used to gate biweekly makers to even weeks.
    iso_week = today.isocalendar().week
    for m in makers:
        cadence = m.get("shipping_billing_cadence") or "weekly"
        if cadence == "biweekly" and (iso_week % 2 != 0):
            continue
        out.append(m)
    return out


async def run_weekly_shipping_invoices(dry_run: bool = False) -> dict:
    """Run the invoice roll-up. Called by scheduler or the admin
    'Run now' button. Returns a summary dict for logging/UI."""
    import stripe as stripe_sdk
    from core import STRIPE_API_KEY
    stripe_sdk.api_key = STRIPE_API_KEY

    eligible = await _eligible_makers_today()
    summary = {
        "scanned_makers": len(eligible),
        "invoiced_makers": 0,
        "invoiced_cents": 0,
        "skipped": [],
        "dry_run": dry_run,
    }

    for m in eligible:
        slug = m["slug"]
        rows = await db.shipping_ledger.find(
            {"maker_slug": slug, "billed_at": None}, {"_id": 0},
        ).to_list(500)
        if not rows:
            continue

        customer_id = m.get("stripe_customer_id")
        if not customer_id:
            summary["skipped"].append({"slug": slug, "reason": "no_stripe_customer"})
            logger.info("[shipping_invoice] skip %s — no stripe_customer_id", slug)
            continue

        total_cents = sum(r.get("billed_cents", 0) for r in rows)
        if total_cents <= 0:
            continue

        if dry_run:
            summary["invoiced_makers"] += 1
            summary["invoiced_cents"] += total_cents
            summary["skipped"].append({"slug": slug, "reason": "dry_run", "cents": total_cents})
            continue

        try:
            # Step 1: create one InvoiceItem per row for audit visibility.
            for r in rows:
                desc = f"Shipping label · {r.get('provider','')} {r.get('servicelevel_name','')} · {r.get('tracking_number','')}"
                stripe_sdk.InvoiceItem.create(
                    customer=customer_id,
                    amount=int(r.get("billed_cents") or 0),
                    currency=(r.get("currency") or "USD").lower(),
                    description=desc[:200],
                    idempotency_key=f"shipping-item-{r['id']}",
                )

            # Step 2: create + finalize + send the invoice.
            inv = stripe_sdk.Invoice.create(
                customer=customer_id,
                collection_method="charge_automatically",
                auto_advance=True,  # Stripe will auto-finalize + attempt charge
                description="Crafters Market — weekly shipping labels",
                metadata={"kind": "shipping_weekly", "maker_slug": slug, "row_count": str(len(rows))},
            )

            invoice_id = inv["id"]
            # Step 3: stamp every row we just billed.
            ts = now_iso()
            row_ids = [r["id"] for r in rows]
            await db.shipping_ledger.update_many(
                {"id": {"$in": row_ids}},
                {"$set": {"billed_at": ts, "invoice_id": invoice_id}},
            )
            summary["invoiced_makers"] += 1
            summary["invoiced_cents"] += total_cents
            logger.info(
                "[shipping_invoice] maker=%s invoice=%s cents=%d rows=%d",
                slug, invoice_id, total_cents, len(rows),
            )
        except Exception as e:
            logger.exception("[shipping_invoice] FAILED maker=%s", slug)
            summary["skipped"].append({"slug": slug, "reason": f"stripe_error:{e}"})
            continue

    return summary
