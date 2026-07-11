"""iter441 — PayPal Payouts (Phase 1: admin-triggered, sandbox-first).

Buyer pays with PayPal → funds sit on the platform PayPal account →
maker balances accumulate as `deferred` rows in db.maker_payouts
(provider="paypal", written by paypal_finalize). This module pays them out:

  GET  /api/admin/paypal/payouts/summary      per-maker balances + totals
  POST /api/admin/paypal/payouts/run          dry-run preview OR execute a
                                              PayPal Payouts batch (v1)
  GET  /api/admin/paypal/payouts/runs         payout batch history
  GET  /api/admin/paypal/payouts/export.csv   ledger CSV export

Provider-agnostic by data: every ledger row carries `provider`; a future
Stripe/ACH/Wise engine only needs its own run executor.

Idempotency: rows are atomically claimed deferred→processing under a
payout_run_id BEFORE the PayPal call; sender_batch_id = run id so a network
retry can never double-pay. Item webhooks (PAYMENT.PAYOUTS-ITEM.*) stamp the
final paid/failed status.
"""
import csv
import io
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_admin

from .paypal_webhooks import _access_token, _config, paypal_configured

router = APIRouter()

_ELIGIBLE_STATUSES = ["deferred", "failed"]  # failed = retryable after fix


def _dispute_hold(tx: dict | None) -> bool:
    if not tx:
        return False
    if tx.get("refund_status"):
        return True
    ds = (tx.get("dispute_status") or "").upper()
    return bool(tx.get("dispute_id")) and ds not in ("RESOLVED", "CLOSED", "CANCELLED")


async def _maker_rows(maker_slug: str | None = None) -> list[dict]:
    flt: dict = {"provider": "paypal"}
    if maker_slug:
        flt["maker_slug"] = maker_slug
    return await db.maker_payouts.find(flt, {"_id": 0}).to_list(2000)


async def _classify(rows: list[dict]) -> dict:
    """Group PayPal ledger rows per maker into available / missing-email /
    hold / processing / paid buckets."""
    slugs = sorted({r["maker_slug"] for r in rows})
    makers = {m["slug"]: m async for m in db.makers.find(
        {"slug": {"$in": slugs}},
        {"_id": 0, "slug": 1, "name": 1, "email": 1, "paypal_email": 1,
         "paypal_email_reminder_count": 1, "paypal_email_reminder_at": 1})}
    session_ids = list({r["session_id"] for r in rows})
    txs = {t["session_id"]: t async for t in db.payment_transactions.find(
        {"session_id": {"$in": session_ids}},
        {"_id": 0, "session_id": 1, "refund_status": 1, "dispute_id": 1, "dispute_status": 1})}

    out: dict[str, dict] = {}
    for r in rows:
        slug = r["maker_slug"]
        m = makers.get(slug, {})
        e = out.setdefault(slug, {
            "maker_slug": slug, "maker_name": m.get("name") or slug,
            "paypal_email": m.get("paypal_email"),
            "available_cents": 0, "missing_email_cents": 0, "hold_cents": 0,
            "processing_cents": 0, "paid_cents": 0, "failed_cents": 0,
            "available_sessions": [], "last_payout_at": None,
            "oldest_deferred_at": None,
            "reminder_count": m.get("paypal_email_reminder_count") or 0,
            "last_reminder_at": m.get("paypal_email_reminder_at"),
        })
        cents = int(r.get("amount_cents") or 0)
        status = r.get("status")
        if status == "processing":
            e["processing_cents"] += cents
        elif status == "paid":
            e["paid_cents"] += cents
            if not e["last_payout_at"] or (r.get("paid_at") or "") > e["last_payout_at"]:
                e["last_payout_at"] = r.get("paid_at")
        elif status in _ELIGIBLE_STATUSES:
            if status == "failed":
                e["failed_cents"] += cents
            if _dispute_hold(txs.get(r["session_id"])):
                e["hold_cents"] += cents
            elif not e["paypal_email"]:
                e["missing_email_cents"] += cents
                ts = r.get("updated_at") or ""
                if not e["oldest_deferred_at"] or ts < e["oldest_deferred_at"]:
                    e["oldest_deferred_at"] = ts
            else:
                e["available_cents"] += cents
                e["available_sessions"].append(r["session_id"])
    return out


@router.get("/admin/paypal/payouts/summary")
async def payouts_summary(_: dict = Depends(current_admin)):
    rows = await _maker_rows()
    per_maker = await _classify(rows)
    makers = sorted(per_maker.values(),
                    key=lambda e: -(e["available_cents"] + e["missing_email_cents"]))
    totals = {k: sum(e[k] for e in makers) for k in
              ("available_cents", "missing_email_cents", "hold_cents",
               "processing_cents", "paid_cents")}
    return {"makers": makers, "totals": totals,
            "paypal_configured": paypal_configured(),
            "environment": _config()["env"]}


class PayoutRunRequest(BaseModel):
    maker_slugs: list[str] = []   # empty = all eligible
    dry_run: bool = True


@router.post("/admin/paypal/payouts/run")
async def payouts_run(req: PayoutRunRequest, claims: dict = Depends(current_admin)):
    if not paypal_configured():
        raise HTTPException(503, "PayPal is not configured.")
    rows = await _maker_rows()
    per_maker = await _classify(rows)
    items = []
    for slug, e in per_maker.items():
        if req.maker_slugs and slug not in req.maker_slugs:
            continue
        if e["available_cents"] <= 0 or not e["paypal_email"]:
            continue
        items.append({
            "maker_slug": slug, "maker_name": e["maker_name"],
            "paypal_email": e["paypal_email"],
            "amount_cents": e["available_cents"],
            "sessions": e["available_sessions"],
        })
    total_cents = sum(i["amount_cents"] for i in items)
    if req.dry_run:
        return {"dry_run": True, "makers": len(items), "total_cents": total_cents,
                "items": items}
    if not items:
        raise HTTPException(400, "No eligible maker balances to pay.")

    run_id = uuid.uuid4().hex[:20]
    cfg = _config()
    run_doc = {
        "id": run_id, "environment": cfg["env"], "status": "created",
        "created_by": claims.get("email"), "created_at": now_iso(),
        "total_cents": total_cents, "maker_count": len(items),
        "items": [{k: i[k] for k in ("maker_slug", "paypal_email", "amount_cents", "sessions")}
                  for i in items],
    }
    await db.paypal_payout_runs.insert_one(dict(run_doc))

    # Claim rows BEFORE hitting PayPal so a crash/retry can't double-pay.
    for i in items:
        await db.maker_payouts.update_many(
            {"maker_slug": i["maker_slug"], "provider": "paypal",
             "status": {"$in": _ELIGIBLE_STATUSES},
             "session_id": {"$in": i["sessions"]}},
            {"$set": {"status": "processing", "payout_run_id": run_id,
                      "paypal_email_used": i["paypal_email"],
                      "updated_at": now_iso()}},
        )

    payload = {
        "sender_batch_header": {
            "sender_batch_id": run_id,
            "email_subject": "You've been paid by Crafters Market",
            "email_message": "Your Crafters Market sales payout has arrived.",
        },
        "items": [{
            "recipient_type": "EMAIL",
            "receiver": i["paypal_email"],
            "amount": {"value": f"{i['amount_cents'] / 100:.2f}", "currency": "USD"},
            "note": f"Crafters Market payout — {i['maker_slug']}",
            "sender_item_id": f"{run_id}:{i['maker_slug']}",
        } for i in items],
    }
    r = None
    for attempt in (1, 2):
        token = await _access_token(cfg)
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{cfg['base']}/v1/payments/payouts",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
            )
        if r.status_code in (200, 201) or attempt == 2:
            break
        if r.status_code in (401, 429) or r.status_code >= 500:
            from .paypal_webhooks import _token_cache
            _token_cache.pop(cfg["env"], None)
            continue
        break

    if r.status_code not in (200, 201):
        # Roll rows back so they stay payable — nothing was sent.
        await db.maker_payouts.update_many(
            {"payout_run_id": run_id, "status": "processing"},
            {"$set": {"status": "deferred", "updated_at": now_iso()},
             "$unset": {"payout_run_id": ""}},
        )
        await db.paypal_payout_runs.update_one(
            {"id": run_id},
            {"$set": {"status": "failed", "error": r.text[:500],
                      "http_status": r.status_code}},
        )
        logger.error("[paypal-payouts] batch create failed · run=%s · HTTP %s", run_id, r.status_code)
        raise HTTPException(502, "PayPal rejected the payout batch — balances were NOT paid and remain available.")

    body = r.json()
    batch_id = ((body.get("batch_header") or {}).get("payout_batch_id"))
    batch_status = ((body.get("batch_header") or {}).get("batch_status"))
    await db.paypal_payout_runs.update_one(
        {"id": run_id},
        {"$set": {"status": "submitted", "payout_batch_id": batch_id,
                  "batch_status": batch_status, "submitted_at": now_iso()}},
    )
    await db.maker_payouts.update_many(
        {"payout_run_id": run_id},
        {"$set": {"payout_batch_id": batch_id, "payout_status": "PENDING",
                  "updated_at": now_iso()}},
    )
    await db.audit_log.insert_one({
        "kind": "paypal_payout_batch", "actor": claims.get("email"),
        "run_id": run_id, "payout_batch_id": batch_id,
        "total_cents": total_cents, "maker_count": len(items),
        "created_at": now_iso(),
    })
    # Payout receipt email per maker — best effort.
    try:
        import email_service
        for i in items:
            m = await db.makers.find_one({"slug": i["maker_slug"]}, {"_id": 0})
            if m and m.get("email"):
                await email_service.send_maker_payout_sent(
                    m["email"], m.get("name") or i["maker_slug"],
                    i["amount_cents"] / 100.0, i["paypal_email"], batch_id)
    except Exception as e:
        logger.warning("[paypal-payouts] receipt emails failed · %s", e)

    logger.info("[paypal-payouts] batch submitted · run=%s · batch=%s · makers=%s · $%.2f",
                run_id, batch_id, len(items), total_cents / 100)
    return {"dry_run": False, "run_id": run_id, "payout_batch_id": batch_id,
            "batch_status": batch_status, "makers": len(items),
            "total_cents": total_cents}


@router.get("/admin/paypal/payouts/runs")
async def payouts_runs(_: dict = Depends(current_admin)):
    rows = await db.paypal_payout_runs.find({}, {"_id": 0}).sort(
        "created_at", -1).limit(50).to_list(50)
    return {"runs": rows}


@router.get("/admin/paypal/payouts/export.csv")
async def payouts_export(status: str = "", date_from: str = "", date_to: str = "",
                         _: dict = Depends(current_admin)):
    flt: dict = {"provider": "paypal"}
    if status:
        flt["status"] = status
    date_flt = {}
    if date_from:
        date_flt["$gte"] = date_from
    if date_to:
        date_flt["$lte"] = date_to + ("T23:59:59Z" if len(date_to) == 10 else "")
    if date_flt:
        flt["updated_at"] = date_flt
    rows = await db.maker_payouts.find(flt, {"_id": 0}).sort("updated_at", -1).to_list(5000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["maker_slug", "session_id", "status", "amount_usd", "gross_usd",
                "commission_usd", "paypal_email_used", "payout_run_id",
                "payout_batch_id", "payout_item_id", "paid_at", "updated_at"])
    for r in rows:
        w.writerow([
            r.get("maker_slug"), r.get("session_id"), r.get("status"),
            f"{(r.get('amount_cents') or 0) / 100:.2f}",
            f"{(r.get('gross_cents') or 0) / 100:.2f}",
            f"{(r.get('commission_cents') or 0) / 100:.2f}",
            r.get("paypal_email_used"), r.get("payout_run_id"),
            r.get("payout_batch_id"), r.get("payout_item_id"),
            r.get("paid_at"), r.get("updated_at"),
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=paypal-payouts.csv"})


# ── Webhook hooks (called from paypal_webhooks._process_event) ──────────────

_ITEM_FAIL_STATUSES = ("FAILED", "RETURNED", "BLOCKED", "DENIED", "CANCELED",
                       "CANCELLED", "REVERSED", "REFUNDED", "UNCLAIMED")


async def apply_payout_item_event(event: dict) -> str:
    """PAYMENT.PAYOUTS-ITEM.* — resolve sender_item_id run:maker → stamp rows."""
    res = event.get("resource") or {}
    item = res.get("payout_item") or {}
    sender_item_id = item.get("sender_item_id") or res.get("sender_item_id") or ""
    if ":" not in sender_item_id:
        return "recorded_no_matching_payout"
    run_id, maker_slug = sender_item_id.split(":", 1)
    status = (res.get("transaction_status") or "").upper()
    item_id = res.get("payout_item_id")
    flt = {"payout_run_id": run_id, "maker_slug": maker_slug}
    if not await db.maker_payouts.count_documents(flt):
        return "recorded_no_matching_payout"
    if status == "SUCCESS" or event.get("event_type", "").endswith("SUCCEEDED"):
        await db.maker_payouts.update_many(flt, {"$set": {
            "status": "paid", "payout_status": status or "SUCCESS",
            "payout_item_id": item_id, "paid_at": now_iso(), "updated_at": now_iso()}})
        outcome = "paid"
    elif status in _ITEM_FAIL_STATUSES or any(
            event.get("event_type", "").endswith(s) for s in
            ("FAILED", "RETURNED", "BLOCKED", "DENIED", "CANCELED", "UNCLAIMED")):
        errors = (res.get("errors") or {})
        await db.maker_payouts.update_many(flt, {"$set": {
            "status": "failed", "payout_status": status or "FAILED",
            "payout_item_id": item_id,
            "failure_reason": errors.get("message") or status or "payout failed",
            "updated_at": now_iso()}})
        outcome = "failed"
    else:
        await db.maker_payouts.update_many(flt, {"$set": {
            "payout_status": status, "updated_at": now_iso()}})
        outcome = "status_updated"
    await db.paypal_payout_runs.update_one(
        {"id": run_id},
        {"$set": {f"item_outcomes.{maker_slug}": outcome, "updated_at": now_iso()}})
    return f"payout_item:{outcome}:{maker_slug}"


async def apply_payout_batch_event(event: dict) -> str:
    """PAYMENT.PAYOUTSBATCH.* — stamp the run; DENIED fails all its rows."""
    res = event.get("resource") or {}
    bh = res.get("batch_header") or {}
    run_id = ((bh.get("sender_batch_header") or {}).get("sender_batch_id"))
    status = (bh.get("batch_status") or "").upper()
    if not run_id:
        return "recorded_no_matching_payout"
    upd = await db.paypal_payout_runs.update_one(
        {"id": run_id}, {"$set": {"batch_status": status, "updated_at": now_iso()}})
    if not upd.matched_count:
        return "recorded_no_matching_payout"
    if status == "DENIED":
        await db.maker_payouts.update_many(
            {"payout_run_id": run_id, "status": "processing"},
            {"$set": {"status": "failed", "payout_status": "DENIED",
                      "failure_reason": "payout batch denied",
                      "updated_at": now_iso()}})
    return f"payout_batch:{status.lower() or 'updated'}"


# ── Missing-email nudges (finalize hook + daily reminder cron) ──────────────

async def nudge_paypal_email_needed(maker_slug: str) -> None:
    """Called from paypal_finalize when a PayPal sale lands for a maker with
    no PayPal email on file. Sends the first heads-up immediately (once)."""
    m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
    if not m or m.get("paypal_email") or not m.get("email"):
        return
    if m.get("paypal_email_nudged_at"):
        return  # first nudge already sent — cron handles reminders
    total = await _deferred_missing_email_cents(maker_slug)
    import email_service
    await email_service.send_maker_paypal_email_needed(
        m["email"], m.get("name") or maker_slug, total / 100.0)
    await db.makers.update_one(
        {"slug": maker_slug},
        {"$set": {"paypal_email_nudged_at": now_iso(),
                  "paypal_email_reminder_count": 0}})


async def _deferred_missing_email_cents(maker_slug: str) -> int:
    rows = await db.maker_payouts.find(
        {"maker_slug": maker_slug, "provider": "paypal",
         "status": {"$in": _ELIGIBLE_STATUSES}},
        {"_id": 0, "amount_cents": 1}).to_list(500)
    return sum(int(r.get("amount_cents") or 0) for r in rows)


REMINDER_STAGES_DAYS = (3, 7, 14)


async def job_paypal_email_reminders() -> None:
    """Daily cron: remind makers with deferred PayPal balances and no PayPal
    email at 3 / 7 / 14 days after the first nudge. Stops once the email is
    added or all 3 reminders are sent."""
    from datetime import datetime, timezone
    slugs = await db.maker_payouts.distinct(
        "maker_slug", {"provider": "paypal", "status": {"$in": _ELIGIBLE_STATUSES}})
    for slug in slugs:
        m = await db.makers.find_one({"slug": slug}, {"_id": 0})
        if not m or m.get("paypal_email") or not m.get("email"):
            continue
        nudged = m.get("paypal_email_nudged_at")
        if not nudged:
            await nudge_paypal_email_needed(slug)
            continue
        sent = int(m.get("paypal_email_reminder_count") or 0)
        if sent >= len(REMINDER_STAGES_DAYS):
            continue
        try:
            started = datetime.fromisoformat(nudged.replace("Z", "+00:00"))
        except ValueError:
            continue
        days = (datetime.now(timezone.utc) - started).days
        if days < REMINDER_STAGES_DAYS[sent]:
            continue
        total = await _deferred_missing_email_cents(slug)
        if total <= 0:
            continue
        import email_service
        await email_service.send_maker_paypal_email_needed(
            m["email"], m.get("name") or slug, total / 100.0, reminder=True)
        await db.makers.update_one(
            {"slug": slug},
            {"$set": {"paypal_email_reminder_count": sent + 1,
                      "paypal_email_reminder_at": now_iso()}})
        logger.info("[paypal-payouts] reminder %s/3 sent · maker=%s", sent + 1, slug)
