"""iter335 — Promotion wallet primitives.

A maker has at most one wallet doc (`db.promotion_wallets`) keyed by
`maker_slug`. The wallet stores `balance_cents`, `lifetime_funded_cents`,
and `lifetime_spent_cents`. Every credit/debit is recorded in
`db.wallet_transactions` so the maker can audit the ledger.

Why a separate wallet collection instead of just a counter on the maker
doc?
  • Allows the wallet to be funded by multiple sources (one-time Stripe
    top-ups, monthly Stripe subscriptions, manual admin credits, future
    veteran/founder credit grants) without race conditions on the maker
    doc itself.
  • Lets us index `wallet_transactions` by `created_at` for fast
    statement queries.
  • Future-proofs against multi-currency (just add a `currency` field).

All amounts are integer cents — never floats. The single public-facing
unit conversion happens at the API boundary.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Literal, Optional

from core import db, now_iso

log = logging.getLogger("crafters.promote.wallet")

TxnKind = Literal[
    "topup",        # one-time Stripe Checkout success
    "subscription", # monthly Stripe Invoice paid
    "spend",        # allocator extends `promoted_until` on a listing
    "refund",       # admin reversal
    "credit",       # admin manual grant (e.g. founder/veteran bonus)
    "adjustment",   # admin correction (positive or negative)
]


async def ensure_wallet(maker_slug: str) -> dict:
    """Idempotently create the wallet doc and return its current state.

    Called on first read so makers never see a 404 when they open the
    Promote page for the first time.
    """
    doc = await db.promotion_wallets.find_one({"_id": maker_slug})
    if doc:
        return doc
    new = {
        "_id": maker_slug,
        "maker_slug": maker_slug,
        "balance_cents": 0,
        "lifetime_funded_cents": 0,
        "lifetime_spent_cents": 0,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    try:
        await db.promotion_wallets.insert_one(new)
    except Exception:
        # Race-condition safety: another concurrent request just created
        # the row. Re-read and return whatever the winner persisted.
        doc = await db.promotion_wallets.find_one({"_id": maker_slug})
        if doc:
            return doc
        raise
    return new


async def get_balance_cents(maker_slug: str) -> int:
    doc = await db.promotion_wallets.find_one({"_id": maker_slug}, {"balance_cents": 1})
    return int((doc or {}).get("balance_cents") or 0)


async def credit(
    maker_slug: str,
    cents: int,
    *,
    kind: TxnKind,
    ref: str = "",
    note: str = "",
    idempotency_key: Optional[str] = None,
) -> dict:
    """Credit the wallet by `cents` and append a transaction row.

    If `idempotency_key` is supplied and a transaction with that key
    already exists, this is a no-op (returns the existing txn). This is
    critical for Stripe webhooks which can fire the same event twice.
    """
    if cents <= 0:
        raise ValueError("credit amount must be positive")
    if idempotency_key:
        existing = await db.wallet_transactions.find_one(
            {"idempotency_key": idempotency_key, "maker_slug": maker_slug}
        )
        if existing:
            log.info("[wallet] credit deduped: %s (%s)", idempotency_key, maker_slug)
            existing.pop("_id", None)
            return existing

    await ensure_wallet(maker_slug)
    # `find_one_and_update` with `$inc` is atomic — no read/write race.
    updated = await db.promotion_wallets.find_one_and_update(
        {"_id": maker_slug},
        {
            "$inc": {
                "balance_cents": int(cents),
                "lifetime_funded_cents": int(cents) if kind in ("topup", "subscription", "credit") else 0,
            },
            "$set": {"updated_at": now_iso()},
        },
        return_document=True,
    )
    txn = {
        "_id": secrets.token_urlsafe(12),
        "maker_slug": maker_slug,
        "kind": kind,
        "delta_cents": int(cents),
        "balance_after_cents": int(updated.get("balance_cents", 0)),
        "ref": ref,
        "note": note,
        "idempotency_key": idempotency_key,
        "created_at": now_iso(),
    }
    await db.wallet_transactions.insert_one(txn)
    log.info(
        "[wallet] credit %s +%d cents → %d (%s ref=%s)",
        maker_slug, cents, txn["balance_after_cents"], kind, ref,
    )
    txn.pop("_id", None)
    return txn


async def debit(
    maker_slug: str,
    cents: int,
    *,
    kind: TxnKind = "spend",
    ref: str = "",
    note: str = "",
    allow_negative: bool = False,
) -> Optional[dict]:
    """Debit the wallet. Returns the transaction or None if insufficient
    funds (when `allow_negative=False`)."""
    if cents <= 0:
        raise ValueError("debit amount must be positive")
    await ensure_wallet(maker_slug)

    if allow_negative:
        # Force-debit (used by admin adjustments). Atomic increment.
        updated = await db.promotion_wallets.find_one_and_update(
            {"_id": maker_slug},
            {
                "$inc": {
                    "balance_cents": -int(cents),
                    "lifetime_spent_cents": int(cents),
                },
                "$set": {"updated_at": now_iso()},
            },
            return_document=True,
        )
    else:
        # Conditional debit — only succeeds if balance ≥ cents. This
        # prevents the allocator from overspending when two crons race.
        updated = await db.promotion_wallets.find_one_and_update(
            {"_id": maker_slug, "balance_cents": {"$gte": int(cents)}},
            {
                "$inc": {
                    "balance_cents": -int(cents),
                    "lifetime_spent_cents": int(cents),
                },
                "$set": {"updated_at": now_iso()},
            },
            return_document=True,
        )
        if not updated:
            log.info("[wallet] debit declined: %s wants %d but balance insufficient",
                     maker_slug, cents)
            return None

    txn = {
        "_id": secrets.token_urlsafe(12),
        "maker_slug": maker_slug,
        "kind": kind,
        "delta_cents": -int(cents),
        "balance_after_cents": int(updated.get("balance_cents", 0)),
        "ref": ref,
        "note": note,
        "created_at": now_iso(),
    }
    await db.wallet_transactions.insert_one(txn)
    log.info("[wallet] debit  %s -%d cents → %d (%s ref=%s)",
             maker_slug, cents, txn["balance_after_cents"], kind, ref)
    txn.pop("_id", None)
    return txn


async def recent_transactions(maker_slug: str, limit: int = 25) -> list[dict]:
    cursor = db.wallet_transactions.find(
        {"maker_slug": maker_slug}
    ).sort("created_at", -1).limit(int(limit))
    out: list[dict] = []
    async for d in cursor:
        d.pop("_id", None)
        d.pop("idempotency_key", None)
        out.append(d)
    return out
