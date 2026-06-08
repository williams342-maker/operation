"""Admin endpoints for managing platform seed content (the "Featured
Example" listings and "Founding Maker · Platform Showcase" profiles).

These docs all carry `featured_example: true` and are visually badged in
the UI so visitors are never misled. Once organic listings fill the
catalogue, the admin can purge every seeded row in a single call —
nothing organic is touched because the query is gated on the flag.
"""
import asyncio
import logging
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException
from maker_auth import current_admin
from core import db, now_iso

router = APIRouter()
_log = logging.getLogger("crafters.seed_admin")


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

    # iter326 — Bump `platform_meta.founder_counter` to AT LEAST the max
    # founder_number embedded in the fixture. Without this, the seeded
    # makers occupy slots #1..#N but `founder_counter` stays at 0, so
    # the next maker approved by the live `/api/admin/maker-applications/
    # approve` flow gets #1 and COLLIDES with Iron & Oak Studio. Use
    # `$max` so it's idempotent across re-runs and never accidentally
    # lowers a counter that's already grown past the fixture.
    max_seed_number = 0
    for m in fixture.get("makers", []):
        n = int(m.get("founder_number") or 0)
        if n > max_seed_number:
            max_seed_number = n
    if max_seed_number > 0:
        await db.platform_meta.update_one(
            {"key": "founder_counter"},
            {"$max": {"value": max_seed_number}},
            upsert=True,
        )

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
    # iter225 — orphan = local `/seed-clips/...` path (file is ephemeral
    # and almost certainly gone post-restart) OR null/empty video_url
    # without file_verified. Matches the purge-orphans endpoint logic.
    orphan_q = {
        "is_seed": True,
        "$or": [
            {"file_verified": {"$ne": True}, "video_url": None},
            {"file_verified": {"$ne": True}, "video_url": ""},
            {"video_url": {"$regex": "^/seed-clips/"}},
        ],
    }
    # iter344b — per-category counts of visible (non-quarantined) clips so
    # the Admin "Variety health" indicator can spot a feed silently
    # re-skewing to one or two categories (e.g. Sora's content mod
    # repeatedly rejecting "knife-making" so the round-robin never lands
    # a successful render in that bucket).
    from routers.clips import CATEGORIES
    pipeline = [
        {"$match": {"quarantined_at": None}},
        {"$group": {"_id": "$category", "n": {"$sum": 1}}},
    ]
    cat_counts: dict[str, int] = {}
    async for row in db.clips.aggregate(pipeline):
        if row["_id"]:
            cat_counts[row["_id"]] = row["n"]
    category_health = [
        {"id": c["id"], "label": c["label"], "emoji": c["emoji"], "count": cat_counts.get(c["id"], 0)}
        for c in CATEGORIES
    ]
    return {
        "seeded_clips": await db.clips.count_documents({"is_seed": True}),
        "ai_clips": await db.clips.count_documents({"ai_generated": True}),
        "total_clips": await db.clips.count_documents({"quarantined_at": None}),
        "orphan_seeds": await db.clips.count_documents(orphan_q),
        "category_health": category_health,
    }


@router.post("/admin/seed/clips/generate-one")
async def generate_one_clip(
    model: str = "sora-2-pro",
    _: dict = Depends(current_admin),
):
    """iter310 — Enqueue a background Sora-2 render and return a job id
    immediately so the HTTP response never exceeds Cloudflare's ~100s
    edge timeout. The actual render still takes 2-5 min; the frontend
    polls `GET /admin/seed/clips/job/{job_id}` until the job resolves.

    Previously the endpoint blocked the request for the full render
    duration → on production (CDN-fronted) the connection was always
    killed before Sora returned, surfacing as a generic "Network error"
    even though the render may have completed server-side and inserted
    a clip row.
    """
    if model not in ("sora-2", "sora-2-pro"):
        raise HTTPException(422, "Model must be sora-2 or sora-2-pro.")
    # iter322 — Sora-2-pro queue is currently saturating its 900s wait
    # ceiling on virtually every render. Until upstream capacity recovers
    # we hard-reject pro requests with a clear message instead of letting
    # the operator wait 15 minutes for the inevitable timeout. Flip the
    # env var to re-enable pro once Sora capacity is healthy.
    if model == "sora-2-pro" and os.environ.get("SORA_DISABLE_PRO", "true").lower() in ("true", "1", "yes"):
        raise HTTPException(
            422,
            "sora-2-pro is temporarily disabled (queue exceeded its 900s wait ceiling on recent attempts). "
            "Use sora-2 base instead, or unset SORA_DISABLE_PRO when Sora pro capacity recovers.",
        )

    job_id = str(uuid.uuid4())
    await db.clip_seed_jobs.insert_one({
        "job_id": job_id,
        "status": "queued",
        "model": model,
        "started_at": now_iso(),
        "finished_at": None,
        "clip": None,
        "reason": None,
        "detail": None,
    })

    async def _runner():
        from clip_seeder import generate_one_clip as _go
        await db.clip_seed_jobs.update_one(
            {"job_id": job_id},
            {"$set": {"status": "running"}},
        )
        try:
            result = await _go(model=model)
            patch = {
                "status": "done" if result.get("status") == "ok" else "error",
                "finished_at": now_iso(),
                "clip": result.get("clip"),
                "reason": result.get("reason"),
                "detail": result.get("detail"),
                # iter322 — per-attempt diagnostics. Empty list when the
                # primary attempt succeeded with no retry; otherwise
                # carries one row per attempt with {model, ok, elapsed_s,
                # error}. Surfaced in the "Last 5 renders" admin panel
                # so the operator can see both pro + fallback outcomes.
                "attempts": result.get("attempts") or [],
            }
        except Exception as e:
            _log.exception("[seed_admin] clip job %s crashed", job_id)
            patch = {
                "status": "error",
                "finished_at": now_iso(),
                "reason": "internal error",
                "detail": str(e),
                "attempts": [],
            }
        await db.clip_seed_jobs.update_one({"job_id": job_id}, {"$set": patch})

    asyncio.create_task(_runner())
    return {"job_id": job_id, "status": "queued"}


@router.get("/admin/seed/clips/job/{job_id}")
async def get_clip_seed_job(job_id: str, _: dict = Depends(current_admin)):
    """Poll a background clip-render job. Returns the same `{status,
    clip, reason}` shape the old synchronous endpoint used so the UI
    can render the existing toasts once `status` flips to `done` or
    `error`."""
    job = await db.clip_seed_jobs.find_one({"job_id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(404, "Job not found.")
    return job


@router.get("/admin/seed/clips/jobs/recent")
async def list_recent_clip_seed_jobs(
    limit: int = 5,
    _: dict = Depends(current_admin),
):
    """iter310c — Most recent clip-render jobs for the admin "Last N
    renders" strip. Lets the operator spot recurring failures (Sora
    queue congestion, budget creep) without re-clicking Generate.
    """
    limit = max(1, min(limit, 25))
    cursor = db.clip_seed_jobs.find({}, {"_id": 0}).sort("started_at", -1).limit(limit)
    return {"jobs": [j async for j in cursor]}


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
    """iter218 + iter225 — targeted cleanup: hard-delete seed rows that
    can't render in production.

    Original iter218 criterion: `is_seed=True` AND missing `file_verified`
    AND has a local `/seed-clips/` (or empty) `video_url`.

    iter225 hardening: ALSO purge seed rows whose `video_url` is a local
    `/seed-clips/...` path *regardless* of `file_verified`. The flag is
    set at seed-time but the pod's filesystem is ephemeral — a redeploy
    or restart loses the MP4 while leaving the DB row claiming verified.
    Result on prod: clip card renders with a black `<video>` element
    (404 on the static path). The hardened orphan-guard in
    routers/clips.py now hides these from the feed at query time; this
    endpoint deletes them permanently so the orphan_seeds counter on
    the admin status card clears.

    Returns the deleted slugs so the operator can confirm what was
    cleared in a single glance.
    """
    orphan_query = {
        "is_seed": True,
        "$or": [
            # Original case: local path AND not verified
            {"file_verified": {"$ne": True}, "video_url": {"$regex": "^/seed-clips/"}},
            # Original case: null/empty video_url
            {"file_verified": {"$ne": True}, "video_url": None},
            {"file_verified": {"$ne": True}, "video_url": ""},
            # iter225: local path EVEN IF verified — ephemeral FS killed it.
            {"video_url": {"$regex": "^/seed-clips/"}},
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


@router.post("/admin/seed/community-designs/migrate-to-r2")
async def migrate_seed_designs_to_r2(_: dict = Depends(current_admin)):
    """iter262 — Walk every seed design whose URLs still point at the
    ephemeral `/seed-designs/<slug>/...` local path, re-upload the local
    files to R2, and rewrite the DB row's URLs to the absolute CDN
    addresses. After migration the files survive pod restarts.

    Rows where the local files no longer exist on this pod (e.g. they
    were generated by a previous pod that's since been recycled) get
    their `file_verified` flipped to False so the orphan-guard hides
    them from the public listing until either the files are
    regenerated or the row is purged.
    """
    import r2_storage
    from pathlib import Path

    SEED_DIR = Path("/app/frontend/public/seed-designs")
    candidates = await db.design_files.find(
        {
            "is_seed": True,
            "$or": [
                {"thumbnail_url": {"$regex": "^/seed-designs/"}},
                {"download_url": {"$regex": "^/seed-designs/"}},
            ],
        },
        {"_id": 0, "id": 1, "slug": 1, "thumbnail_url": 1, "download_url": 1, "variants": 1},
    ).to_list(2000)

    migrated = 0
    orphaned = 0
    failed: list[str] = []

    for row in candidates:
        slug = row.get("slug")
        if not slug:
            continue
        folder = SEED_DIR / slug
        svg_local = folder / "design.svg"
        dxf_local = folder / "design.dxf"
        preview_local = folder / "preview.jpg"

        # If the local files are gone, this row is an orphan that the
        # previous pod generated. Hide it until someone regenerates.
        if not (svg_local.exists() and dxf_local.exists() and preview_local.exists()):
            await db.design_files.update_one(
                {"id": row["id"]},
                {"$set": {"file_verified": False}},
            )
            orphaned += 1
            continue

        updates: dict = {}
        try:
            svg_url = r2_storage.upload_bytes(
                svg_local.read_bytes(),
                f"seed-designs/{slug}/design.svg",
                "image/svg+xml",
                cache_control="public, max-age=31536000, immutable",
            )
            dxf_url = r2_storage.upload_bytes(
                dxf_local.read_bytes(),
                f"seed-designs/{slug}/design.dxf",
                "application/dxf",
                cache_control="public, max-age=31536000, immutable",
            )
            preview_url = r2_storage.upload_bytes(
                preview_local.read_bytes(),
                f"seed-designs/{slug}/preview.jpg",
                "image/jpeg",
                cache_control="public, max-age=31536000, immutable",
            )
        except Exception as e:
            failed.append(f"{slug}: {e}")
            continue

        # Rewrite URLs — only the ones we actually replaced. variants[]
        # may include the DXF (the most common shape from the cron).
        if (row.get("thumbnail_url") or "").startswith("/seed-designs/"):
            updates["thumbnail_url"] = preview_url
        if (row.get("download_url") or "").startswith("/seed-designs/"):
            updates["download_url"] = svg_url
        variants = row.get("variants") or []
        new_variants = []
        variants_changed = False
        for v in variants:
            v = dict(v)
            old_u = v.get("url") or ""
            if old_u.startswith("/seed-designs/") and old_u.endswith(".dxf"):
                v["url"] = dxf_url
                variants_changed = True
            new_variants.append(v)
        if variants_changed:
            updates["variants"] = new_variants
        updates["file_verified"] = True

        if updates:
            await db.design_files.update_one({"id": row["id"]}, {"$set": updates})
            migrated += 1

    return {
        "ok": True,
        "candidates": len(candidates),
        "migrated": migrated,
        "orphaned_marked": orphaned,
        "failed": failed,
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
