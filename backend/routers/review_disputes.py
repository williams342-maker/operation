"""Maker → Admin review dispute lifecycle.

Two distinct maker actions on bad reviews:

  1. **Public response** (`POST /maker/reviews/{review_id}/response`)
     Maker writes a reply that's rendered below the review on every public
     surface. No admin approval needed — it's the maker's own published
     voice. Best for "I see how the experience missed expectations,
     here's how I made it right" replies.

  2. **Dispute** (`POST /maker/reviews/{review_id}/dispute`)
     Maker challenges a review they believe is unfair / fake / against
     policy. Goes into the admin queue. Admin resolves to either:
       - upheld → review is deleted (silent)
       - denied → review stays; status reflected on the review

Public listings include `maker_response` if set. Disputes are NEVER
shown publicly (they're between the maker and the admin team).
"""
from __future__ import annotations
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from typing import Optional

from core import db, logger, now_iso
from email_service import send_admin_broadcast
from maker_auth import current_admin, current_maker_slug
from models import (
    REVIEW_DISPUTE_REASONS,
    ReviewDispute, ReviewDisputeCreate, ReviewDisputeResolve,
    ReviewMakerResponseCreate,
)

router = APIRouter()


# ───── Maker endpoints ────────────────────────────────────────────────
@router.get("/maker/reviews")
async def maker_list_reviews(slug: str = Depends(current_maker_slug)):
    """All reviews (across all listings) for the signed-in maker, newest first.
    Includes the dispute status so the dashboard can show "DISPUTED" /
    "UPHELD" / "DENIED" badges next to each review."""
    rows = await db.reviews.find(
        {"maker_slug": slug},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    return {"items": rows, "count": len(rows)}


@router.post("/maker/reviews/{review_id}/response")
async def maker_post_response(
    review_id: str, body: ReviewMakerResponseCreate,
    slug: str = Depends(current_maker_slug),
):
    """Public response from the maker — rendered below the review."""
    rev = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    if not rev:
        raise HTTPException(404, "Review not found")
    if rev.get("maker_slug") != slug:
        raise HTTPException(403, "You can only respond to your own reviews.")
    txt = body.response.strip()
    update: dict
    if txt:
        update = {"maker_response": txt, "maker_response_at": now_iso()}
    else:
        # Empty string clears the response (maker may want to retract).
        update = {"maker_response": None, "maker_response_at": None}
    await db.reviews.update_one({"id": review_id}, {"$set": update})
    return {"ok": True, "maker_response": update.get("maker_response")}


@router.post("/maker/reviews/{review_id}/dispute", response_model=ReviewDispute)
async def maker_create_dispute(
    review_id: str, body: ReviewDisputeCreate,
    bg: BackgroundTasks,
    slug: str = Depends(current_maker_slug),
):
    """Open a dispute on a review the maker believes is unfair."""
    rev = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    if not rev:
        raise HTTPException(404, "Review not found")
    if rev.get("maker_slug") != slug:
        raise HTTPException(403, "You can only dispute reviews on your own listings.")

    if body.reason not in REVIEW_DISPUTE_REASONS:
        raise HTTPException(
            400, f"Invalid reason. Allowed: {', '.join(REVIEW_DISPUTE_REASONS)}",
        )

    # Block repeat open disputes on the same review.
    existing = await db.review_disputes.find_one(
        {"review_id": review_id, "status": "open"}, {"_id": 0},
    )
    if existing:
        raise HTTPException(
            409, "You already have an open dispute on this review.",
        )

    dispute = ReviewDispute(
        review_id=review_id,
        maker_slug=slug,
        review_snapshot={
            "name": rev.get("name"),
            "rating": rev.get("rating"),
            "text": rev.get("text"),
            "created_at": rev.get("created_at"),
            "product_slug": rev.get("product_slug"),
        },
        reason=body.reason,
        explanation=body.explanation.strip(),
    )
    doc = dispute.model_dump()
    await db.review_disputes.insert_one(dict(doc))
    await db.reviews.update_one(
        {"id": review_id},
        {"$set": {"dispute_status": "open", "dispute_id": doc["id"]}},
    )

    # Alert ops so a human looks at it. Email subject prefixed with the
    # rating so triage by sev is obvious in a packed inbox.
    rating = int(rev.get("rating") or 0)
    bg.add_task(
        send_admin_broadcast,
        # Goes to OPS_EMAIL via the helper's default routing
        "team@craftersmarket.org",
        f"Review dispute · {rating}★ · {slug}",
        f"{slug} disputed a {rating}-star review.\n\n"
        f"Reason: {body.reason.replace('_', ' ')}\n\n"
        f"Maker explanation:\n{body.explanation}\n\n"
        f"Original review by {rev.get('name')}:\n\"{rev.get('text')}\"\n\n"
        "Resolve at /admin/dashboard → Review Disputes.",
        "New review dispute",
        f"Review dispute filed by {slug}",
    )
    logger.info("review dispute · maker=%s review=%s reason=%s", slug, review_id, body.reason)
    return dispute


# ───── Admin endpoints ────────────────────────────────────────────────
@router.get("/admin/review-disputes")
async def admin_list_disputes(
    status: Optional[str] = None, limit: int = 100,
    _: dict = Depends(current_admin),
):
    flt: dict = {}
    if status in ("open", "upheld", "denied"):
        flt["status"] = status
    rows = await db.review_disputes.find(
        flt, {"_id": 0},
    ).sort("created_at", -1).to_list(max(1, min(limit, 500)))
    # Attach maker name so admins don't have to mentally translate slugs.
    if rows:
        slugs = list({r["maker_slug"] for r in rows})
        makers = await db.makers.find(
            {"slug": {"$in": slugs}}, {"_id": 0, "slug": 1, "name": 1},
        ).to_list(len(slugs))
        m_by_slug = {m["slug"]: m.get("name") or m["slug"] for m in makers}
        for r in rows:
            r["maker_name"] = m_by_slug.get(r["maker_slug"], r["maker_slug"])
    return {"items": rows, "count": len(rows)}


@router.post("/admin/review-disputes/{dispute_id}/resolve")
async def admin_resolve_dispute(
    dispute_id: str, body: ReviewDisputeResolve,
    bg: BackgroundTasks, claims: dict = Depends(current_admin),
):
    """Close a dispute. `upheld` = remove the review; `denied` = leave it
    in place but mark the dispute resolved."""
    d = await db.review_disputes.find_one({"id": dispute_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Dispute not found")
    if d.get("status") != "open":
        raise HTTPException(400, f"Dispute already {d.get('status')}.")

    upd: dict = {
        "status": body.status,
        "resolved_at": now_iso(),
        "resolved_by": claims["email"],
        "admin_note": (body.admin_note or "").strip()[:1000],
    }
    await db.review_disputes.update_one({"id": dispute_id}, {"$set": upd})

    rev = await db.reviews.find_one({"id": d["review_id"]}, {"_id": 0})
    if body.status == "upheld":
        # Remove the review from the public-facing collection.
        if rev:
            await db.reviews.delete_one({"id": d["review_id"]})
        else:
            logger.warning("review dispute upheld but review %s already gone", d["review_id"])
    else:
        # Denied — review stays, but flip its dispute_status so the
        # maker dashboard reflects the outcome.
        if rev:
            await db.reviews.update_one(
                {"id": d["review_id"]},
                {"$set": {"dispute_status": "denied"}},
            )

    # Notify the maker of the outcome
    maker = await db.makers.find_one(
        {"slug": d["maker_slug"]},
        {"_id": 0, "email": 1, "name": 1},
    )
    if maker and maker.get("email"):
        snap = d.get("review_snapshot", {})
        verdict = "Upheld — the review was removed." if body.status == "upheld" else "Denied — the review will stay published."
        bg.add_task(
            send_admin_broadcast,
            maker["email"],
            f"Review dispute · {body.status.capitalize()}",
            (
                f"Your dispute on the {snap.get('rating', '?')}-star review by "
                f"{snap.get('name', 'a buyer')} has been resolved.\n\n"
                f"Verdict: {verdict}\n"
                + (f"\nNote from the team: {upd['admin_note']}\n" if upd['admin_note'] else "")
                + "\nIf you'd like to add a public response to this review (or the original is now removed, no further action needed), open your Maker Dashboard → Reviews."
            ),
            "Dispute resolution",
            f"Crafters Market · review dispute {body.status}",
        )
    return {"ok": True, "status": body.status}
