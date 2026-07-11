"""iter451 — Store Search (Phase 2): section-aware search scoped to ONE
maker's storefront.

Priority: exact title > title contains > keywords/tags > description >
section name > section description. Section-name hits surface the section
itself at the top; matching products also report their distribution across
sections so the UI can offer "jump into section" chips.

Performance: compound index (maker_slug, status) keeps the candidate set to
one store; scoring happens in Python over projected fields only — ~5k
listings stay comfortably under 30ms. Queries are logged (fire-and-forget)
to power per-store popular searches.
"""
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from core import db, logger, now_iso

router = APIRouter()

_indexes_ready = False


async def _ensure_indexes():
    global _indexes_ready
    if _indexes_ready:
        return
    try:
        await db.products.create_index([("maker_slug", 1), ("status", 1)])
        await db.store_search_logs.create_index([("maker_slug", 1), ("at", -1)])
        _indexes_ready = True
    except Exception as e:
        logger.warning("[store-search] index ensure failed · %s", e)


def _norm(q: str) -> str:
    return re.sub(r"\s+", " ", (q or "")).strip()[:80]


def _score(p: dict, q: str, rx: re.Pattern) -> tuple[int, str] | None:
    title = p.get("title") or ""
    if title.lower() == q:
        return 100, "title"
    if rx.search(title):
        return 80, "title"
    for t in (p.get("tags") or []) + (p.get("materials") or []):
        if rx.search(str(t)):
            return 60, "tags"
    if rx.search(p.get("description") or ""):
        return 40, "description"
    return None


@router.get("/makers/{maker_slug}/search")
async def store_search(maker_slug: str, q: str = "", limit: int = 12):
    """Search THIS maker's storefront only — products + sections."""
    await _ensure_indexes()
    q = _norm(q).lower()
    if not q:
        return {"q": "", "sections": [], "products": [], "by_section": [], "suggestions": []}
    rx = re.compile(re.escape(q), re.IGNORECASE)

    # Sections (name / description match) — tiny collection, no limit worry.
    sec_rows = await db.store_sections.find(
        {"maker_slug": maker_slug, "visible": True},
        {"_id": 0, "id": 1, "name": 1, "slug": 1, "description": 1}).sort(
        "position", 1).to_list(50)
    sec_names = {s["slug"]: s["name"] for s in sec_rows}

    # Section product counts in one aggregation (reused for hits + jump chips)
    counts: dict[str, int] = {}
    async for g in db.products.aggregate([
            {"$match": {"maker_slug": maker_slug, "status": "published",
                        "section_slugs.0": {"$exists": True}}},
            {"$unwind": "$section_slugs"},
            {"$group": {"_id": "$section_slugs", "n": {"$sum": 1}}}]):
        counts[g["_id"]] = g["n"]

    section_hits = []
    for s in sec_rows:
        if rx.search(s["name"]):
            matched = "name"
        elif rx.search(s.get("description") or ""):
            matched = "description"
        else:
            continue
        section_hits.append({"name": s["name"], "slug": s["slug"],
                             "count": counts.get(s["slug"], 0), "matched_on": matched})

    # Products — scoped to this maker, scored by field priority.
    scored = []
    async for p in db.products.find(
            {"maker_slug": maker_slug, "status": "published"},
            {"_id": 0, "slug": 1, "title": 1, "price": 1, "images": 1,
             "image": 1, "tags": 1, "materials": 1, "description": 1,
             "section_slugs": 1, "created_at": 1}):
        hit = _score(p, q, rx)
        if hit:
            scored.append((hit[0], p, hit[1]))
    scored.sort(key=lambda t: -t[0])

    by_section: dict[str, int] = {}
    products = []
    for score, p, matched in scored:
        for s in p.get("section_slugs") or []:
            if s in sec_names:
                by_section[s] = by_section.get(s, 0) + 1
        if len(products) < min(max(limit, 1), 24):
            products.append({
                "slug": p["slug"], "title": p["title"], "price": p.get("price"),
                "image": (p.get("images") or [None])[0] or p.get("image"),
                "section_slugs": p.get("section_slugs") or [],
                "matched_on": matched, "score": score,
            })

    total = len(scored)
    # Zero-result help: suggest the store's sections to browse instead.
    suggestions = [] if (products or section_hits) else [
        {"name": s["name"], "slug": s["slug"], "count": counts.get(s["slug"], 0)}
        for s in sec_rows[:5]]

    try:  # fire-and-forget query log for popular searches
        await db.store_search_logs.insert_one({
            "maker_slug": maker_slug, "q": q, "results": total,
            "section_hits": len(section_hits), "at": now_iso()})
    except Exception:
        pass

    return {
        "q": q,
        "sections": section_hits,
        "products": products,
        "total": total,
        "by_section": [
            {"slug": s, "name": sec_names[s], "count": n}
            for s, n in sorted(by_section.items(), key=lambda kv: -kv[1])],
        "suggestions": suggestions,
    }


@router.get("/makers/{maker_slug}/search/meta")
async def store_search_meta(maker_slug: str):
    """Popular searches for this store (last 30 days, with results)."""
    await _ensure_indexes()
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    rows = [g async for g in db.store_search_logs.aggregate([
        {"$match": {"maker_slug": maker_slug, "at": {"$gte": since},
                    "$or": [{"results": {"$gt": 0}},
                            {"section_hits": {"$gt": 0}}]}},
        {"$group": {"_id": "$q", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 6}])]
    return {"popular": [r["_id"] for r in rows]}
