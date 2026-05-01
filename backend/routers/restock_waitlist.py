"""Restock waitlist — lighter-weight than backorders.

Buyer journey:
  1. Listing is at 0 stock (with or without backorders enabled)
  2. Buyer clicks "Notify when restocked" on the product detail page
  3. Email + name → POST /products/{slug}/restock-waitlist → confirmation email
  4. The next time the maker raises stock from 0 → positive on the same
     listing (PATCH /maker/products/{slug}), every waitlisted buyer is
     emailed once with a "Buy now" CTA and their entry is marked notified
     so they're not re-emailed on subsequent stock changes.

The maker dashboard surfaces a count of pending waitlist signups per
listing so makers know how much demand sits behind a 0-stock SKU.
"""
from __future__ import annotations
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from core import db, logger, now_iso
from email_service import send_buyer_restock_signup
from maker_auth import current_maker_slug
from models import RestockWaitlistCreate, RestockWaitlistEntry

router = APIRouter()


# ── Public buyer endpoint ─────────────────────────────────────────────
@router.post(
    "/products/{product_slug}/restock-waitlist",
    response_model=RestockWaitlistEntry,
)
async def join_restock_waitlist(
    product_slug: str, payload: RestockWaitlistCreate, bg: BackgroundTasks,
):
    """Buyer asks to be notified when this 0-stock listing comes back."""
    p = await db.products.find_one(
        {"slug": product_slug, "deleted_at": None}, {"_id": 0},
    )
    if not p:
        raise HTTPException(404, "Listing not found.")
    if p.get("status") != "published":
        raise HTTPException(400, "This listing isn't currently available.")
    if int(p.get("in_stock") or 0) > 0:
        raise HTTPException(
            400,
            "This listing is in stock — please add it to your cart instead.",
        )
    email_norm = payload.buyer_email.lower().strip()

    # Prevent duplicate signups: if the same email is already on the list
    # for this product (and hasn't been notified), return the existing
    # row instead of stacking duplicates.
    existing = await db.restock_waitlist.find_one(
        {
            "product_id": p["id"],
            "buyer_email": email_norm,
            "notified_at": None,
        },
        {"_id": 0},
    )
    if existing:
        return existing

    entry = RestockWaitlistEntry(
        product_id=p["id"], product_slug=p["slug"],
        product_title=p["title"], maker_slug=p["maker_slug"],
        buyer_email=email_norm,
        buyer_name=(payload.buyer_name or "").strip(),
    )
    doc = entry.model_dump()
    await db.restock_waitlist.insert_one(dict(doc))

    maker = await db.makers.find_one(
        {"slug": p["maker_slug"]}, {"_id": 0, "name": 1},
    ) or {}
    bg.add_task(
        send_buyer_restock_signup,
        email_norm, payload.buyer_name or "",
        p["title"], maker.get("name") or p["maker_slug"],
    )
    logger.info(
        "restock waitlist signup · slug=%s buyer=%s", p["slug"], email_norm,
    )
    return entry


# ── Maker dashboard ───────────────────────────────────────────────────
@router.get("/maker/restock-waitlist")
async def maker_restock_waitlist(slug: str = Depends(current_maker_slug)):
    """Per-listing aggregated counts of buyers waiting on a restock."""
    pipeline = [
        {"$match": {"maker_slug": slug, "notified_at": None}},
        {"$group": {
            "_id": {"product_id": "$product_id", "product_slug": "$product_slug",
                    "product_title": "$product_title"},
            "count": {"$sum": 1},
            "latest": {"$max": "$created_at"},
        }},
        {"$sort": {"count": -1}},
    ]
    rows = await db.restock_waitlist.aggregate(pipeline).to_list(500)
    out = []
    for r in rows:
        out.append({
            "product_id": r["_id"]["product_id"],
            "product_slug": r["_id"]["product_slug"],
            "product_title": r["_id"]["product_title"],
            "count": int(r["count"]),
            "latest_signup_at": r.get("latest"),
        })
    total = sum(o["count"] for o in out)
    return {"products": out, "total_pending": total}


# ── Helper: fired by the products PATCH endpoint when stock goes 0 → + ─
async def fire_restock_notifications_if_needed(
    *, product_id: str, prev_stock: int, new_stock: int, bg: BackgroundTasks,
) -> int:
    """Called from `routers/maker.py` PATCH /maker/products. If stock just
    crossed from 0 → positive, drains every pending waitlist entry for
    this product, fires buyer emails, and marks each entry notified.
    Returns the number of buyers notified (0 if no transition happened)."""
    if not (prev_stock <= 0 and new_stock > 0):
        return 0
    pending = await db.restock_waitlist.find(
        {"product_id": product_id, "notified_at": None}, {"_id": 0},
    ).to_list(2000)
    if not pending:
        return 0
    p = await db.products.find_one(
        {"id": product_id}, {"_id": 0, "slug": 1, "title": 1, "maker_slug": 1},
    ) or {}
    maker = await db.makers.find_one(
        {"slug": p.get("maker_slug")}, {"_id": 0, "name": 1},
    ) or {}
    site = (
        os.environ.get("PUBLIC_SITE_URL")
        or os.environ.get("FRONTEND_URL")
        or "https://craftersmarket.org"
    ).rstrip("/")
    product_url = f"{site}/shop/{p.get('slug', '')}"

    # Lazy-import here so this helper module stays importable from
    # routers/maker.py even on cold start ordering.
    from email_service import send_buyer_restocked

    for e in pending:
        bg.add_task(
            send_buyer_restocked,
            e["buyer_email"],
            e.get("buyer_name") or "",
            p.get("title") or e.get("product_title") or "your saved item",
            product_url,
            maker.get("name") or p.get("maker_slug") or "the maker",
        )
    ts = now_iso()
    await db.restock_waitlist.update_many(
        {"product_id": product_id, "notified_at": None},
        {"$set": {"notified_at": ts}},
    )
    logger.info(
        "restock waitlist drained · product=%s notified=%d",
        product_id, len(pending),
    )
    return len(pending)
