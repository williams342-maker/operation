"""Admin · shipping ledger review & manual reconciliation.

Endpoints (all require admin JWT):
    GET    /api/admin/shipping-ledger             — paginated rows w/ filters
    GET    /api/admin/shipping-ledger/rollup      — per-maker unbilled totals
    POST   /api/admin/shipping-ledger/{id}/mark-billed — manual reconciliation
    POST   /api/admin/shipping-ledger/run-invoices — trigger weekly run now
    GET    /api/admin/shipping-ledger/export.csv  — CSV export for accounting
"""
from __future__ import annotations
import csv
import io
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core import db, now_iso
from maker_auth import current_admin

router = APIRouter(prefix="/admin")


@router.get("/shipping-ledger")
async def list_ledger(
    maker_slug: Optional[str] = Query(None),
    billed: Optional[str] = Query(None, description="'yes' | 'no' | None"),
    tracking: Optional[str] = Query(None, description="exact tracking# match"),
    limit: int = Query(200, ge=1, le=1000),
    _: dict = Depends(current_admin),
):
    q: dict = {}
    if maker_slug:
        q["maker_slug"] = maker_slug
    if billed == "yes":
        q["billed_at"] = {"$ne": None}
    elif billed == "no":
        q["billed_at"] = None
    if tracking:
        q["tracking_number"] = tracking.strip()
    rows = await db.shipping_ledger.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"count": len(rows), "rows": rows}


@router.get("/shipping-ledger/rollup")
async def rollup(_: dict = Depends(current_admin)):
    """Per-maker totals, unbilled pile first — powers the admin rollup UI."""
    cursor = db.shipping_ledger.aggregate([
        {"$group": {
            "_id": "$maker_slug",
            "unbilled_cents": {"$sum": {"$cond": [{"$eq": ["$billed_at", None]}, "$billed_cents", 0]}},
            "billed_cents":   {"$sum": {"$cond": [{"$ne": ["$billed_at", None]}, "$billed_cents", 0]}},
            "unbilled_count": {"$sum": {"$cond": [{"$eq": ["$billed_at", None]}, 1, 0]}},
            "total_count":    {"$sum": 1},
            "last_created":   {"$max": "$created_at"},
        }},
        {"$sort": {"unbilled_cents": -1}},
    ])
    items = [
        {
            "maker_slug": d["_id"],
            "unbilled_cents": d.get("unbilled_cents") or 0,
            "billed_cents":   d.get("billed_cents") or 0,
            "unbilled_count": d.get("unbilled_count") or 0,
            "total_count":    d.get("total_count") or 0,
            "last_created":   d.get("last_created"),
        }
        async for d in cursor
    ]
    total_unbilled = sum(i["unbilled_cents"] for i in items)
    return {"total_unbilled_cents": total_unbilled, "makers": items}


class MarkBilledReq(BaseModel):
    invoice_id: str
    note: Optional[str] = None


@router.post("/shipping-ledger/{ledger_id}/mark-billed")
async def mark_billed(ledger_id: str, body: MarkBilledReq, claims: dict = Depends(current_admin)):
    row = await db.shipping_ledger.find_one({"id": ledger_id}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Ledger row not found.")
    if row.get("billed_at"):
        raise HTTPException(400, "Row is already billed.")
    await db.shipping_ledger.update_one(
        {"id": ledger_id},
        {"$set": {
            "billed_at": now_iso(),
            "invoice_id": body.invoice_id,
            "billed_by_admin": claims.get("email") or claims.get("sub"),
            "billed_note": body.note or "",
        }},
    )
    return {"ok": True}


class RunInvoicesReq(BaseModel):
    dry_run: bool = True


@router.post("/shipping-ledger/run-invoices")
async def run_invoices(body: RunInvoicesReq, _: dict = Depends(current_admin)):
    """Trigger the weekly invoice run ad-hoc. Defaults to dry-run so an
    accidental click doesn't create real Stripe invoices."""
    from shipping_invoicing import run_weekly_shipping_invoices
    return await run_weekly_shipping_invoices(dry_run=body.dry_run)


@router.get("/shipping-ledger/export.csv")
async def export_csv(
    maker_slug: Optional[str] = Query(None),
    billed: Optional[str] = Query(None),
    _: dict = Depends(current_admin),
):
    q: dict = {}
    if maker_slug:
        q["maker_slug"] = maker_slug
    if billed == "yes":
        q["billed_at"] = {"$ne": None}
    elif billed == "no":
        q["billed_at"] = None

    rows = await db.shipping_ledger.find(q, {"_id": 0}).sort("created_at", -1).to_list(10000)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "id", "created_at", "maker_slug", "session_id", "provider",
        "servicelevel", "tracking_number", "amount_cents", "markup_cents",
        "billed_cents", "currency", "billed_at", "invoice_id", "test_mode",
    ])
    for r in rows:
        w.writerow([
            r.get("id"), r.get("created_at"), r.get("maker_slug"),
            r.get("session_id"), r.get("provider"), r.get("servicelevel_name"),
            r.get("tracking_number"), r.get("amount_cents"), r.get("markup_cents"),
            r.get("billed_cents"), r.get("currency"), r.get("billed_at") or "",
            r.get("invoice_id") or "", r.get("test_mode"),
        ])
    buf.seek(0)
    headers = {"Content-Disposition": 'attachment; filename="shipping-ledger.csv"'}
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)
