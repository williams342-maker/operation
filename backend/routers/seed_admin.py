"""Admin endpoints for managing platform seed content (the "Featured
Example" listings and "Founding Maker · Platform Showcase" profiles).

These docs all carry `featured_example: true` and are visually badged in
the UI so visitors are never misled. Once organic listings fill the
catalogue, the admin can purge every seeded row in a single call —
nothing organic is touched because the query is gated on the flag.
"""
from fastapi import APIRouter, Depends
from maker_auth import current_admin
from core import db

router = APIRouter()


@router.get("/admin/seed/featured-content/status")
async def featured_seed_status(_: dict = Depends(current_admin)):
    """Quick counts so the admin UI can render a "what would purge" line
    before they pull the trigger."""
    return {
        "featured_makers": await db.makers.count_documents({"featured_example": True}),
        "featured_products": await db.products.count_documents({"featured_example": True}),
        "published_featured_products": await db.products.count_documents(
            {"featured_example": True, "status": "published", "deleted_at": None},
        ),
    }


@router.post("/admin/seed/featured-content/attribute-workshop-team")
async def attribute_workshop_team(_: dict = Depends(current_admin)):
    """Backfill `user_name = "Crafters Market Workshop Team"` on every
    seeded community doc (`is_seed: true`). Idempotent — re-running is a
    no-op once everything is attributed. Use this on production after a
    redeploy so the amber Workshop Team byline appears on every curated
    forum thread, reply, and showcase post.

    Scoped strictly to `is_seed: true` rows so organic posts authored by
    real members are never touched, no matter how many times this runs.
    """
    WORKSHOP_NAME = "Crafters Market Workshop Team"
    WORKSHOP_EMAIL = "workshop@craftersmarket.org"

    threads = await db.forum_threads.update_many(
        {"is_seed": True},
        {"$set": {"user_name": WORKSHOP_NAME, "user_email": WORKSHOP_EMAIL}},
    )
    replies = await db.forum_replies.update_many(
        {"is_seed": True},
        {"$set": {"user_name": WORKSHOP_NAME, "user_email": WORKSHOP_EMAIL}},
    )
    showcase = await db.showcase_posts.update_many(
        {"is_seed": True},
        {"$set": {"user_name": WORKSHOP_NAME, "user_email": WORKSHOP_EMAIL}},
    )
    return {
        "ok": True,
        "threads_updated": threads.modified_count,
        "replies_updated": replies.modified_count,
        "showcase_updated": showcase.modified_count,
        "totals": {
            "forum_threads_tagged": await db.forum_threads.count_documents({"is_seed": True}),
            "forum_replies_tagged": await db.forum_replies.count_documents({"is_seed": True}),
            "showcase_posts_tagged": await db.showcase_posts.count_documents({"is_seed": True}),
        },
    }


@router.post("/admin/seed/featured-content/purge")
async def purge_featured_seed(_: dict = Depends(current_admin)):
    """Hard-delete every doc tagged `featured_example: true`. Intentionally
    NOT a soft-delete — these are platform-owned demo rows, not maker
    work, so there's nothing to recover. Organic listings (which never
    carry the flag) are untouched.

    Returns the counts that were removed so the admin sees exact impact.
    """
    pres_makers = await db.makers.count_documents({"featured_example": True})
    pres_products = await db.products.count_documents({"featured_example": True})

    p_res = await db.products.delete_many({"featured_example": True})
    m_res = await db.makers.delete_many({"featured_example": True})

    return {
        "ok": True,
        "deleted_products": p_res.deleted_count,
        "deleted_makers": m_res.deleted_count,
        "pre_purge_counts": {
            "makers": pres_makers,
            "products": pres_products,
        },
    }
