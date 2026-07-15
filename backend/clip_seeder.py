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
from config import env_get

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
    # iter313c — Prompts softened for Sora's content-moderation layer.
    # Sora wraps OpenAI moderation, which over-flags words like "blasting",
    # "molten", "blade cutting", "slicing into flesh-coded material" as
    # violence. Same visuals, gentler verbs reliably pass — no need to
    # change the captured aesthetic.
    "workshop": [
        {"title": "CNC Plasma Forms a Steel Mountain",
         "prompt": "Cinematic close-up of a CNC plasma machine tracing a mountain silhouette across a 1/4 inch steel plate inside a warm industrial workshop, glowing sparks arcing along the path, vertical 9:16, photoreal, no text."},
        {"title": "Router Carving Walnut",
         "prompt": "Top-down close-up of a CNC router bit carving an intricate pattern into walnut wood, sawdust drifting in golden lamp light, vertical 9:16, satisfying slow-motion, no text."},
        {"title": "Hands at the Workbench",
         "prompt": "Artisan's hands wearing simple work gloves placing freshly finished metal pieces on a wooden workbench under a single warm shop lamp, vertical 9:16, cinematic, no text."},
    ],
    "cuts": [
        {"title": "Plasma Tracing Quarter Inch Steel",
         "prompt": "Slow-motion close-up of a plasma machine etching a clean line across 1/4 inch mild steel plate, blue-white glow, bright sparks lifting away, vertical 9:16, no text."},
        {"title": "Laser Engraver Forms Acrylic Heart",
         "prompt": "Top-down view of a CO2 laser engraver outlining a heart shape into a sheet of black acrylic, faint blue glow, soft smoke wisp curling up, vertical 9:16, satisfying, no text."},
        {"title": "Bandsaw Shaping Aluminum",
         "prompt": "Close-up of a vertical bandsaw shaping a clean line across a thick aluminum bar, blue cutting fluid pooling, vertical 9:16, photoreal, no text."},
    ],
    "welding": [
        {"title": "MIG Welder Hot Bead",
         "prompt": "Cinematic macro of a MIG welder laying a fresh bead between two steel plates inside a workshop welding booth, brilliant arc light, glowing sparks drifting down, vertical 9:16, photoreal, no text."},
        {"title": "TIG Welding Stainless",
         "prompt": "Top-down close-up of a TIG welder fusing two stainless steel sheets, blue-white arc, tungsten electrode steady in a gloved hand, vertical 9:16, slow-motion, no text."},
    ],
    "powder-coat": [
        {"title": "Matte Black Powder Coat",
         "prompt": "Close-up of a powder-coat spray gun coating a steel mountain wall art piece in matte black, fine powder cloud catching backlight, vertical 9:16, photoreal industrial setting, no text."},
        {"title": "Color Change Spray",
         "prompt": "Spray gun applying bright copper powder coat to a custom address plaque hanging on a rack in a powder coat booth, vertical 9:16, photoreal, no text."},
    ],
    "engraving": [
        {"title": "Diamond Drag on Brass",
         "prompt": "Top-down close-up of a diamond drag engraver inscribing fine cursive script into a brass plate, vertical 9:16, photoreal, soft warm light, the engraved letters appearing as the tool moves.",
         },
        {"title": "Laser Engraving Walnut",
         "prompt": "Cinematic close-up of a CO2 laser engraver inscribing a mountain logo into a walnut plaque, faint smoke wisp, vertical 9:16, photoreal, no text overlay."},
    ],
    "before-after": [
        {"title": "Raw Steel to Finished Sign",
         "prompt": "Time-lapse split showing a raw weathered steel sheet on the left and a finished matte black welcome sign with mountain silhouette on the right, vertical 9:16, photoreal, no text."},
        {"title": "Bare Wood to Engraved Plaque",
         "prompt": "Time-lapse split showing a blank walnut block on the left and a finished laser-engraved family monogram plaque on the right, vertical 9:16, photoreal warm lighting, no text overlay."},
    ],
    # iter344 — Broader handmade-craft categories added so the daily clip
    # feed stops looking like a metal-shop tutorial. Same prompt shape
    # (vertical 9:16, photoreal, no text overlay) so the rendered videos
    # plug straight into the existing feed/showcase rails without any
    # downstream code changes.
    "textiles": [
        {"title": "Loom Weaving Cotton",
         "prompt": "Top-down close-up of an artisan's hands on a wooden floor loom weaving natural cotton thread into a striped pattern, warm afternoon light streaming through a window, vertical 9:16, photoreal, no text."},
        {"title": "Hand Embroidery Hoop",
         "prompt": "Close-up of an artisan's hands embroidering a wildflower onto natural linen stretched in a wooden hoop, slow methodical stitches, soft window light, vertical 9:16, photoreal, no text."},
        {"title": "Macramé Knot Pattern",
         "prompt": "Top-down macro of fingers tying a square knot in natural cotton macramé rope, beige tones, vertical 9:16, slow-motion, photoreal, no text."},
    ],
    "pottery": [
        {"title": "Wheel Throwing a Bowl",
         "prompt": "Cinematic close-up of an artisan's wet hands centering and opening a clay bowl on a spinning pottery wheel, soft studio light, vertical 9:16, photoreal, no text."},
        {"title": "Trimming the Foot",
         "prompt": "Top-down close-up of a trimming tool shaving a clean foot ring on an upside-down leather-hard ceramic bowl on a spinning wheel, vertical 9:16, photoreal, satisfying, no text."},
        {"title": "Brushing Glaze on Mug",
         "prompt": "Close-up of a soft brush applying glossy cobalt blue glaze to a bisque-fired stoneware mug on a banding wheel, vertical 9:16, photoreal, warm studio lighting, no text."},
    ],
    "jewelry": [
        {"title": "Silver Soldering a Ring",
         "prompt": "Macro shot of a small butane torch flowing solder along the seam of a sterling silver ring on a soldering pad, brief glow, vertical 9:16, photoreal, no text."},
        {"title": "Wire-Wrap Crystal Pendant",
         "prompt": "Close-up of fine pliers shaping copper wire around a clear quartz crystal pendant on a leather mat, vertical 9:16, photoreal, soft natural light, no text."},
        {"title": "Polishing Brass Earrings",
         "prompt": "Top-down close-up of a microfiber cloth polishing a pair of geometric brass earrings on a wooden block, warm reflections, vertical 9:16, photoreal, no text."},
    ],
    "leather": [
        {"title": "Saddle Stitch a Wallet",
         "prompt": "Close-up of two needles saddle-stitching waxed thread through a tan vegetable-tanned leather wallet held in a stitching pony, vertical 9:16, photoreal, warm shop light, no text."},
        {"title": "Tooling a Floral Pattern",
         "prompt": "Top-down macro of a swivel knife tracing a floral pattern into damp veg-tanned leather, fine curl of leather lifting, vertical 9:16, photoreal, no text."},
        {"title": "Burnishing the Edge",
         "prompt": "Close-up of a wooden slicker burnishing the edge of a leather belt to a glossy finish, vertical 9:16, photoreal, satisfying, no text."},
    ],
    "candles-soap": [
        {"title": "Pouring Soy Wax Candle",
         "prompt": "Slow-motion close-up of warm soy wax pouring from a stainless pitcher into an amber glass jar with a centered wick, vertical 9:16, photoreal, soft kitchen light, no text."},
        {"title": "Cutting Cold-Process Soap",
         "prompt": "Top-down close-up of a wire soap cutter slicing a loaf of layered handmade cold-process soap into clean bars on a wooden board, vertical 9:16, photoreal, no text."},
        {"title": "Embedding Dried Flowers",
         "prompt": "Macro of tweezers placing a dried calendula petal onto the surface of a freshly poured soy candle, wax setting, vertical 9:16, photoreal, no text."},
    ],
    "glass": [
        {"title": "Lampworking a Glass Bead",
         "prompt": "Cinematic macro of a torch flame softening a rod of cobalt blue glass while it's rolled onto a steel mandrel to form a bead, vertical 9:16, photoreal, dark studio, no text."},
        {"title": "Stained Glass Soldering",
         "prompt": "Top-down close-up of a soldering iron drawing a bead of solder along the foiled edge of a stained-glass leaf panel, vertical 9:16, photoreal, no text."},
        {"title": "Fused Glass Dichroic Pendant",
         "prompt": "Close-up of a dichroic fused-glass pendant cooling on a kiln shelf, iridescent rainbow flashes catching the light, vertical 9:16, photoreal, no text."},
    ],
    "knife-making": [
        {"title": "Forging a Blade Tip",
         "prompt": "Cinematic close-up of a blacksmith's hammer tapering the tip of a glowing orange steel blade on an anvil, scale flaking off, vertical 9:16, photoreal, no text."},
        {"title": "Wrapping a Handle in Cord",
         "prompt": "Top-down close-up of hands wrapping black paracord around a finished knife handle in a tight ranger weave, vertical 9:16, photoreal, no text."},
    ],
    "paper": [
        {"title": "Calligraphy in Walnut Ink",
         "prompt": "Top-down macro of a pointed dip pen drawing a flourished capital letter in warm walnut ink across cream paper, vertical 9:16, photoreal, soft window light, no text overlay other than the letter being drawn."},
        {"title": "Pulling a Screen Print",
         "prompt": "Top-down close-up of a squeegee pulling forest-green ink across a silkscreen onto a natural canvas tote bag, vertical 9:16, photoreal, no text."},
        {"title": "Letterpress Card Printing",
         "prompt": "Cinematic close-up of a vintage letterpress platen pressing onto cotton card stock, leaving a deep impression of a botanical illustration, vertical 9:16, photoreal, no text overlay other than the printed illustration."},
    ],
    "resin": [
        {"title": "Resin River Table Pour",
         "prompt": "Slow-motion close-up of clear teal-tinted epoxy resin pouring between two live-edge walnut slabs in a workshop, vertical 9:16, photoreal, satisfying, no text."},
        {"title": "Pressed Flower Coaster",
         "prompt": "Top-down close-up of clear resin curing around a pressed daisy in a round silicone mold on a wooden bench, vertical 9:16, photoreal, soft natural light, no text."},
    ],
    "florals": [
        {"title": "Building a Dried Wreath",
         "prompt": "Top-down close-up of an artisan's hands wiring dried lavender and pampas grass onto a grapevine wreath base on a linen surface, vertical 9:16, photoreal, warm light, no text."},
        {"title": "Arranging Eucalyptus",
         "prompt": "Close-up of hands tucking fresh eucalyptus stems into a hand-tied bouquet wrapped in natural twine, vertical 9:16, photoreal, soft studio light, no text."},
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

    # iter310 — sora-2-pro consistently times out at the default 600s
    # (returns empty bytes silently per the wrapper contract). Playbook
    # recommends 900s for `pro`. Base `sora-2` keeps 600 — it's the
    # faster path and almost always finishes well under that.
    max_wait = 900 if model == "sora-2-pro" else 600

    try:
        video_gen = OpenAIVideoGeneration(api_key=env_get("EMERGENT_LLM_KEY"))
        video_bytes = video_gen.text_to_video(
            prompt=prompt,
            model=model,
            size=size,
            duration=8,        # 4 / 8 / 12 — 8 gives a satisfying clip without ballooning cost
            max_wait_time=max_wait,
        )
    except Exception as e:
        # iter313c — Log the raw provider error verbatim so the admin
        # "Last 5 renders" inline-detail view shows the actual Sora
        # message (moderation block, 4xx, 5xx, etc.). Previously the
        # exception was just stringified — we now classify common cases
        # so the operator gets an actionable label without needing a
        # JSON viewer.
        raw = f"{type(e).__name__}: {e}"
        logger.error("[clip_seeder] Sora call raised: %s", raw)
        lowered = raw.lower()
        if any(k in lowered for k in ("moderation", "content_policy", "safety", "rejected", "flagged")):
            return False, (
                "Sora rejected the prompt via content moderation. "
                f"Raw: {raw[:300]}"
            )
        if "401" in lowered or "unauthorized" in lowered or "invalid_api_key" in lowered:
            return False, f"Sora auth failed — check EMERGENT_LLM_KEY. Raw: {raw[:300]}"
        if "429" in lowered or "rate" in lowered:
            return False, f"Sora rate-limited. Raw: {raw[:300]}"
        if "402" in lowered or "insufficient" in lowered or "balance" in lowered:
            return False, f"Universal LLM Key budget exhausted. Raw: {raw[:300]}"
        return False, raw[:500]
    if not video_bytes:
        # The wrapper returns empty bytes (NOT an exception) on:
        # - max_wait_time exhaustion (most common with sora-2-pro)
        # - upstream Sora capacity/queue failures
        # iter314 — Word "budget" intentionally removed from this copy.
        # The frontend classifier used to false-positive this as a
        # BUDGET error because the string contained the substring.
        return False, (
            f"Sora returned no video after {max_wait}s "
            f"(model={model}, size={size}). Likely a Sora queue capacity "
            f"hiccup — retry or switch to model=sora-2 for a faster "
            f"horizontal render. If renders keep failing, verify the "
            f"Universal LLM Key has sufficient credit."
        )
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

    # iter314 / iter322 — Sora capacity has been saturating sora-2-pro's
    # 900s ceiling consistently. Auto-fallback once: if pro times out,
    # retry with base sora-2 (horizontal 1280×720). Better to ship a
    # clip than to error out — and the operator can re-seed via
    # "Generate Fresh Clip" if they specifically want pro. The TIMEOUT
    # badge in the admin UI now correctly identifies these cases (was
    # misread as BUDGET because the explanatory copy contained the word).
    #
    # iter322 — Per-attempt diagnostics. We persist both the primary and
    # the fallback attempt outcome so the operator can tell, at a glance
    # in the "Last 5 renders" panel, exactly what failed. Previously
    # only the LAST error was surfaced, which made fallback failures
    # indistinguishable from primary failures.
    import time as _time
    attempts: list[dict[str, Any]] = []

    t0 = _time.time()
    ok, err_msg = await asyncio.to_thread(_generate_video_blocking, prompt, str(out_path), model)
    attempts.append({
        "model": model,
        "ok": ok,
        "elapsed_s": round(_time.time() - t0, 1),
        "error": "" if ok else err_msg[:500],
    })

    if not ok and model == "sora-2-pro" and (
        "no video after" in err_msg.lower() or "wait timeout" in err_msg.lower()
    ):
        logger.warning("[clip_seeder] sora-2-pro timed out — auto-retrying with sora-2 base")
        t1 = _time.time()
        ok, err_msg = await asyncio.to_thread(_generate_video_blocking, prompt, str(out_path), "sora-2")
        attempts.append({
            "model": "sora-2",
            "ok": ok,
            "elapsed_s": round(_time.time() - t1, 1),
            "error": "" if ok else err_msg[:500],
            "is_fallback": True,
        })
        if ok:
            err_msg = ""  # success on fallback
            # Tag the title so it's visible in the admin queue that this
            # was the fallback path, not the requested pro render.
            title = f"{title} (fallback)"
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
                return {"status": "error", "reason": "budget_exhausted", "detail": err_msg, "attempts": attempts}
        except Exception as e:
            # Don't let the alerter itself crash the cron — log and move on.
            import logging
            logging.getLogger("crafters").warning("[clip_seeder] budget-alerter failed: %s", e)
        return {"status": "error", "reason": "video generation failed", "detail": err_msg, "attempts": attempts}

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
        "attempts": attempts,
    }
