"""Admin endpoints for managing platform seed content (the "Featured
Example" listings and "Founding Maker · Platform Showcase" profiles).

These docs all carry `featured_example: true` and are visually badged in
the UI so visitors are never misled. Once organic listings fill the
catalogue, the admin can purge every seeded row in a single call —
nothing organic is touched because the query is gated on the flag.
"""
from fastapi import APIRouter, Depends, HTTPException
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
