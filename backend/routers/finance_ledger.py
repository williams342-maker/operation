"""iter445 — Marketplace Ledger viewer + Finance Reconciliation.

  GET /api/admin/ledger                    journal entries (filter provider/kind)
  GET /api/admin/finance/reconciliation    provider balances vs ledger vs books
"""
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends

from core import STRIPE_API_KEY, db, logger
from maker_auth import current_admin

from .paypal_webhooks import _access_token, _config, paypal_configured

router = APIRouter()

_OPEN_DISPUTE_EXCLUDE = ("RESOLVED", "CLOSED", "CANCELLED")


@router.get("/admin/ledger")
async def admin_ledger(provider: str | None = None, kind: str | None = None,
                       limit: int = 200, _: dict = Depends(current_admin)):
    flt: dict = {}
    if provider:
        flt["provider"] = provider
    if kind:
        flt["kind"] = kind
    rows = await db.marketplace_ledger.find(flt, {"_id": 0}).sort(
        "created_at", -1).to_list(min(max(limit, 1), 1000))
    slugs = sorted({r["maker_slug"] for r in rows})
    names = {m["slug"]: m.get("name") or m["slug"] async for m in db.makers.find(
        {"slug": {"$in": slugs}}, {"_id": 0, "slug": 1, "name": 1})}
    for r in rows:
        r["maker_name"] = names.get(r["maker_slug"], r["maker_slug"])
    return {"entries": rows, "count": len(rows)}


async def _stripe_balance_cents() -> int | None:
    if not STRIPE_API_KEY:
        return None
    try:
        import stripe as stripe_sdk
        stripe_sdk.api_key = STRIPE_API_KEY
        bal = stripe_sdk.Balance.retrieve()
        cents = 0
        for bucket in list(bal.get("available") or []) + list(bal.get("pending") or []):
            if bucket.get("currency") == "usd":
                cents += int(bucket.get("amount") or 0)
        return cents
    except Exception as e:
        logger.warning("[recon] stripe balance fetch failed · %s", e)
        return None


async def _paypal_balance_cents() -> int | None:
    if not paypal_configured():
        return None
    try:
        cfg = _config()
        token = await _access_token(cfg)
        async with httpx.AsyncClient(timeout=15) as cx:
            r = await cx.get(f"{cfg['base']}/v1/reporting/balances",
                             headers={"Authorization": f"Bearer {token}"})
        if r.status_code != 200:
            logger.warning("[recon] paypal balance HTTP %s · %s", r.status_code, r.text[:200])
            return None
        for b in r.json().get("balances") or []:
            if b.get("currency") == "USD":
                v = (b.get("available_balance") or b.get("total_balance") or {}).get("value")
                return int(round(float(v) * 100)) if v is not None else None
        return None
    except Exception as e:
        logger.warning("[recon] paypal balance fetch failed · %s", e)
        return None


@router.get("/admin/finance/reconciliation")
async def finance_reconciliation(_: dict = Depends(current_admin)):
    today = datetime.now(timezone.utc).date().isoformat()

    # Ledger side (journal is the source of truth)
    led = {"sale": {}, "refund": {}, "payout": {}}
    async for g in db.marketplace_ledger.aggregate([{"$group": {
            "_id": "$kind",
            "gross_cents": {"$sum": "$gross_cents"},
            "fee_cents": {"$sum": "$fee_cents"},
            "commission_cents": {"$sum": "$commission_cents"},
            "net_cents": {"$sum": "$net_cents"},
            "entries": {"$sum": 1}}}]):
        led[g.pop("_id")] = g
    sales_net = int(led["sale"].get("net_cents") or 0)
    payouts_net = int(led["payout"].get("net_cents") or 0)
    refunds_net = int(led["refund"].get("net_cents") or 0) or int(led["refund"].get("gross_cents") or 0)
    ledger_outstanding = sales_net - refunds_net - payouts_net

    # Book side (maker_payouts operational rows)
    book_outstanding = pending = paid_today = 0
    async for r in db.maker_payouts.find(
            {}, {"_id": 0, "status": 1, "amount_cents": 1, "paid_at": 1, "failure_permanent": 1}):
        cents = int(r.get("amount_cents") or 0)
        st = r.get("status")
        if st in ("deferred", "failed") and not r.get("failure_permanent"):
            book_outstanding += cents
        elif st == "processing":
            pending += cents
        elif st == "paid" and (r.get("paid_at") or "").startswith(today):
            paid_today += cents

    # Open disputes (both providers share payment_transactions)
    disputes = 0
    async for t in db.payment_transactions.find(
            {"dispute_id": {"$exists": True, "$nin": [None, ""]}},
            {"_id": 0, "dispute_status": 1, "amount": 1, "total": 1}):
        if (t.get("dispute_status") or "").upper() not in _OPEN_DISPUTE_EXCLUDE:
            disputes += int(round(float(t.get("amount") or t.get("total") or 0) * 100))

    diff = ledger_outstanding - book_outstanding
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "stripe_balance_cents": await _stripe_balance_cents(),
        "paypal_balance_cents": await _paypal_balance_cents(),
        "ledger": {
            "sales_net_cents": sales_net,
            "refunds_cents": refunds_net,
            "payouts_net_cents": payouts_net,
            "outstanding_cents": ledger_outstanding,
            "gross_cents": int(led["sale"].get("gross_cents") or 0),
            "commission_cents": int(led["sale"].get("commission_cents") or 0),
            "entries": sum(int(v.get("entries") or 0) for v in led.values()),
        },
        "maker_outstanding_cents": book_outstanding,
        "pending_payouts_cents": pending,
        "paid_today_cents": paid_today,
        "refunds_cents": refunds_net,
        "disputes_cents": disputes,
        "diff_cents": diff,
        "balanced": diff == 0,
    }
