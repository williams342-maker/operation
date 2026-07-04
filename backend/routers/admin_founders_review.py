"""Founder final-review + closeout admin surfaces (iter418).

This module supplements ``founders.py`` with the *closeout* half of the
lifecycle:

* Activity-based classification (Active / Needs-Review) so an approved
  Founder who never used the account doesn't hold a slot forever.
* Admin review queue exposing every Founder + their activity signals.
* Manual downgrade action ("Move to Free Tier") that opens the slot
  back up **without** deleting the maker or their listings.
* Auto-close of the applications gate the moment the active-Founder
  headcount reaches the configured cap. Manual re-open by admin is
  supported (the classifier never *auto-reopens* — the user decided
  reopen must be a deliberate admin action).

Public surface for the /founders page reads the flag via the existing
`GET /api/settings` endpoint (`founder_applications_open`, added in
``settings.py``). Nothing here is public — every endpoint requires
``current_admin``.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_admin

router = APIRouter(tags=["admin", "founders"])


# --------------------------- Constants --------------------------- #
DEFAULT_FOUNDER_SLOTS = 100

# The four activity signals that make a Founder "Active". A Founder
# only needs to satisfy ANY ONE of them to remain active — the bar is
# intentionally low because the goal is to identify *dormant* accounts
# (never logged in, no shop, no listings), not to hound working makers.
_ACTIVITY_SIGNALS = (
    "has_shop_profile",       # Studio/bio filled beyond seed defaults
    "has_published_product",  # >=1 published listing
    "recent_login",           # signed in within 90 days
    "has_sales",              # >=1 order/sale on record
)
_RECENT_LOGIN_DAYS = 90


# --------------------------- Helpers --------------------------- #
async def _get_slots_total() -> int:
    """Cap of concurrent Active Founder slots. Falls back to 100."""
    doc = await db.site_settings.find_one({"_id": "global"}) or {}
    v = doc.get("founder_slots_total")
    return int(v) if isinstance(v, int) and v > 0 else DEFAULT_FOUNDER_SLOTS


async def _get_applications_open() -> bool:
    doc = await db.site_settings.find_one({"_id": "global"}) or {}
    return bool(doc.get("founder_applications_open", True))


async def _set_applications_open(value: bool, actor_email: str) -> None:
    await db.site_settings.update_one(
        {"_id": "global"},
        {"$set": {
            "founder_applications_open": bool(value),
            "founder_applications_open_updated_at": now_iso(),
            "founder_applications_open_updated_by": actor_email,
        }},
        upsert=True,
    )


def _cutoff_iso(days: int) -> str:
    from datetime import timedelta
    return (datetime.now(timezone.utc) - timedelta(days=days)) \
        .replace(microsecond=0).isoformat().replace("+00:00", "Z")


async def _activity_signals_for(maker: dict) -> dict:
    """Compute the four activity booleans + supporting metrics for a
    single Founder maker. Result is used by both classify() below and
    exposed verbatim to the admin review UI so the moderator can see
    *why* a maker is flagged."""
    slug = maker.get("slug")

    # Product counts (published + total draft).
    total_products = await db.products.count_documents({"maker_slug": slug})
    published_products = await db.products.count_documents({
        "maker_slug": slug, "status": "published",
    })

    # Last product update — Mongo aggregate to pick max(updated_at).
    last_product_update = None
    if total_products:
        cur = db.products.find(
            {"maker_slug": slug},
            {"updated_at": 1, "_id": 0},
        ).sort("updated_at", -1).limit(1)
        async for row in cur:
            last_product_update = row.get("updated_at")

    # Sales. Two collections exist historically (orders and payments);
    # count either as a valid sales signal.
    sales_count = 0
    try:
        sales_count = await db.orders.count_documents({"maker_slug": slug})
    except Exception:
        sales_count = 0
    if sales_count == 0:
        try:
            sales_count = await db.payments.count_documents(
                {"maker_slug": slug, "status": {"$in": ["succeeded", "paid"]}}
            )
        except Exception:
            pass

    # Shop-profile completion — has a bio > 40 chars and either
    # `studio_name` or `shop_title` beyond seed defaults.
    bio = (maker.get("bio") or "").strip()
    studio = (maker.get("studio_name") or maker.get("shop_title") or "").strip()
    has_shop_profile = bool(len(bio) >= 40 and len(studio) >= 3)

    # Recent login — last_login within 90 days.
    last_login = maker.get("last_login")
    recent_login = bool(
        last_login and last_login >= _cutoff_iso(_RECENT_LOGIN_DAYS)
    )

    signals = {
        "has_shop_profile": has_shop_profile,
        "has_published_product": published_products >= 1,
        "recent_login": recent_login,
        "has_sales": sales_count >= 1,
    }

    return {
        "signals": signals,
        "total_products": total_products,
        "published_products": published_products,
        "last_product_update": last_product_update,
        "last_login": last_login,
        "sales_count": sales_count,
    }


def _classify(signals: dict) -> str:
    """Map the four boolean signals into a review verdict.

    A Founder is **active** if ANY signal is true. If ALL four are
    false the account is dormant and flagged for admin review. We do
    NOT auto-classify anyone as ``downgrade_to_free`` — that
    designation only exists as an admin *action* (see downgrade
    endpoint below), never as an auto-verdict.
    """
    if any(signals.values()):
        return "active"
    return "needs_review"


async def _refresh_close_flag(actor_email: str = "system") -> dict:
    """Re-count active founders and flip the applications gate CLOSED
    if we've hit the cap. NEVER auto-*opens* the gate — reopening is
    always a deliberate admin choice."""
    cap = await _get_slots_total()
    active_slug_count = await _count_active_founders()
    if active_slug_count >= cap:
        was_open = await _get_applications_open()
        if was_open:
            await _set_applications_open(False, actor_email)
            logger.info(
                "[founders] auto-closed applications: %d/%d active founders",
                active_slug_count, cap,
            )
    return {"active_count": active_slug_count, "cap": cap}


async def _count_active_founders() -> int:
    """Number of ``tier == 'founder'`` makers who satisfy the activity
    test. Iterates through the (small — capped at 100ish) founder set
    and counts those NOT classified as needs_review."""
    active = 0
    cur = db.makers.find({"tier": "founder"})
    async for m in cur:
        a = await _activity_signals_for(m)
        if _classify(a["signals"]) == "active":
            active += 1
    return active


# --------------------------- Endpoints --------------------------- #
class SlotsDetail(BaseModel):
    active: int
    needs_review: int
    total_founders: int  # everyone still on tier=founder
    cap: int
    applications_open: bool


@router.get("/admin/founders/slots-detail", response_model=SlotsDetail)
async def slots_detail(_: dict = Depends(current_admin)):
    """Powers the admin dashboard "Founder Slots" card. Everything is
    computed live from the current DB state — no cached counters."""
    cap = await _get_slots_total()
    applications_open = await _get_applications_open()
    total = await db.makers.count_documents({"tier": "founder"})
    active = 0
    needs_review = 0
    cur = db.makers.find({"tier": "founder"})
    async for m in cur:
        a = await _activity_signals_for(m)
        if _classify(a["signals"]) == "active":
            active += 1
        else:
            needs_review += 1
    return SlotsDetail(
        active=active,
        needs_review=needs_review,
        total_founders=total,
        cap=cap,
        applications_open=applications_open,
    )


class FounderReviewRow(BaseModel):
    slug: str
    name: str
    shop_title: Optional[str] = None
    email: Optional[str] = None
    approved_at: Optional[str] = None       # aka founder_started_at
    last_login: Optional[str] = None
    total_products: int
    published_products: int
    last_product_update: Optional[str] = None
    sales_count: int
    signals: dict
    status: str  # "active" | "needs_review"
    founder_number: Optional[int] = None
    founder_status: Optional[str] = None    # inaugural / regular


class FounderReviewResponse(BaseModel):
    rows: list[FounderReviewRow]
    active: int
    needs_review: int
    cap: int
    applications_open: bool


@router.get("/admin/founders/review", response_model=FounderReviewResponse)
async def founder_review(_: dict = Depends(current_admin)):
    """Full list of Founder makers with activity metrics + verdict.

    Sorted so needs_review rows float to the top, then by
    founder_number ascending. Includes every founder — the admin decides
    what to do with each row."""
    cap = await _get_slots_total()
    applications_open = await _get_applications_open()

    rows: list[FounderReviewRow] = []
    active = 0
    needs_review = 0

    cur = db.makers.find({"tier": "founder"}).sort("founder_number", 1)
    async for m in cur:
        a = await _activity_signals_for(m)
        status = _classify(a["signals"])
        if status == "active":
            active += 1
        else:
            needs_review += 1
        rows.append(FounderReviewRow(
            slug=m.get("slug") or "",
            name=m.get("name") or "",
            shop_title=m.get("shop_title") or m.get("studio_name"),
            email=m.get("email"),
            approved_at=m.get("founder_started_at") or m.get("approved_at"),
            last_login=a["last_login"],
            total_products=a["total_products"],
            published_products=a["published_products"],
            last_product_update=a["last_product_update"],
            sales_count=a["sales_count"],
            signals=a["signals"],
            status=status,
            founder_number=m.get("founder_number"),
            founder_status=m.get("founder_status"),
        ))

    # Sort: needs_review first, then by founder_number ASC (nulls last).
    rows.sort(key=lambda r: (
        0 if r.status == "needs_review" else 1,
        r.founder_number if r.founder_number is not None else 10**6,
    ))

    return FounderReviewResponse(
        rows=rows,
        active=active,
        needs_review=needs_review,
        cap=cap,
        applications_open=applications_open,
    )


class DowngradeRequest(BaseModel):
    reason: Optional[str] = None


@router.post("/admin/founders/{slug}/downgrade")
async def downgrade_to_free(
    slug: str,
    body: DowngradeRequest,
    claims: dict = Depends(current_admin),
):
    """Move a Founder back to the Free tier — frees a slot without
    deleting anything.

    - Keeps the maker record and every product/listing intact.
    - Strips ``tier``, ``founder_status``, ``founder_number``, and any
      inflight founder expiry timestamps.
    - Appends an entry to ``activity_events`` for the audit trail.
    - Recomputes the applications gate but never auto-reopens it — an
      admin has to click "Reopen".
    """
    m = await db.makers.find_one({"slug": slug})
    if not m:
        raise HTTPException(404, "Maker not found.")
    if (m.get("tier") or "") != "founder":
        raise HTTPException(400, "This maker is not on the Founder tier.")

    prev_founder_number = m.get("founder_number")
    prev_status = m.get("founder_status")

    await db.makers.update_one(
        {"slug": slug},
        {
            "$set": {
                "tier": "standard",
                "founder_downgraded_at": now_iso(),
                "founder_downgraded_by": claims["email"],
                "founder_downgrade_reason": (body.reason or "").strip()[:400] or None,
            },
            "$unset": {
                "founder_status": "",
                "founder_number": "",
                "founder_started_at": "",
                "founder_expires_at": "",
                "founder_grace_until": "",
            },
        },
    )

    # Audit trail.
    await db.activity_events.insert_one({
        "id": str(uuid.uuid4()),
        "kind": "admin",
        "actor": claims["email"],
        "action": "founder_downgrade",
        "target_slug": slug,
        "target_founder_number": prev_founder_number,
        "target_founder_status": prev_status,
        "reason": (body.reason or "").strip()[:400] or None,
        "text": (
            f"{claims['email']} moved {slug} from Founder "
            f"(#{prev_founder_number or '?'}, {prev_status or '?'}) → Free"
        ),
        "created_at": now_iso(),
    })

    logger.info(
        "[founders] downgrade: %s → free (was #%s / %s) by %s",
        slug, prev_founder_number, prev_status, claims["email"],
    )

    # Applications gate: recount but do NOT auto-reopen.
    active = await _count_active_founders()
    cap = await _get_slots_total()

    return {
        "downgraded": True,
        "slug": slug,
        "active_founders_after": active,
        "cap": cap,
        "applications_open": await _get_applications_open(),
        "slots_available": max(0, cap - active),
    }


class GateRequest(BaseModel):
    open: bool


@router.post("/admin/founders/applications-gate")
async def set_applications_gate(
    body: GateRequest,
    claims: dict = Depends(current_admin),
):
    """Manual open/close of the Founder application gate.

    Reopening still respects the cap — if the marketplace is at or
    over the active-Founder cap, we surface a warning but honor the
    admin's decision (they may want to reopen at 88/100 to keep
    momentum during downgrade sweeps)."""
    await _set_applications_open(body.open, claims["email"])
    logger.info(
        "[founders] admin %s set applications_open=%s",
        claims["email"], body.open,
    )
    active = await _count_active_founders()
    cap = await _get_slots_total()
    return {
        "applications_open": body.open,
        "active_founders": active,
        "cap": cap,
        "at_or_over_cap": active >= cap,
    }
