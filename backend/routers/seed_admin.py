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


@router.post("/admin/seed/featured-content/install-fixture")
async def install_featured_seed_fixture(_: dict = Depends(current_admin)):
    """One-click "populate this database from the curated seed fixture."

    Reads `/app/backend/data/featured_seed_fixture.json` — a static
    snapshot of preview's seeded makers + products + forum threads +
    replies + showcase posts — and upserts each doc into Mongo. Use
    after a fresh production redeploy to fill an empty catalogue with
    the same content visitors see in preview.

    Idempotent: upserts by `slug` (makers/products) or `id` (forum
    docs/showcase) so re-running just refreshes any stale fields. No
    LLM calls, no image generation — the static images at
    `/seed-images/featured/*.jpg` ship with the frontend build, and
    this endpoint only writes the database rows that reference them.
    """
    import json
    from pathlib import Path

    fixture_path = Path("/app/backend/data/featured_seed_fixture.json")
    if not fixture_path.exists():
        return {"ok": False, "error": "fixture file missing from deploy artifact"}

    fixture = json.loads(fixture_path.read_text())

    counts = {"makers": 0, "products": 0, "threads": 0, "replies": 0, "showcase": 0}

    # Makers — upsert by slug. Existing docs keep their _id but pick up
    # any fixture field changes (e.g. bio tweaks, new portrait paths).
    for m in fixture.get("makers", []):
        await db.makers.update_one({"slug": m["slug"]}, {"$set": m}, upsert=True)
        counts["makers"] += 1

    # Products — upsert by slug. Same pattern; the unique key is the slug
    # because product `id` may differ between environments while slugs
    # are stable and part of the URL.
    for p in fixture.get("products", []):
        await db.products.update_one({"slug": p["slug"]}, {"$set": p}, upsert=True)
        counts["products"] += 1

    # Forum threads, replies, and showcase posts — upsert by id. These
    # don't have a natural unique key besides the UUID, so we lean on
    # the fixture's frozen ids to keep cross-env consistency.
    for t in fixture.get("forum_threads", []):
        await db.forum_threads.update_one({"id": t["id"]}, {"$set": t}, upsert=True)
        counts["threads"] += 1
    for r in fixture.get("forum_replies", []):
        await db.forum_replies.update_one({"id": r["id"]}, {"$set": r}, upsert=True)
        counts["replies"] += 1
    for s in fixture.get("showcase_posts", []):
        await db.showcase_posts.update_one({"id": s["id"]}, {"$set": s}, upsert=True)
        counts["showcase"] += 1

    # Refresh listings_count on each seeded maker so shop tiles reflect
    # reality immediately. Mirrors the standalone script's behaviour.
    for slug in {p["maker_slug"] for p in fixture.get("products", []) if p.get("maker_slug")}:
        n = await db.products.count_documents(
            {"maker_slug": slug, "status": "published", "deleted_at": None},
        )
        await db.makers.update_one({"slug": slug}, {"$set": {"listings_count": n}})

    return {"ok": True, "installed": counts, "totals_now": {
        "featured_makers": await db.makers.count_documents({"featured_example": True}),
        "featured_products": await db.products.count_documents({"featured_example": True}),
        "seeded_threads": await db.forum_threads.count_documents({"is_seed": True}),
        "seeded_replies": await db.forum_replies.count_documents({"is_seed": True}),
        "seeded_showcase": await db.showcase_posts.count_documents({"is_seed": True}),
    }}


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


@router.post("/admin/seed/featured-content/run-weekly-thread")
async def run_weekly_forum_thread(_: dict = Depends(current_admin)):
    """Manual trigger for the weekly forum-thread seeder. Same code path
    as the Tuesday 14:00 UTC cron job, exposed here so admins can pull
    a fresh thread on demand (e.g., during a slow news week, or to
    pre-seed before launching a marketing push)."""
    from weekly_forum_seeder import seed_weekly_thread
    return await seed_weekly_thread()


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
