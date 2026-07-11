"""iter446 — Nightly Marketplace Reconciliation engine + Ledger Health Score.

Nine checks across providers/ledger/books, a 0-100 health score, persisted
reports (db.recon_reports), OPS_EMAIL report + team-webhook alert on
difference. Runs nightly at 2:07 AM Pacific and on demand from the admin
console. All computation is read-only — this engine never mutates money rows.
"""
import uuid
from datetime import datetime, timedelta, timezone

import httpx

from core import STRIPE_API_KEY, db, logger

_OPEN_DISPUTE_EXCLUDE = ("RESOLVED", "CLOSED", "CANCELLED")


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
    from routers.paypal_webhooks import _access_token, _config, paypal_configured
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


async def compute_reconciliation() -> dict:
    """Core ledger-vs-books math shared by the admin endpoint + nightly job."""
    today = datetime.now(timezone.utc).date().isoformat()

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


async def _legacy_unreconciled() -> tuple[int, int, list]:
    """Outstanding book rows with no matching `sale` ledger entry — the
    classic pre-ledger-migration case. Returns (count, cents, sample_ids)."""
    count = cents = 0
    sample = []
    async for r in db.maker_payouts.find(
            {"status": {"$in": ["deferred", "failed"]}, "failure_permanent": {"$ne": True}},
            {"_id": 0, "session_id": 1, "maker_slug": 1, "amount_cents": 1}):
        hit = await db.marketplace_ledger.find_one(
            {"kind": "sale", "session_id": r["session_id"], "maker_slug": r["maker_slug"]},
            {"_id": 1})
        if not hit:
            count += 1
            cents += int(r.get("amount_cents") or 0)
            if len(sample) < 5:
                sample.append(f"{r['session_id']}·{r['maker_slug']}")
    return count, cents, sample


async def run_nightly_reconciliation(trigger: str = "cron") -> dict:
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    recon = await compute_reconciliation()
    checks: list[dict] = []
    penalty = 0.0

    def add(check_id, label, ok, detail, deduct=0.0):
        nonlocal penalty
        checks.append({"id": check_id, "label": label, "ok": bool(ok), "detail": detail})
        if not ok:
            penalty += deduct

    # 1-2. Provider balances reachable
    sb, pb = recon["stripe_balance_cents"], recon["paypal_balance_cents"]
    add("stripe_balance", "Stripe synced", sb is not None or not STRIPE_API_KEY,
        f"${sb / 100:,.2f}" if sb is not None else "API unavailable", 2)
    # 3. PayPal balance must cover PayPal maker liabilities
    pp_book = 0
    async for r in db.maker_payouts.find(
            {"provider": "paypal", "status": {"$in": ["deferred", "failed"]},
             "failure_permanent": {"$ne": True}}, {"_id": 0, "amount_cents": 1}):
        pp_book += int(r.get("amount_cents") or 0)
    if pb is None:
        add("paypal_balance", "PayPal synced", True, "API unavailable — coverage not verified", 0)
    else:
        add("paypal_balance", "PayPal synced", pb >= pp_book,
            f"${pb / 100:,.2f} vs ${pp_book / 100:,.2f} maker liability"
            + ("" if pb >= pp_book else " — INSUFFICIENT"), 10)

    # 4. Legacy unreconciled rows (informs the ledger check below)
    legacy_n, legacy_cents, legacy_sample = await _legacy_unreconciled()
    add("legacy_unreconciled",
        "No unreconciled legacy transactions",
        legacy_n == 0,
        f"{legacy_n} row(s) · ${legacy_cents / 100:,.2f}"
        + (f" · e.g. {', '.join(legacy_sample)}" if legacy_sample else ""),
        min(legacy_n, 10) * 1.0)

    # 5. Ledger vs books
    diff = recon["diff_cents"]
    legacy_explained = diff != 0 and diff == -legacy_cents
    add("ledger_match", "Ledger synced", diff == 0,
        "Match" if diff == 0 else
        f"Ledger ${recon['ledger']['outstanding_cents'] / 100:,.2f} vs books "
        f"${recon['maker_outstanding_cents'] / 100:,.2f} · diff ${diff / 100:,.2f}"
        + (" (fully explained by legacy rows)" if legacy_explained else ""),
        0 if legacy_explained else 15)

    # 6. Payout batches verified — submitted runs stuck >24h / processing rows stuck >48h
    day_ago = (now - timedelta(hours=24)).isoformat()
    two_days = (now - timedelta(hours=48)).isoformat()
    stuck_runs = await db.paypal_payout_runs.count_documents(
        {"status": "submitted", "created_at": {"$lt": day_ago},
         "batch_status": {"$nin": ["SUCCESS", "DENIED", "CANCELED"]}})
    stuck_rows = await db.maker_payouts.count_documents(
        {"status": "processing", "updated_at": {"$lt": two_days}})
    add("payout_batches", "Payout batches verified", stuck_runs == 0 and stuck_rows == 0,
        "All batches settled" if not (stuck_runs or stuck_rows)
        else f"{stuck_runs} run(s) unsettled >24h · {stuck_rows} row(s) processing >48h", 10)

    # 7. Orphan transactions — paid PayPal orders with no commission rows,
    #    and book rows pointing at a non-existent order.
    orphan_orders = 0
    async for t in db.payment_transactions.find(
            {"payment_provider": "paypal", "payment_status": "paid"},
            {"_id": 0, "session_id": 1}):
        if not await db.maker_payouts.find_one({"session_id": t["session_id"]}, {"_id": 1}):
            orphan_orders += 1
    orphan_rows = 0
    async for r in db.maker_payouts.find(
            {"provider": "paypal"}, {"_id": 0, "session_id": 1}):
        if not await db.payment_transactions.find_one({"session_id": r["session_id"]}, {"_id": 1}):
            orphan_rows += 1
    add("orphan_transactions", "No orphan orders", orphan_orders == 0 and orphan_rows == 0,
        "Every order has commission rows and vice-versa" if not (orphan_orders or orphan_rows)
        else f"{orphan_orders} order(s) without commission rows · {orphan_rows} row(s) without an order", 10)

    # 8. Negative balances
    neg = await db.maker_payouts.count_documents({"amount_cents": {"$lt": 0}})
    add("negative_balances", "No negative balances", neg == 0,
        "None" if neg == 0 else f"{neg} row(s) below zero", 15)

    # 9. Failed payouts
    failed_perm = await db.maker_payouts.count_documents(
        {"status": "failed", "failure_permanent": True})
    failed_retry = await db.maker_payouts.count_documents(
        {"status": "failed", "failure_permanent": {"$ne": True}})
    add("failed_payouts", "No failed payouts", failed_perm == 0 and failed_retry == 0,
        "None" if not (failed_perm or failed_retry)
        else f"{failed_perm} permanent · {failed_retry} retryable",
        10 if failed_perm else 3)

    # 10. Duplicate payout attempts
    dup_rows = [d async for d in db.maker_payouts.aggregate([
        {"$group": {"_id": {"s": "$session_id", "m": "$maker_slug"}, "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}}, {"$limit": 5}])]
    dup_batches = [d async for d in db.paypal_payout_runs.aggregate([
        {"$match": {"payout_batch_id": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$payout_batch_id", "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}}, {"$limit": 5}])]
    add("duplicate_payouts", "No duplicate payout attempts",
        not dup_rows and not dup_batches,
        "None" if not (dup_rows or dup_batches)
        else f"{len(dup_rows)} duplicated commission row(s) · {len(dup_batches)} duplicated batch id(s)", 15)

    score = round(max(0.0, 100.0 - penalty), 1)
    status = "balanced" if diff == 0 and all(
        c["ok"] for c in checks if c["id"] not in ("stripe_balance",)) else "alert"

    orders_today = await db.payment_transactions.count_documents(
        {"payment_status": "paid", "created_at": {"$regex": f"^{today}"}})
    payouts_today = await db.maker_payouts.count_documents(
        {"status": "paid", "paid_at": {"$regex": f"^{today}"}})
    possible_cause = None
    if diff != 0:
        possible_cause = ("Legacy transaction(s) recorded before the ledger migration"
                          if legacy_explained else
                          "Unexplained — inspect the ledger journal (Admin → Ledger · Recon)")

    report = {
        "id": uuid.uuid4().hex,
        "at": now.isoformat(),
        "date": today,
        "trigger": trigger,
        "status": status,
        "score": score,
        "checks": checks,
        "possible_cause": possible_cause,
        "orders_today": orders_today,
        "payouts_today": payouts_today,
        "recon": recon,
    }
    await db.recon_reports.insert_one(dict(report))

    try:
        import email_service
        await email_service.send_recon_report(report)
    except Exception as e:
        logger.warning("[recon] report email failed · %s", e)
    if status == "alert":
        try:
            from notify_webhook import notify_team
            await notify_team(
                kind="recon_alert",
                title="⚠ Marketplace Ledger Alert — difference detected",
                summary=f"Diff ${diff / 100:,.2f} · health {score}% · {possible_cause or ''}",
                fields=[(c["label"], c["detail"]) for c in checks if not c["ok"]][:6],
            )
        except Exception as e:
            logger.warning("[recon] team webhook failed · %s", e)
    logger.info("[recon] nightly run · status=%s score=%s diff=%s", status, score, diff)
    return report
