"""Search Intent Logging (iter419).

Every /shop search flows through ``list_products`` in ``catalog.py``.
This module receives a synchronous hand-off from that endpoint after
the result count is known so we capture the *ground truth* result
count, not a JS-inferred one. See ``log_search()``.

Data model (``search_events`` collection)::

    { id, query, normalized_query, result_count, zero_result: bool,
      filters: { category, technique, price_min, price_max, sort_mode },
      session_id, user_id, path, referrer,
      clicked_product_id (populated post-hoc via /api/search/click),
      created_at }

Read side lives in ``routers/marketplace_command.py`` which reads the
zero-result subset for the Recruitment Opportunities widget.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Request, Depends
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_admin

router = APIRouter(tags=["search-intent"])


# ---------------------------- Helpers ---------------------------- #
_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\s]+")


def normalize_query(q: str) -> str:
    """Lower-case, strip punctuation, collapse whitespace.

    ``"Horseshoe  Art!"`` and ``"horseshoe art"`` normalize to the
    same bucket, which is critical for grouping the zero-result queue.
    """
    q = (q or "").strip().lower()
    q = _PUNCT.sub(" ", q)
    q = _WS.sub(" ", q).strip()
    return q


async def log_search(
    q: str,
    result_count: int,
    *,
    filters: Optional[dict] = None,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    path: Optional[str] = None,
    referrer: Optional[str] = None,
) -> str:
    """Persist a single search event. Called by catalog.py after every
    ``list_products`` request that has a non-empty ``q``.

    Returns the new event id so the frontend can later attach a
    click-through via ``POST /api/search/click``.
    """
    normalized = normalize_query(q)
    if not normalized:
        return ""
    event_id = str(uuid.uuid4())
    doc = {
        "id": event_id,
        "query": q.strip()[:200],
        "normalized_query": normalized[:200],
        "result_count": int(result_count),
        "zero_result": int(result_count) == 0,
        "filters": {
            "category": (filters or {}).get("category"),
            "technique": (filters or {}).get("technique"),
            "sort_mode": (filters or {}).get("sort_mode"),
            "featured": (filters or {}).get("featured"),
            "maker": (filters or {}).get("maker"),
        },
        "session_id": (session_id or "")[:80] or None,
        "user_id": (user_id or "")[:80] or None,
        "path": (path or "")[:200] or None,
        "referrer": (referrer or "")[:400] or None,
        "clicked_product_id": None,
        "created_at": now_iso(),
    }
    try:
        await db.search_events.insert_one(doc)
    except Exception as e:
        # Never let logging failures break search.
        logger.warning("[search_intent] log failed: %s", e)
        return ""
    return event_id


# --------------------------- Endpoints --------------------------- #
class SearchClickIn(BaseModel):
    event_id: str = Field(min_length=1, max_length=64)
    product_id: str = Field(min_length=1, max_length=120)


@router.post("/search/click")
async def record_click(payload: SearchClickIn):
    """Called from PDP navigation after a search — associates a click
    with the originating search event. Best-effort; never errors on
    the caller."""
    try:
        await db.search_events.update_one(
            {"id": payload.event_id, "clicked_product_id": None},
            {"$set": {"clicked_product_id": payload.product_id[:120]}},
        )
    except Exception as e:
        logger.debug("[search_intent] click write skipped: %s", e)
    return {"ok": True}


# --------------------------- Admin reads --------------------------- #
class ZeroResultRow(BaseModel):
    normalized_query: str
    latest_query: str
    count: int
    last_searched_at: str
    hidden: bool = False
    marked_opportunity: bool = False


class ZeroResultResponse(BaseModel):
    window_days: int
    total_zero_result_events: int
    total_distinct_queries: int
    rows: list[ZeroResultRow]


@router.get("/admin/search/zero-result", response_model=ZeroResultResponse)
async def zero_result_queries(
    window_days: int = 7,
    limit: int = 50,
    _: dict = Depends(current_admin),
):
    """Top zero-result queries in the requested window, grouped by
    ``normalized_query``. Excludes queries admin has hidden."""
    window_days = max(1, min(int(window_days or 7), 90))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=window_days)).isoformat()

    pipeline = [
        {"$match": {"zero_result": True, "created_at": {"$gte": cutoff}}},
        {"$group": {
            "_id": "$normalized_query",
            "count": {"$sum": 1},
            "latest_query": {"$last": "$query"},
            "last_searched_at": {"$max": "$created_at"},
        }},
        {"$sort": {"count": -1, "last_searched_at": -1}},
        {"$limit": int(limit)},
    ]
    docs = await db.search_events.aggregate(pipeline).to_list(None)

    # Overlay admin annotations (hidden / marked_opportunity).
    ann_docs = await db.search_intent_annotations.find({}, {"_id": 0}).to_list(None)
    annotations = {a["normalized_query"]: a for a in ann_docs}

    rows: list[ZeroResultRow] = []
    for d in docs:
        nq = d["_id"] or ""
        ann = annotations.get(nq) or {}
        if ann.get("hidden"):
            continue
        rows.append(ZeroResultRow(
            normalized_query=nq,
            latest_query=d.get("latest_query") or nq,
            count=int(d.get("count") or 0),
            last_searched_at=d.get("last_searched_at") or "",
            hidden=False,
            marked_opportunity=bool(ann.get("marked_opportunity")),
        ))

    total_events = await db.search_events.count_documents({
        "zero_result": True, "created_at": {"$gte": cutoff},
    })
    total_distinct = await db.search_events.distinct(
        "normalized_query",
        {"zero_result": True, "created_at": {"$gte": cutoff}},
    )
    return ZeroResultResponse(
        window_days=window_days,
        total_zero_result_events=total_events,
        total_distinct_queries=len(total_distinct),
        rows=rows,
    )


class AnnotateIn(BaseModel):
    normalized_query: str = Field(min_length=1, max_length=200)
    action: str  # "hide" | "unhide" | "mark_opportunity" | "unmark_opportunity"


@router.post("/admin/search/annotate")
async def annotate_query(body: AnnotateIn, claims: dict = Depends(current_admin)):
    """Hide / unhide a query from the zero-result queue, or flag it as
    a recruitment opportunity. Idempotent."""
    nq = normalize_query(body.normalized_query)
    if not nq:
        return {"ok": False}
    updates: dict = {"updated_at": now_iso(), "updated_by": claims["email"]}
    if body.action == "hide":
        updates["hidden"] = True
    elif body.action == "unhide":
        updates["hidden"] = False
    elif body.action == "mark_opportunity":
        updates["marked_opportunity"] = True
    elif body.action == "unmark_opportunity":
        updates["marked_opportunity"] = False
    else:
        return {"ok": False, "detail": "unknown action"}
    await db.search_intent_annotations.update_one(
        {"normalized_query": nq},
        {"$set": {"normalized_query": nq, **updates}},
        upsert=True,
    )
    return {"ok": True}
