"""iter445/446 — Marketplace Ledger viewer, Finance Reconciliation +
Financial Operations dashboard.

  GET  /api/admin/ledger                         journal entries (filter provider/kind)
  GET  /api/admin/finance/reconciliation         provider balances vs ledger vs books
  POST /api/admin/finance/reconciliation/run     run the full nightly check suite now
  GET  /api/admin/finance/recon-reports          nightly report history
  GET  /api/admin/finance/ops-dashboard          executive morning dashboard
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from core import db
from maker_auth import current_admin
from recon_engine import (
    _paypal_balance_cents, _stripe_balance_cents, compute_reconciliation,
    run_nightly_reconciliation,
)

router = APIRouter()
_PT = ZoneInfo("America/Los_Angeles")


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


@router.get("/admin/finance/reconciliation")
async def finance_reconciliation(_: dict = Depends(current_admin)):
    return await compute_reconciliation()


@router.post("/admin/finance/reconciliation/run")
async def finance_reconciliation_run(claims: dict = Depends(current_admin)):
    return await run_nightly_reconciliation(trigger=f"admin:{claims.get('email')}")


@router.get("/admin/finance/recon-reports")
async def finance_recon_reports(limit: int = 30, _: dict = Depends(current_admin)):
    rows = await db.recon_reports.find({}, {"_id": 0}).sort(
        "at", -1).to_list(min(max(limit, 1), 100))
    return {"reports": rows, "count": len(rows)}


def _next_payout_run_at(now_utc: datetime) -> str:
    """Next 3:00 AM Pacific — the automated payout engine's cron slot."""
    now_pt = now_utc.astimezone(_PT)
    nxt = now_pt.replace(hour=3, minute=0, second=0, microsecond=0)
    if nxt <= now_pt:
        nxt += timedelta(days=1)
    return nxt.astimezone(timezone.utc).isoformat()


@router.get("/admin/finance/ops-dashboard")
async def finance_ops_dashboard(_: dict = Depends(current_admin)):
    from routers.payout_engine import compute_overview
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()

    gmv_today = 0.0
    orders_today = 0
    async for t in db.payment_transactions.find(
            {"payment_status": "paid", "created_at": {"$regex": f"^{today}"}},
            {"_id": 0, "amount": 1, "total": 1}):
        orders_today += 1
        gmv_today += float(t.get("amount") or t.get("total") or 0)

    commission_today = refunds_today = 0
    async for e in db.marketplace_ledger.find(
            {"created_at": {"$regex": f"^{today}"}},
            {"_id": 0, "kind": 1, "commission_cents": 1, "net_cents": 1, "gross_cents": 1}):
        if e["kind"] == "sale":
            commission_today += int(e.get("commission_cents") or 0)
        elif e["kind"] == "refund":
            refunds_today += int(e.get("net_cents") or 0) or int(e.get("gross_cents") or 0)

    failed_count = failed_cents = 0
    async for r in db.maker_payouts.find(
            {"status": "failed"}, {"_id": 0, "amount_cents": 1}):
        failed_count += 1
        failed_cents += int(r.get("amount_cents") or 0)

    ov = await compute_overview()
    totals = ov["totals"]
    makers = ov["makers"]
    largest = None
    missing_email = below_min = 0
    forecast = 0
    for m in makers:
        outstanding = (m["eligible_cents"] + m["waiting_hold_cents"] + m["missing_email_cents"]
                       + m["disputed_cents"] + m["refund_hold_cents"])
        if outstanding > 0 and (largest is None or outstanding > largest["cents"]):
            largest = {"maker_slug": m["maker_slug"], "maker_name": m["maker_name"],
                       "cents": outstanding}
        if m["missing_email_cents"] > 0:
            missing_email += 1
        if m["waiting_minimum"]:
            below_min += 1
        if m["paypal_email"] and m["payout_method"] == "paypal" and not m["payouts_on_hold"]:
            forecast += m["eligible_cents"] + m["waiting_hold_cents"]

    recon = await compute_reconciliation()
    last = await db.recon_reports.find({}, {"_id": 0, "recon": 0}).sort(
        "at", -1).limit(1).to_list(1)

    return {
        "at": now.isoformat(),
        "gmv_today_cents": int(round(gmv_today * 100)),
        "orders_today": orders_today,
        "commission_today_cents": commission_today,
        "refunds_today_cents": refunds_today,
        "stripe_balance_cents": recon["stripe_balance_cents"],
        "paypal_balance_cents": recon["paypal_balance_cents"],
        "deferred_maker_balances_cents": recon["maker_outstanding_cents"],
        "pending_payouts_cents": recon["pending_payouts_cents"],
        "paid_today_cents": recon["paid_today_cents"],
        "upcoming_payouts_cents": totals["eligible_today_cents"],
        "failed_payouts": {"count": failed_count, "cents": failed_cents},
        "disputes_cents": recon["disputes_cents"],
        "ledger_outstanding_cents": recon["ledger"]["outstanding_cents"],
        "diff_cents": recon["diff_cents"],
        "balanced": recon["balanced"],
        "health": (last[0] if last else None),
        "automation": ov["automation"],
        "next_payout_run_at": _next_payout_run_at(now),
        "largest_outstanding": largest,
        "makers_missing_paypal_email": missing_email,
        "makers_below_minimum": below_min,
        "weekly_payout_forecast_cents": forecast,
    }
