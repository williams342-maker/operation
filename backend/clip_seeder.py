"""
AI-driven Sora 2 seed generator for the Clip Feed.

Mirrors the design_file_seeder pattern: each run picks a category +
preset prompt, calls Sora 2 to render a vertical 9:16 clip (~6s), saves
to /app/frontend/public/seed-clips/<slug>/clip.mp4 + poster.jpg, then
inserts a `clips` row flagged `is_seed=true, ai_generated=true`.

Sora 2 is slow (~2-5 min per clip) — call this from an admin button or
the daily cron. The endpoint generates ONE clip per invocation so we
don't time out the HTTP request.
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
import re
import uuid
from pathlib import Path
from typing import Any

from core import db, now_iso

logger = logging.getLogger("crafters.clip_seeder")

SEED_DIR = Path("/app/frontend/public/seed-clips")
SEED_DIR.mkdir(parents=True, exist_ok=True)
WORKSHOP_NAME = "Crafters Market Workshop Team"

# 2-3 prompts per category — round-robin picks the least-used (category,
# prompt) combo so the seed library stays varied even on long runs.
PROMPTS: dict[str, list[dict]] = {
    "workshop": [
        {"title": "CNC Plasma Cuts a Steel Mountain",
         "prompt": "Cinematic close-up of a CNC plasma cutter slicing a mountain silhouette out of 1/4 inch steel plate inside a dim industrial workshop, slow-motion sparks arcing off the cut path, vertical 9:16, photoreal, no text."},
        {"title": "Router Carving Walnut",
         "prompt": "Top-down close-up of a CNC router bit carving an intricate pattern into walnut wood, sawdust flying in golden lamp light, vertical 9:16, satisfying slow-motion, no text."},
        {"title": "Hands at the Bench",
         "prompt": "Maker's hands wearing leather gloves placing freshly cut metal pieces on a wooden workbench under a single warm shop lamp, vertical 9:16, cinematic, no text."},
    ],
    "cuts": [
        {"title": "Plasma Through Quarter Inch",
         "prompt": "Hyper-detailed slow-motion close-up of a plasma cutter blasting through 1/4 inch mild steel, blue-white arc, molten metal droplets, vertical 9:16, no text."},
        {"title": "Laser Engraver Slicing Acrylic",
         "prompt": "Top-down view of a CO2 laser cutter slicing a heart shape from black acrylic, faint blue glow, smoke curling up, vertical 9:16, satisfying, no text."},
        {"title": "Bandsaw Through Aluminum",
         "prompt": "Tight close-up of a vertical bandsaw blade cutting a clean line through a thick aluminum bar, blue cutting fluid pooling, vertical 9:16, photoreal, no text."},
    ],
    "welding": [
        {"title": "MIG Welder Hot Bead",
         "prompt": "Cinematic macro of a MIG welder laying a fresh bead between two steel plates inside a dark welding booth, brilliant arc light, sparks cascading down, vertical 9:16, photoreal, no text."},
        {"title": "TIG Welding Stainless",
         "prompt": "Top-down close-up of a TIG welder fusing two stainless steel sheets, blue-white arc, tungsten electrode steady in a gloved hand, vertical 9:16, slow-motion, no text."},
    ],
    "powder-coat": [
        {"title": "Matte Black Powder Coat",
         "prompt": "Close-up of a powder-coat spray gun coating a steel mountain wall art piece in matte black, fine powder cloud catching backlight, vertical 9:16, photoreal industrial setting, no text."},
        {"title": "Color Change Spray",
         "prompt": "Spray-gun applying bright copper powder coat to a custom address plaque hanging on a rack in a powder coat booth, vertical 9:16, photoreal, no text."},
    ],
    "engraving": [
        {"title": "Diamond Drag on Brass",
         "prompt": "Top-down close-up of a diamond drag engraver cutting fine cursive script into a brass plate, vertical 9:16, photoreal, soft warm light, no text overlay just the engraved letters appearing as the tool moves.",
         },
        {"title": "Laser Engraving Walnut",
         "prompt": "Cinematic close-up of a CO2 laser engraver burning a mountain logo into a walnut plaque, faint smoke wisp, vertical 9:16, photoreal, no text overlay."},
    ],
    "before-after": [
        {"title": "Raw Steel to Finished Sign",
         "prompt": "Time-lapse split showing a raw rusted steel sheet on the left and a finished matte black welcome sign with mountain silhouette on the right, vertical 9:16, photoreal, no text."},
        {"title": "Bare Wood to Engraved Plaque",
         "prompt": "Time-lapse split showing a blank walnut blank on the left and a finished laser-engraved family monogram plaque on the right, vertical 9:16, photoreal warm lighting, no text overlay."},
    ],
}


def _slugify(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")[:80]
    return s or f"clip-{uuid.uuid4().hex[:8]}"


async def _unique_slug(base: str) -> str:
    c = base
    n = 1
    while await db.clips.find_one({"slug": c}, {"_id": 0, "slug": 1}):
        n += 1
        c = f"{base}-{n}"
    return c


async def _pick_next() -> dict:
    """Round-robin: pick the (category, prompt_index) combo with the
    fewest existing rows so the seed library stays diverse."""
    counts: dict[tuple, int] = {}
    pipeline = [
        {"$match": {"is_seed": True, "ai_generated": True}},
        {"$group": {"_id": {"c": "$category", "p": "$ai_prompt_index"}, "n": {"$sum": 1}}},
    ]
    async for row in db.clips.aggregate(pipeline):
        counts[(row["_id"]["c"], row["_id"]["p"])] = row["n"]
    best_n = 10**9
    candidates: list[tuple] = []
    for cat, prompts in PROMPTS.items():
        for i, _ in enumerate(prompts):
            n = counts.get((cat, i), 0)
            if n < best_n:
                best_n = n
                candidates = [(cat, i)]
            elif n == best_n:
                candidates.append((cat, i))
    cat, idx = random.choice(candidates) if candidates else ("workshop", 0)
    return {"category": cat, "prompt_index": idx, "prompt": PROMPTS[cat][idx]}


def _generate_video_blocking(prompt: str, out_path: str, model: str = "sora-2-pro") -> tuple[bool, str]:
    """Synchronous Sora 2 call. Wrapped in a thread by the caller — this
    function blocks for the full 2-5 minutes of generation.

    Note on sizing: the emergentintegrations wrapper only accepts the
    legacy OpenAI sizes (1280×720, 1792×1024, 1024×1792, 1024×1024). The
    upstream Sora 2 API additionally rejects 1024×1792 for *base*
    `sora-2` (it wants 720×1280 vertical) — so the only intersection is
    `sora-2-pro` with 1024×1792 for vertical, OR `sora-2` with 1280×720
    horizontal. Pick accordingly.

    Returns (ok, error_message). On success: (True, ""). On failure the
    raw provider error is preserved so the caller can classify it
    (e.g. budget exhaustion vs transient timeout).
    """
    from emergentintegrations.llm.openai.video_generation import OpenAIVideoGeneration

    if model == "sora-2-pro":
        size = "1024x1792"
    else:  # sora-2 (base) — must be horizontal through the wrapper
        size = "1280x720"

    try:
        video_gen = OpenAIVideoGeneration(api_key=os.environ["EMERGENT_LLM_KEY"])
        video_bytes = video_gen.text_to_video(
            prompt=prompt,
            model=model,
            size=size,
            duration=8,        # 4 / 8 / 12 — 8 gives a satisfying clip without ballooning cost
            max_wait_time=600,
        )
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
    if not video_bytes:
        return False, "empty response from provider"
    try:
        video_gen.save_video(video_bytes, out_path)
    except Exception as e:
        return False, f"save_video failed: {e}"
    return True, ""


async def generate_one_clip(model: str = "sora-2-pro") -> dict[str, Any]:
    """Pick the next category, render via Sora 2, upload to R2, insert into Mongo.

    Returns a structured status dict that mirrors the design seeder so
    the admin UI can render a toast.

    iter225 — Storage moved from the local `/app/frontend/public/seed-clips/`
    folder (ephemeral, lost on pod restart) to R2 (`seed-clips/<slug>/...`).
    The local folder is still used as a scratch directory for the ffmpeg
    poster extraction (R2 doesn't transcode), then both files are uploaded
    to R2 and the local copies stay only as a dev convenience. `video_url`
    + `poster_url` now hold absolute R2 CDN URLs that survive any pod
    lifecycle. The hardened `_orphan_guard` in routers/clips.py refuses
    local-path seeds — so dropping back to filesystem-only would silently
    hide the clip on the public feed.
    """
    pick = await _pick_next()
    prompt_def = pick["prompt"]
    title = prompt_def["title"]
    prompt = prompt_def["prompt"]

    slug = await _unique_slug(_slugify(title))
    folder = SEED_DIR / slug
    folder.mkdir(parents=True, exist_ok=True)
    out_path = folder / "clip.mp4"

    # Sora is blocking — run it in a thread so the FastAPI event loop
    # stays free.
    ok, err_msg = await asyncio.to_thread(_generate_video_blocking, prompt, str(out_path), model)
    if not ok:
        # iter261 — classify the failure. Budget exhaustion gets a
        # dedup'd admin alert; other failures (timeout, prompt rejection,
        # transient API errors) just bubble up as a soft-fail.
        try:
            from llm_budget_alert import is_budget_exhaustion_error, notify_budget_exhausted
            if is_budget_exhaustion_error(err_msg):
                await notify_budget_exhausted(
                    kind=f"sora2_clip_{model}",
                    service=f"Sora-2 video ({model})",
                    error_message=err_msg,
                    context={"job": "daily_clip_seed", "model": model, "prompt_title": title},
                )
                return {"status": "error", "reason": "budget_exhausted", "detail": err_msg}
        except Exception as e:
            # Don't let the alerter itself crash the cron — log and move on.
            import logging
            logging.getLogger("crafters").warning("[clip_seeder] budget-alerter failed: %s", e)
        return {"status": "error", "reason": "video generation failed", "detail": err_msg}

    # Verify the file actually landed on disk with non-zero size before
    # we try to upload it. Keeps a failed Sora download from creating a
    # zero-byte R2 object.
    try:
        local_ok = out_path.exists() and out_path.stat().st_size > 1024
    except Exception:
        local_ok = False
    if not local_ok:
        return {"status": "error", "reason": "video file missing on disk after save"}

    # ────── Upload to R2 ──────
    # Without this step, the clip URL points at the ephemeral
    # `/app/frontend/public/seed-clips/...` path which the production
    # static bundle has no knowledge of — buyers see a black `<video>`.
    try:
        import r2_storage
        video_bytes = out_path.read_bytes()
        # Use a deterministic key (slug-based) instead of the random hex
        # `upload_video_bytes` would generate — makes re-uploads idempotent
        # and easier to debug from the R2 dashboard.
        video_key = f"seed-clips/{slug}/clip.mp4"
        public_video_url = r2_storage.upload_bytes(
            video_bytes, video_key, "video/mp4",
            cache_control="public, max-age=86400",
            max_bytes=r2_storage.MAX_VIDEO_BYTES,
        )
    except Exception as e:
        logger.exception("[clip_seeder] R2 upload failed for %s", slug)
        return {"status": "error", "reason": f"R2 upload failed: {e}"}

    # Best-effort poster: pull the first frame with ffmpeg if available,
    # then upload that to R2 too.
    poster_url: str | None = None
    poster_path = folder / "poster.jpg"
    try:
        import subprocess
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(out_path), "-vframes", "1",
             "-q:v", "3", str(poster_path)],
            check=True, capture_output=True, timeout=30,
        )
        if poster_path.exists() and poster_path.stat().st_size > 256:
            try:
                import r2_storage
                poster_url = r2_storage.upload_bytes(
                    poster_path.read_bytes(),
                    f"seed-clips/{slug}/poster.jpg",
                    "image/jpeg",
                )
            except Exception as e:
                # Poster failures are non-fatal — clip still plays
                # without a poster (player just shows black until
                # buffered).
                logger.warning("[clip_seeder] R2 poster upload failed for %s: %s", slug, e)
    except Exception as e:
        logger.warning("[clip_seeder] poster extraction failed for %s: %s", slug, e)

    doc = {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "maker_slug": None,
        "maker_name": WORKSHOP_NAME,
        "uploader_email": None,
        "title": title,
        "description": prompt[:280],
        "category": pick["category"],
        "tags": [pick["category"], "ai-generated", "workshop"],
        "source_type": "r2",
        "source_id": None,
        "video_url": public_video_url,
        "poster_url": poster_url,
        "duration_seconds": 8,
        "product_slug": None,
        "views": 0,
        "likes": 0,
        "saves": 0,
        "shares": 0,
        "is_seed": True,
        "ai_generated": True,
        "ai_model": model,
        "ai_prompt_index": pick["prompt_index"],
        "file_verified": True,        # iter218 — kept for backwards-compat with old purge logic
        "quarantined_at": None,
        "created_at": now_iso(),
    }
    await db.clips.insert_one(doc)
    doc.pop("_id", None)
    return {
        "status": "ok",
        "clip": {
            "id": doc["id"],
            "slug": slug,
            "title": title,
            "category": pick["category"],
            "video_url": public_video_url,
            "poster_url": poster_url,
        },
    }
