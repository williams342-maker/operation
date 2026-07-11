"""iter444 — Marketplace Ledger: the single source of truth for money
movement across BOTH payment providers.

Every paid order (Stripe or PayPal) records standardized `sale` entries per
maker; refunds record `refund` entries; payout executions record `payout`
entries. Balances, commissions and reports can be derived from this journal,
and a future migration to PayPal Commerce Platform only has to keep writing
the same entries.

Idempotent by design: one entry per (kind, session_id, maker_slug).
"""
import uuid

from core import db, logger, now_iso


async def ledger_record(kind: str, provider: str, session_id: str, maker_slug: str, *,
                        gross_cents: int = 0, fee_cents: int = 0,
                        commission_cents: int = 0, net_cents: int = 0,
                        currency: str = "usd", payout_run_id: str | None = None,
                        payout_batch_id: str | None = None,
                        order_ids: list | None = None, meta: dict | None = None) -> None:
    """kind: sale | refund | payout. Never raises — ledger writes are
    best-effort and must not break checkout or payouts."""
    try:
        key = {"kind": kind, "session_id": session_id, "maker_slug": maker_slug}
        await db.marketplace_ledger.update_one(key, {"$setOnInsert": {
            **key,
            "id": uuid.uuid4().hex,
            "provider": provider,
            "gross_cents": int(gross_cents),
            "fee_cents": int(fee_cents),
            "commission_cents": int(commission_cents),
            "net_cents": int(net_cents),
            "currency": currency,
            "payout_run_id": payout_run_id,
            "payout_batch_id": payout_batch_id,
            "order_ids": order_ids or [],
            "meta": meta or {},
            "created_at": now_iso(),
        }}, upsert=True)
    except Exception as e:
        logger.warning("[ledger] %s entry failed · session=%s · %s", kind, session_id, e)
