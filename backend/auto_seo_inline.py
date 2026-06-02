"""iter320b — Fire-and-forget auto-SEO trigger for fresh uploads.

`schedule_seo_for_design_file(file_id)` and `schedule_seo_for_showcase(post_id)`
spawn an asyncio task that calls the LLM, writes the four-field SEO
bundle back to the row, and never blocks the upload response.

Errors are swallowed (logged at WARNING) so a flaky LLM never breaks
the upload UX. The next admin "Auto-tag SEO" click will retry any row
that's still missing fields.

Tests can monkey-patch `schedule_seo_for_design_file` and
`schedule_seo_for_showcase` to no-ops so unit tests don't depend on
the live LLM.
"""
from __future__ import annotations

import asyncio
import logging

from core import db
from auto_seo_tags import generate_for_design_file, generate_for_showcase_post

logger = logging.getLogger("crafters.auto_seo_inline")


async def _run_design_file(file_id: str) -> None:
    try:
        doc = await db.design_files.find_one(
            {"id": file_id},
            {"_id": 0, "id": 1, "title": 1, "description": 1,
             "file_type": 1, "maker_name": 1, "variants": 1,
             "seo_title": 1, "seo_tags": 1, "alt_text": 1},
        )
        if not doc:
            return
        # Skip if any other process (e.g. the admin bulk button) already
        # tagged this row between insert and our task picking it up.
        if doc.get("seo_title") and doc.get("seo_tags") and doc.get("alt_text"):
            return
        seo = await generate_for_design_file(doc)
        if not seo:
            return
        from datetime import datetime, timezone
        await db.design_files.update_one(
            {"id": file_id},
            {"$set": {
                "seo_title": seo["seo_title"],
                "seo_description": seo["seo_description"],
                "seo_tags": seo["seo_tags"],
                "alt_text": seo["alt_text"],
                "seo_auto_generated_at": datetime.now(timezone.utc).isoformat(),
                "seo_auto_source": "on_upload",
            }},
        )
        logger.info("[auto_seo_inline] tagged design_file %s", file_id)
    except Exception as e:
        logger.warning("[auto_seo_inline] design_file %s failed: %s", file_id, e)


async def _run_showcase(post_id: str) -> None:
    try:
        doc = await db.showcase_posts.find_one(
            {"id": post_id},
            {"_id": 0, "id": 1, "title": 1, "description": 1, "caption": 1,
             "maker_slug": 1, "product_slug": 1, "user_name": 1,
             "seo_title": 1, "seo_tags": 1, "alt_text": 1},
        )
        if not doc:
            return
        if doc.get("seo_title") and doc.get("seo_tags") and doc.get("alt_text"):
            return
        seo = await generate_for_showcase_post(doc)
        if not seo:
            return
        from datetime import datetime, timezone
        await db.showcase_posts.update_one(
            {"id": post_id},
            {"$set": {
                "seo_title": seo["seo_title"],
                "seo_description": seo["seo_description"],
                "seo_tags": seo["seo_tags"],
                "alt_text": seo["alt_text"],
                "seo_auto_generated_at": datetime.now(timezone.utc).isoformat(),
                "seo_auto_source": "on_upload",
            }},
        )
        logger.info("[auto_seo_inline] tagged showcase_post %s", post_id)
    except Exception as e:
        logger.warning("[auto_seo_inline] showcase_post %s failed: %s", post_id, e)


def schedule_seo_for_design_file(file_id: str) -> None:
    """Fire-and-forget. Safe to call from any async request handler —
    returns immediately, the LLM call runs concurrently."""
    if not file_id:
        return
    try:
        asyncio.create_task(_run_design_file(file_id))
    except RuntimeError:
        # No running event loop (shouldn't happen in FastAPI handlers
        # but defend anyway so tests / scripts don't crash).
        logger.warning("[auto_seo_inline] no loop for design_file %s", file_id)


def schedule_seo_for_showcase(post_id: str) -> None:
    """Fire-and-forget. Safe to call from any async request handler."""
    if not post_id:
        return
    try:
        asyncio.create_task(_run_showcase(post_id))
    except RuntimeError:
        logger.warning("[auto_seo_inline] no loop for showcase %s", post_id)
