"""iter413bw — Maker Brand Kit (Garage Builders identity).

Three endpoints:
  POST /maker/brand-kit/apply     — maker opts in; sets brand_kit_applied=True
                                    and timestamps it. Idempotent.
  POST /maker/brand-kit/dismiss   — maker permanently hides the dashboard
                                    card. Sets brand_kit_dismissed=True.
                                    No effect on `brand_kit_applied`.
  GET  /admin/brand-kit/adoption  — admin-only adoption stats card.
                                    Returns {approved, applied, dismissed,
                                    pending, applied_pct}.

The card is *only* surfaced on the maker dashboard for approved sellers.
It never blocks any maker flow — pure identity / belonging signal.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from core import db
from maker_auth import current_admin, current_maker_slug

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("/maker/brand-kit/apply")
async def maker_brand_kit_apply(slug: str = Depends(current_maker_slug)):
    """Maker opts into displaying the Garage Builders badge on their
    public profile. Idempotent — re-applying is a no-op + same response."""
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found")
    # Only approved sellers can apply the badge. (The dashboard only
    # renders the card for them, but enforce server-side too in case
    # of a stale tab.)
    if maker.get("status") not in ("approved",) and not maker.get("approved_at"):
        raise HTTPException(403, "Approved makers only")
    # Compute applied_at ONCE so DB write + response carry the same value.
    # Without this, two `_now_iso()` calls produced different microseconds
    # and the idempotent re-apply path returned a timestamp that no longer
    # matched the persisted value.
    applied_at = maker.get("brand_kit_applied_at") or _now_iso()
    res = await db.makers.update_one(
        {"slug": slug},
        {"$set": {
            "brand_kit_applied": True,
            "brand_kit_applied_at": applied_at,
        }},
    )
    return {
        "ok": True,
        "applied": True,
        "applied_at": applied_at,
        "newly_applied": res.modified_count > 0,
    }


@router.post("/maker/brand-kit/dismiss")
async def maker_brand_kit_dismiss(slug: str = Depends(current_maker_slug)):
    """Permanently hide the brand-kit card on the dashboard. Does NOT
    undo a prior `apply` — a maker can still wear the badge on their
    public page while never seeing the card again."""
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"brand_kit_dismissed": True}},
    )
    return {"ok": True, "dismissed": True}


@router.get("/admin/brand-kit/adoption")
async def admin_brand_kit_adoption(_: dict = Depends(current_admin)):
    """Adoption funnel for the brand kit. Used by the admin Ops
    dashboard to gauge whether the identity push is landing."""
    approved = await db.makers.count_documents({"status": "approved"})
    applied = await db.makers.count_documents({
        "status": "approved", "brand_kit_applied": True,
    })
    dismissed = await db.makers.count_documents({
        "status": "approved", "brand_kit_dismissed": True,
        "brand_kit_applied": {"$ne": True},
    })
    pending = max(0, approved - applied - dismissed)
    return {
        "approved":    approved,
        "applied":     applied,
        "dismissed":   dismissed,
        "pending":     pending,
        "applied_pct": round(100 * applied / approved, 1) if approved else 0.0,
    }
