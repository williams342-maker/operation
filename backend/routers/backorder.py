"""Backorder request lifecycle.

Buyer journey:
  1. Listing hits 0 stock but is still published with backorders enabled
  2. ProductDetail surfaces a "Request backorder" CTA (per-listing or
     maker-default)
  3. Buyer fills the modal (name, email, qty, message) →
     `POST /products/{slug}/backorder-request` → confirmation email
  4. Maker sees the request in dashboard Orders → Backorders sub-tab
  5. Maker accepts (buyer notified, lead time confirmed) or declines
     (with a reason). Payment is handled off-platform per user choice 2b.
"""
from __future__ import annotations
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from core import db, logger, now_iso
from email_service import (
    send_buyer_backorder_received,
    send_maker_backorder_alert,
    send_buyer_backorder_accepted,
    send_buyer_backorder_declined,
)
from maker_auth import current_maker_slug
from models import (
    BackorderDecision, BackorderRequest, BackorderRequestCreate,
)

router = APIRouter()


# ── Helpers ────────────────────────────────────────────────────────────
async def _resolve_backorder_policy(product: dict) -> tuple[bool, int]:
    """Return `(allowed, lead_weeks)` for a given product doc. Per-listing
    `accepts_backorders` overrides the maker-level default. `lead_weeks`
    falls back to 4 when neither the listing nor the maker provided one
    so the buyer always sees a concrete promise."""
    listing_pref = product.get("accepts_backorders")
    if listing_pref is True:
        allowed = True
    elif listing_pref is False:
        allowed = False
    else:
        maker = await db.makers.find_one(
            {"slug": product.get("maker_slug")},
            {"_id": 0, "accepts_backorders_default": 1},
        ) or {}
        allowed = bool(maker.get("accepts_backorders_default"))
    lead_weeks = product.get("backorder_lead_weeks")
    if not lead_weeks or int(lead_weeks) < 1:
        lead_weeks = 4
    return allowed, int(lead_weeks)


# ── Public buyer endpoint ─────────────────────────────────────────────
@router.post("/products/{product_slug}/backorder-request",
             response_model=BackorderRequest)
async def create_backorder_request(
    product_slug: str, payload: BackorderRequestCreate,
    bg: BackgroundTasks,
):
    """Buyer submits a backorder request. Validates that:
      • the product exists, is published, and not deleted
      • the product is at 0 stock (buyers shouldn't be able to backorder
        an in-stock listing — that's just a regular order)
      • backorders are allowed (per-listing or maker default)
    Fires confirmation email to buyer + alert email to maker."""
    p = await db.products.find_one(
        {"slug": product_slug, "deleted_at": None}, {"_id": 0},
    )
    if not p:
        raise HTTPException(404, "Listing not found.")
    if p.get("status") != "published":
        raise HTTPException(400, "This listing isn't currently available for backorders.")
    if int(p.get("in_stock") or 0) > 0:
        raise HTTPException(
            400,
            "This listing is in stock — please add it to your cart instead.",
        )
    allowed, lead_weeks = await _resolve_backorder_policy(p)
    if not allowed:
        raise HTTPException(400, "This maker isn't accepting backorders right now.")
    qty = max(1, int(payload.quantity or 1))

    req = BackorderRequest(
        product_id=p["id"], product_slug=p["slug"],
        product_title=p["title"], maker_slug=p["maker_slug"],
        buyer_email=payload.buyer_email, buyer_name=payload.buyer_name.strip(),
        quantity=qty, message=(payload.message or "").strip(),
        lead_weeks_quoted=lead_weeks,
    )
    doc = req.model_dump()
    await db.backorder_requests.insert_one(dict(doc))

    # Notify both sides — fire-and-forget, never block the request.
    maker = await db.makers.find_one(
        {"slug": p["maker_slug"]}, {"_id": 0, "name": 1, "email": 1},
    ) or {}
    bg.add_task(
        send_buyer_backorder_received,
        payload.buyer_email, payload.buyer_name,
        p["title"], lead_weeks, maker.get("name") or p["maker_slug"],
    )
    if maker.get("email"):
        bg.add_task(
            send_maker_backorder_alert,
            maker["email"], maker.get("name") or p["maker_slug"],
            payload.buyer_name, payload.buyer_email, p["title"],
            qty, (payload.message or "").strip(),
        )
    logger.info("backorder request created · slug=%s buyer=%s qty=%d",
                p["slug"], payload.buyer_email, qty)
    return req


# ── Maker endpoints ───────────────────────────────────────────────────
@router.get("/maker/backorder-requests", response_model=list[BackorderRequest])
async def list_maker_backorder_requests(
    slug: str = Depends(current_maker_slug),
):
    rows = await db.backorder_requests.find(
        {"maker_slug": slug}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    return rows


@router.post("/maker/backorder-requests/{req_id}/accept",
             response_model=BackorderRequest)
async def maker_accept_backorder(
    req_id: str, bg: BackgroundTasks,
    slug: str = Depends(current_maker_slug),
):
    r = await db.backorder_requests.find_one(
        {"id": req_id, "maker_slug": slug}, {"_id": 0},
    )
    if not r:
        raise HTTPException(404, "Backorder request not found.")
    if r.get("status") != "pending":
        raise HTTPException(400, f"Already {r.get('status')}.")
    ts = now_iso()
    await db.backorder_requests.update_one(
        {"id": req_id, "maker_slug": slug, "status": "pending"},
        {"$set": {"status": "accepted", "accepted_at": ts}},
    )
    r["status"] = "accepted"
    r["accepted_at"] = ts
    maker = await db.makers.find_one(
        {"slug": slug}, {"_id": 0, "name": 1, "email": 1},
    ) or {}
    bg.add_task(
        send_buyer_backorder_accepted,
        r["buyer_email"], r["buyer_name"], r["product_title"],
        int(r.get("lead_weeks_quoted") or 4),
        maker.get("name") or slug, maker.get("email") or "",
    )
    return r


@router.post("/maker/backorder-requests/{req_id}/decline",
             response_model=BackorderRequest)
async def maker_decline_backorder(
    req_id: str, payload: BackorderDecision, bg: BackgroundTasks,
    slug: str = Depends(current_maker_slug),
):
    r = await db.backorder_requests.find_one(
        {"id": req_id, "maker_slug": slug}, {"_id": 0},
    )
    if not r:
        raise HTTPException(404, "Backorder request not found.")
    if r.get("status") != "pending":
        raise HTTPException(400, f"Already {r.get('status')}.")
    ts = now_iso()
    reason = (payload.decline_reason or "").strip()
    await db.backorder_requests.update_one(
        {"id": req_id, "maker_slug": slug, "status": "pending"},
        {"$set": {
            "status": "declined", "declined_at": ts, "decline_reason": reason,
        }},
    )
    r["status"] = "declined"
    r["declined_at"] = ts
    r["decline_reason"] = reason
    maker = await db.makers.find_one(
        {"slug": slug}, {"_id": 0, "name": 1},
    ) or {}
    bg.add_task(
        send_buyer_backorder_declined,
        r["buyer_email"], r["buyer_name"], r["product_title"],
        maker.get("name") or slug, reason,
    )
    return r


@router.post("/maker/backorder-requests/{req_id}/fulfill",
             response_model=BackorderRequest)
async def maker_fulfill_backorder(
    req_id: str, slug: str = Depends(current_maker_slug),
):
    """Maker marks an accepted backorder as fulfilled (after charging
    the buyer offline + shipping). Just a status flip — the buyer should
    have already received their normal shipping confirmation through
    whatever payment-collection method the maker used."""
    r = await db.backorder_requests.find_one(
        {"id": req_id, "maker_slug": slug}, {"_id": 0},
    )
    if not r:
        raise HTTPException(404, "Backorder request not found.")
    if r.get("status") != "accepted":
        raise HTTPException(400, "Only accepted backorders can be fulfilled.")
    ts = now_iso()
    await db.backorder_requests.update_one(
        {"id": req_id, "maker_slug": slug, "status": "accepted"},
        {"$set": {"status": "fulfilled", "fulfilled_at": ts}},
    )
    r["status"] = "fulfilled"
    r["fulfilled_at"] = ts
    return r


# ── Public read endpoint (used by ProductDetail OOS pill) ─────────────
@router.get("/products/{product_slug}/backorder-policy")
async def get_backorder_policy(product_slug: str):
    """Frontend reads this to decide whether to render the "Request
    backorder" CTA at all, and what lead time to display. Avoids
    duplicating the maker-default fallback logic in the React layer."""
    p = await db.products.find_one(
        {"slug": product_slug, "deleted_at": None},
        {"_id": 0, "id": 1, "slug": 1, "in_stock": 1, "maker_slug": 1,
         "accepts_backorders": 1, "backorder_lead_weeks": 1, "status": 1},
    )
    if not p:
        raise HTTPException(404, "Listing not found.")
    allowed, lead_weeks = await _resolve_backorder_policy(p)
    return {
        "allowed": allowed and int(p.get("in_stock") or 0) <= 0
                   and p.get("status") == "published",
        "lead_weeks": lead_weeks,
        "in_stock": int(p.get("in_stock") or 0),
    }
