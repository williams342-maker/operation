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


# ===========================================================================
# Community design-file seed (the AI-generated Workshop Team design library)
# ===========================================================================
@router.get("/admin/seed/community-designs/status")
async def community_designs_seed_status(_: dict = Depends(current_admin)):
    """Counts so the admin UI can preview impact before install/purge."""
    orphan_q = {
        "is_seed": True,
        "file_verified": {"$ne": True},
        "$or": [
            {"thumbnail_url": {"$regex": "^/seed-designs/"}},
            {"thumbnail_url": None},
            {"thumbnail_url": ""},
        ],
    }
    return {
        "seeded_designs": await db.design_files.count_documents({"is_seed": True}),
        "total_designs": await db.design_files.count_documents({"quarantined_at": None}),
        "orphan_seeds": await db.design_files.count_documents(orphan_q),
    }


@router.post("/admin/seed/community-designs/install-fixture")
async def install_community_designs_seed(_: dict = Depends(current_admin)):
    """One-click install of the curated Workshop Team design library
    from `/app/backend/data/community_designs_seed.json`. Upserts by
    `slug` (a seed-only field) so re-running is idempotent — existing
    download counts are preserved by the fixture builder.

    The SVG / DXF / preview JPG that each row references all ship with
    the frontend deploy artifact under `/seed-designs/<slug>/`, so this
    endpoint touches MongoDB only — no R2 uploads, no LLM calls.
    """
    import json
    from pathlib import Path

    fixture_path = Path("/app/backend/data/community_designs_seed.json")
    if not fixture_path.exists():
        return {"ok": False, "error": "fixture file missing from deploy artifact"}

    fixture = json.loads(fixture_path.read_text())
    rows = fixture.get("design_files", [])
    installed = 0
    for d in rows:
        # Preserve existing `downloads` count on re-install so the
        # leaderboard / trending rail doesn't reset to zero on every
        # redeploy.
        existing = await db.design_files.find_one(
            {"slug": d["slug"], "is_seed": True},
            {"_id": 0, "downloads": 1, "created_at": 1, "id": 1},
        )
        doc = dict(d)
        if existing:
            doc["downloads"] = existing.get("downloads", doc.get("downloads", 0))
            doc["created_at"] = existing.get("created_at", doc.get("created_at"))
            doc["id"] = existing.get("id", doc["id"])
        await db.design_files.update_one({"slug": d["slug"]}, {"$set": doc}, upsert=True)
        installed += 1

    return {
        "ok": True,
        "installed": installed,
        "totals_now": {
            "seeded_designs": await db.design_files.count_documents({"is_seed": True}),
            "total_designs": await db.design_files.count_documents({"quarantined_at": None}),
        },
    }


@router.post("/admin/seed/community-designs/purge")
async def purge_community_designs_seed(_: dict = Depends(current_admin)):
    """Hard-delete every seeded community design (`is_seed: true` on
    `design_files`). Organic uploads have no `is_seed` flag so they
    stay untouched.
    """
    pre = await db.design_files.count_documents({"is_seed": True})
    res = await db.design_files.delete_many({"is_seed": True})
    return {
        "ok": True,
        "deleted": res.deleted_count,
        "pre_purge_count": pre,
    }


@router.post("/admin/seed/community-designs/generate-one")
async def generate_one_community_design(_: dict = Depends(current_admin)):
    """Generate ONE fresh AI-driven design file and insert it into the
    public `design_files` library. Picks the least-used parametric
    template, has Gemini Flash fill in the creative copy + parameters,
    then composes a real SVG + DXF + Nano-Banana preview JPG.

    Mirrors the "Seed fresh thread now" pattern — same admin gating,
    same return shape, designed to be hit on demand whenever the library
    needs another piece of variety.
    """
    from design_file_seeder import generate_one_design
    return await generate_one_design()


@router.post("/admin/seed/community-designs/generate-batch")
async def generate_batch_community_designs(
    count: int = 5,
    _: dict = Depends(current_admin),
):
    """Generate N (default 5, max 10) fresh AI designs back-to-back.

    Useful for fresh-deploy populates when the admin wants the library
    to feel lived-in immediately. Runs sequentially (not parallel) so
    the round-robin picker stays balanced — each call sees the rows
    written by the previous one and picks the next least-used template.

    Failures of a single design don't abort the batch — we collect
    successes + errors and return them all so the admin sees exactly
    what landed.
    """
    from design_file_seeder import generate_one_design
    n = max(1, min(int(count or 5), 10))
    successes: list = []
    errors: list = []
    for i in range(n):
        try:
            r = await generate_one_design()
            successes.append(r["design"])
        except Exception as e:
            errors.append({"index": i, "error": str(e)})
    return {"status": "ok", "requested": n, "succeeded": len(successes),
            "failed": len(errors), "designs": successes, "errors": errors}


# ===========================================================================
# Clip Feed seed — Sora 2 generated short-form workshop videos.
# ===========================================================================
@router.get("/admin/seed/clips/status")
async def clips_seed_status(_: dict = Depends(current_admin)):
    orphan_q = {
        "is_seed": True,
        "file_verified": {"$ne": True},
        "$or": [
            {"video_url": {"$regex": "^/seed-clips/"}},
            {"video_url": None},
            {"video_url": ""},
        ],
    }
    return {
        "seeded_clips": await db.clips.count_documents({"is_seed": True}),
        "ai_clips": await db.clips.count_documents({"ai_generated": True}),
        "total_clips": await db.clips.count_documents({"quarantined_at": None}),
        "orphan_seeds": await db.clips.count_documents(orphan_q),
    }


@router.post("/admin/seed/clips/generate-one")
async def generate_one_clip(
    model: str = "sora-2-pro",
    _: dict = Depends(current_admin),
):
    """Render ONE fresh Sora-2 seed clip. Vertical 9:16, 8s. Blocks for
    2-5 minutes — admin UI should use a long timeout. Picks the
    least-used (category, prompt) combo so the feed stays diverse."""
    from clip_seeder import generate_one_clip as _go
    if model not in ("sora-2", "sora-2-pro"):
        raise HTTPException(422, "Model must be sora-2 or sora-2-pro.")
    return await _go(model=model)


@router.post("/admin/seed/clips/purge")
async def purge_clips_seed(_: dict = Depends(current_admin)):
    """Hard-delete every seeded clip + its engagement rows. Organic
    maker uploads (no `is_seed` flag) stay untouched."""
    ids: list[str] = []
    async for d in db.clips.find({"is_seed": True}, {"_id": 0, "id": 1}):
        ids.append(d["id"])
    if ids:
        await db.clip_engagement.delete_many({"clip_id": {"$in": ids}})
    res = await db.clips.delete_many({"is_seed": True})
    return {"ok": True, "deleted": res.deleted_count}


@router.post("/admin/seed/clips/purge-orphans")
async def purge_orphan_clips_seed(_: dict = Depends(current_admin)):
    """iter218 — targeted cleanup: hard-delete ONLY orphan seed rows
    (is_seed=true rows that lack `file_verified=true` AND have a local
    `/seed-clips/` `video_url`). These are leftover DB rows from prior
    Sora generations whose MP4 file never made it to the deploy artifact
    — they render as black-screen panels on /clips. Keeps any future
    seed rows that explicitly carry `file_verified=true` (the new
    seeder always sets this) so admins don't accidentally nuke a working
    library while clearing the broken ones.

    Returns the deleted slugs so the operator can confirm what was
    cleared in a single glance.
    """
    orphan_query = {
        "is_seed": True,
        "file_verified": {"$ne": True},
        "$or": [
            {"video_url": {"$regex": "^/seed-clips/"}},
            {"video_url": None},
            {"video_url": ""},
        ],
    }
    orphans: list[dict] = []
    async for d in db.clips.find(orphan_query, {"_id": 0, "id": 1, "slug": 1, "title": 1}):
        orphans.append(d)
    ids = [o["id"] for o in orphans]
    if ids:
        await db.clip_engagement.delete_many({"clip_id": {"$in": ids}})
    res = await db.clips.delete_many(orphan_query)
    return {
        "ok": True,
        "deleted": res.deleted_count,
        "slugs": [o.get("slug") for o in orphans],
    }


@router.post("/admin/seed/community-designs/purge-orphans")
async def purge_orphan_design_seed(_: dict = Depends(current_admin)):
    """iter221 — targeted cleanup for community design files. Hard-deletes
    seed rows (is_seed=true) whose `thumbnail_url` points to a local
    `/seed-designs/` path AND lack `file_verified=true`. These are
    leftover from earlier Nano Banana preview generations that half-failed
    or whose files never reached the production deploy artifact — they
    render as broken-image cards on /community Design Files tab.

    Preserves: verified seeds (file_verified=true), externally-hosted
    seeds (https thumbnails), and ALL organic uploads.
    """
    orphan_query = {
        "is_seed": True,
        "file_verified": {"$ne": True},
        "$or": [
            {"thumbnail_url": {"$regex": "^/seed-designs/"}},
            {"thumbnail_url": None},
            {"thumbnail_url": ""},
        ],
    }
    orphans: list[dict] = []
    async for d in db.design_files.find(orphan_query, {"_id": 0, "id": 1, "slug": 1, "title": 1}):
        orphans.append(d)
    ids = [o["id"] for o in orphans]
    if ids:
        # Wipe associated download logs so download-count rebuilds cleanly.
        await db.download_logs.delete_many({"file_id": {"$in": ids}})
    res = await db.design_files.delete_many(orphan_query)
    return {
        "ok": True,
        "deleted": res.deleted_count,
        "slugs": [o.get("slug") for o in orphans],
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
