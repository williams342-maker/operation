"""iter452 — First-party storefront event pipeline (Phase 3 analytics).

Deliberately SEPARATE from GA4 / ad pixels and from db.analytics_events:
these events power the maker-facing Store Analytics dashboard only. Every
event carries a `category` (consent category) so the pipeline can be
re-classified (e.g. to a future "functional" category) without rewrites.
Client gates sending on the Analytics consent choice; the server just
tags + stores. db.store_events:
  {id, type, maker_slug, section_slug?, product_slug?, query?,
   session_id, visitor_id?, dwell_ms?, category, at}
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from core import db, logger, now_iso

router = APIRouter()

ALLOWED_TYPES = {"store_view", "section_view", "section_dwell",
                 "product_click", "add_to_cart", "search_click",
                 "clip_view", "clip_product_impression",
                 "clip_product_click", "clip_store_click"}
ALLOWED_CATEGORIES = {"analytics", "functional", "necessary"}

_indexes_ready = False


async def _ensure_indexes():
    global _indexes_ready
    if _indexes_ready:
        return
    try:
        await db.store_events.create_index([("maker_slug", 1), ("at", -1)])
        await db.store_events.create_index([("maker_slug", 1), ("type", 1), ("at", -1)])
        await db.store_events.create_index([("maker_slug", 1), ("clip_id", 1), ("type", 1), ("at", -1)])
        _indexes_ready = True
    except Exception as e:
        logger.warning("[store-events] index ensure failed · %s", e)


class StoreEventIn(BaseModel):
    type: str = Field(min_length=1, max_length=32)
    maker_slug: str = Field(min_length=1, max_length=80)
    section_slug: Optional[str] = Field(default=None, max_length=80)
    product_slug: Optional[str] = Field(default=None, max_length=120)
    clip_id: Optional[str] = Field(default=None, max_length=120)
    referrer: Optional[str] = Field(default=None, max_length=400)
    source: Optional[str] = Field(default=None, max_length=80)
    query: Optional[str] = Field(default=None, max_length=80)
    session_id: Optional[str] = Field(default=None, max_length=64)
    visitor_id: Optional[str] = Field(default=None, max_length=64)
    dwell_ms: Optional[int] = Field(default=None, ge=0, le=3_600_000)
    category: Optional[str] = Field(default="analytics", max_length=20)


class StoreEventBatch(BaseModel):
    events: List[StoreEventIn] = Field(max_length=20)


def _is_bot(ua: str | None) -> bool:
    if not ua:
        return False
    lo = ua.lower()
    return any(m in lo for m in ("bot", "spider", "crawler", "headless", "lighthouse"))


@router.post("/store-events")
async def ingest_store_events(batch: StoreEventBatch,
                              user_agent: str | None = Header(default=None, alias="User-Agent")):
    await _ensure_indexes()
    if _is_bot(user_agent):
        return {"ok": True, "stored": 0, "reason": "bot"}
    at = now_iso()
    docs = []
    for e in batch.events:
        t = e.type.strip().lower()
        if t not in ALLOWED_TYPES:
            continue
        docs.append({
            "id": uuid.uuid4().hex, "type": t,
            "maker_slug": e.maker_slug, "section_slug": e.section_slug,
            "product_slug": e.product_slug, "clip_id": e.clip_id,
            "referrer": e.referrer, "source": e.source, "query": e.query,
            "session_id": e.session_id, "visitor_id": e.visitor_id,
            "dwell_ms": e.dwell_ms,
            "category": e.category if e.category in ALLOWED_CATEGORIES else "analytics",
            "at": at,
        })
    if docs:
        try:
            await db.store_events.insert_many(docs, ordered=False)
        except Exception:
            return {"ok": True, "stored": 0}
    return {"ok": True, "stored": len(docs)}
