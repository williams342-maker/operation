"""iter452 — Store Analytics (Phase 3).

Maker-facing analytics over the first-party store_events pipeline +
store_search_logs + paid transactions, plus a deterministic rule-based
recommendation engine with a daily-cached LLM natural-language summary
(hybrid: rules generate the insights, the LLM only phrases them).

All ranges are N COMPLETE days in the maker's timezone, ending yesterday —
the current partial day is excluded so period-over-period comparisons are
apples-to-apples. Admin marketplace trends aggregate the same data across
all stores.
"""
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from core import db, logger, now_iso
from maker_auth import current_admin, current_maker_slug
from routers.smart_sections import SMART_DEFS, compute_smart_members, _settings_map

router = APIRouter()

VALID_DAYS = (7, 30, 90)


# ── Period helpers ────────────────────────────────────────────────────────────

def _ranges(days: int, tz: str) -> dict:
    days = days if days in VALID_DAYS else 30
    try:
        tzinfo = ZoneInfo(tz or "UTC")
    except Exception:
        tzinfo = timezone.utc
    today = datetime.now(tzinfo).replace(hour=0, minute=0, second=0, microsecond=0)
    cur_start = today - timedelta(days=days)
    prev_start = cur_start - timedelta(days=days)
    iso = lambda d: d.astimezone(timezone.utc).isoformat()  # noqa: E731
    return {
        "days": days, "tz": str(tzinfo), "tzinfo": tzinfo,
        "cur": (iso(cur_start), iso(today)),
        "prev": (iso(prev_start), iso(cur_start)),
        "label": {"start": cur_start.date().isoformat(),
                  "end": (today - timedelta(days=1)).date().isoformat()},
    }


def _between(pair):
    return {"$gte": pair[0], "$lt": pair[1]}


def _pct(cur, prev):
    if prev in (0, None):
        return None if not cur else 100.0
    return round((cur - prev) / prev * 100, 1)


def _rate(num, den):
    return round(num / den * 100, 2) if den else 0.0


# ── Shared aggregations ───────────────────────────────────────────────────────

async def _event_counts(slug: str, pair) -> dict:
    out = {}
    async for g in db.store_events.aggregate([
            {"$match": {"maker_slug": slug, "at": _between(pair)}},
            {"$group": {"_id": "$type", "n": {"$sum": 1}}}]):
        out[g["_id"]] = g["n"]
    return out


async def _unique_visitors(slug: str, pair) -> int:
    rows = await db.store_events.distinct(
        "session_id", {"maker_slug": slug, "at": _between(pair),
                       "session_id": {"$ne": None}})
    return len(rows)


async def _orders_revenue(slug: str, pair) -> tuple[int, float, list]:
    """(order_count, revenue, per_item[{slug, qty, revenue, tx_at}])."""
    orders, revenue, items = 0, 0.0, []
    async for tx in db.transactions.find(
            {"items.maker_slug": slug, "payment_status": "paid",
             "created_at": _between(pair)},
            {"_id": 0, "items": 1, "created_at": 1, "session_id": 1}):
        mine = [li for li in (tx.get("items") or []) if li.get("maker_slug") == slug]
        if not mine:
            continue
        orders += 1
        for li in mine:
            s = li.get("slug") or li.get("product_slug")
            qty = max(1, int(li.get("quantity") or 1))
            rev = float(li.get("price") or 0) * qty
            revenue += rev
            items.append({"slug": s, "qty": qty, "revenue": rev,
                          "tx_at": tx.get("created_at"),
                          "tx_id": tx.get("session_id") or tx.get("created_at")})
    return orders, round(revenue, 2), items


async def _searches(slug: str, pair) -> int:
    return await db.store_search_logs.count_documents(
        {"maker_slug": slug, "at": _between(pair)})


async def _overview_metrics(slug: str, pair) -> dict:
    ev = await _event_counts(slug, pair)
    visitors = await _unique_visitors(slug, pair)
    orders, revenue, _ = await _orders_revenue(slug, pair)
    searches = await _searches(slug, pair)
    clicks = ev.get("search_click", 0)
    return {
        "store_views": ev.get("store_view", 0),
        "unique_visitors": visitors,
        "product_views": ev.get("product_click", 0),
        "searches": searches,
        "search_to_click_rate": _rate(clicks, searches),
        "add_to_cart": ev.get("add_to_cart", 0),
        "orders": orders,
        "revenue": revenue,
        "conversion_rate": _rate(orders, visitors),
        "avg_order_value": round(revenue / orders, 2) if orders else 0.0,
    }


# ── Overview ──────────────────────────────────────────────────────────────────

@router.get("/maker/analytics/overview")
async def analytics_overview(days: int = 30, tz: str = "UTC",
                             slug: str = Depends(current_maker_slug)):
    r = _ranges(days, tz)
    cur = await _overview_metrics(slug, r["cur"])
    prev = await _overview_metrics(slug, r["prev"])
    deltas = {k: _pct(cur[k], prev[k]) for k in cur}

    # Daily series (views + revenue) grouped by LOCAL date.
    tzinfo = r["tzinfo"]
    buckets: dict[str, dict] = {}
    d = datetime.fromisoformat(r["cur"][0]).astimezone(tzinfo)
    for i in range(r["days"]):
        buckets[(d + timedelta(days=i)).date().isoformat()] = {"views": 0, "revenue": 0.0}
    async for e in db.store_events.find(
            {"maker_slug": slug, "type": "store_view", "at": _between(r["cur"])},
            {"_id": 0, "at": 1}).limit(50000):
        key = datetime.fromisoformat(e["at"]).astimezone(tzinfo).date().isoformat()
        if key in buckets:
            buckets[key]["views"] += 1
    _, _, items = await _orders_revenue(slug, r["cur"])
    for li in items:
        if li["tx_at"]:
            key = datetime.fromisoformat(li["tx_at"]).astimezone(tzinfo).date().isoformat()
            if key in buckets:
                buckets[key]["revenue"] = round(buckets[key]["revenue"] + li["revenue"], 2)

    return {"range": {"days": r["days"], "tz": r["tz"], **r["label"]},
            "current": cur, "previous": prev, "deltas": deltas,
            "daily": [{"date": k, **v} for k, v in buckets.items()]}


# ── Sections ──────────────────────────────────────────────────────────────────

async def _section_universe(slug: str) -> list:
    """Manual sections + ENABLED smart sections with product membership sets."""
    out = []
    manual = await db.store_sections.find(
        {"maker_slug": slug}, {"_id": 0, "name": 1, "slug": 1, "visible": 1}).sort(
        "position", 1).to_list(60)
    prods = await db.products.find(
        {"maker_slug": slug, "status": "published", "section_slugs.0": {"$exists": True}},
        {"_id": 0, "slug": 1, "section_slugs": 1}).to_list(3000)
    by_sec: dict[str, set] = {}
    for p in prods:
        for s in p.get("section_slugs") or []:
            by_sec.setdefault(s, set()).add(p["slug"])
    for m in manual:
        out.append({"slug": m["slug"], "name": m["name"], "smart": False,
                    "visible": m.get("visible", True),
                    "members": by_sec.get(m["slug"], set())})
    settings = await _settings_map(slug)
    if any(settings.get(k, {}).get("enabled") for k, *_ in SMART_DEFS):
        members = await compute_smart_members(slug)
        manual_slugs = {m["slug"] for m in manual}
        for key, name, _desc, _auto in SMART_DEFS:
            if settings.get(key, {}).get("enabled") and key not in manual_slugs:
                out.append({"slug": key, "name": name, "smart": True,
                            "visible": True, "members": set(members[key])})
    return out


@router.get("/maker/analytics/sections")
async def analytics_sections(days: int = 30, tz: str = "UTC",
                             slug: str = Depends(current_maker_slug)):
    r = _ranges(days, tz)
    universe = await _section_universe(slug)

    stats: dict[str, dict] = {}
    async for g in db.store_events.aggregate([
            {"$match": {"maker_slug": slug, "at": _between(r["cur"]),
                        "section_slug": {"$ne": None}}},
            {"$group": {"_id": {"s": "$section_slug", "t": "$type"},
                        "n": {"$sum": 1},
                        "dwell": {"$sum": {"$ifNull": ["$dwell_ms", 0]}},
                        "dwell_n": {"$sum": {"$cond": [
                            {"$gt": [{"$ifNull": ["$dwell_ms", 0]}, 0]}, 1, 0]}}}}]):
        s = stats.setdefault(g["_id"]["s"], {})
        s[g["_id"]["t"]] = g["n"]
        if g["_id"]["t"] == "section_dwell":
            s["dwell_sum"] = g["dwell"]
            s["dwell_n"] = g["dwell_n"]

    # Top clicked products per section
    top: dict[str, list] = {}
    async for g in db.store_events.aggregate([
            {"$match": {"maker_slug": slug, "type": "product_click",
                        "at": _between(r["cur"]),
                        "section_slug": {"$ne": None}, "product_slug": {"$ne": None}}},
            {"$group": {"_id": {"s": "$section_slug", "p": "$product_slug"},
                        "n": {"$sum": 1}}}, {"$sort": {"n": -1}}]):
        lst = top.setdefault(g["_id"]["s"], [])
        if len(lst) < 5:
            lst.append({"slug": g["_id"]["p"], "clicks": g["n"]})

    _, _, items = await _orders_revenue(slug, r["cur"])
    titles = {p["slug"]: p.get("title") async for p in db.products.find(
        {"maker_slug": slug}, {"_id": 0, "slug": 1, "title": 1})}

    rows = []
    for sec in universe:
        st = stats.get(sec["slug"], {})
        views = st.get("section_view", 0)
        sec_orders_sessions = set()
        sec_revenue = 0.0
        for li in items:
            if li["slug"] in sec["members"]:
                sec_revenue += li["revenue"]
                sec_orders_sessions.add(li["tx_id"])
        orders_n = len(sec_orders_sessions)
        dwell_n = st.get("dwell_n", 0)
        rows.append({
            "slug": sec["slug"], "name": sec["name"], "smart": sec["smart"],
            "visible": sec["visible"], "products": len(sec["members"]),
            "views": views,
            "product_clicks": st.get("product_click", 0),
            "add_to_cart": st.get("add_to_cart", 0),
            "orders": orders_n,
            "revenue": round(sec_revenue, 2),
            "conversion_rate": _rate(orders_n, views),
            "avg_dwell_seconds": round(st.get("dwell_sum", 0) / dwell_n / 1000, 1) if dwell_n else None,
            "top_products": [{**t, "title": titles.get(t["slug"]) or t["slug"]}
                             for t in top.get(sec["slug"], [])],
        })
    rows.sort(key=lambda x: (-x["views"], -x["revenue"]))
    return {"range": {"days": r["days"], "tz": r["tz"], **r["label"]}, "sections": rows}


# ── Products ──────────────────────────────────────────────────────────────────

@router.get("/maker/analytics/products")
async def analytics_products(days: int = 30, tz: str = "UTC",
                             slug: str = Depends(current_maker_slug)):
    r = _ranges(days, tz)
    prods = await db.products.find(
        {"maker_slug": slug, "status": "published"},
        {"_id": 0, "slug": 1, "title": 1, "price": 1}).to_list(3000)
    info = {p["slug"]: p for p in prods}

    views: dict[str, int] = {}
    async for g in db.store_events.aggregate([
            {"$match": {"maker_slug": slug, "type": "product_click",
                        "at": _between(r["cur"]), "product_slug": {"$ne": None}}},
            {"$group": {"_id": "$product_slug", "n": {"$sum": 1}}}]):
        views[g["_id"]] = g["n"]

    _, _, items = await _orders_revenue(slug, r["cur"])
    sold: dict[str, dict] = {}
    for li in items:
        d = sold.setdefault(li["slug"], {"qty": 0, "revenue": 0.0})
        d["qty"] += li["qty"]
        d["revenue"] += li["revenue"]

    def row(s):
        v, so = views.get(s, 0), sold.get(s, {"qty": 0, "revenue": 0.0})
        return {"slug": s, "title": info.get(s, {}).get("title") or s,
                "price": info.get(s, {}).get("price"),
                "views": v, "purchases": so["qty"],
                "revenue": round(so["revenue"], 2),
                "conversion_rate": _rate(so["qty"], v) if v else None}

    all_rows = [row(s) for s in set(info) | set(views) | set(sold) if s]
    with_views = [x for x in all_rows if x["views"] >= 3]

    # Fixed staleness windows (independent of the selector, per spec)
    now = datetime.now(timezone.utc)
    v30 = set()
    async for g in db.store_events.aggregate([
            {"$match": {"maker_slug": slug, "type": "product_click",
                        "at": {"$gte": (now - timedelta(days=30)).isoformat()}}},
            {"$group": {"_id": "$product_slug"}}]):
        v30.add(g["_id"])
    s60 = set()
    async for tx in db.transactions.find(
            {"items.maker_slug": slug, "payment_status": "paid",
             "created_at": {"$gte": (now - timedelta(days=60)).isoformat()}},
            {"_id": 0, "items.slug": 1, "items.product_slug": 1, "items.maker_slug": 1}):
        for li in tx.get("items") or []:
            if li.get("maker_slug") == slug:
                s60.add(li.get("slug") or li.get("product_slug"))

    brief = lambda s: {"slug": s, "title": info[s].get("title") or s}  # noqa: E731
    return {
        "range": {"days": r["days"], "tz": r["tz"], **r["label"]},
        "most_viewed": sorted(all_rows, key=lambda x: -x["views"])[:10],
        "most_purchased": sorted(all_rows, key=lambda x: -x["purchases"])[:10],
        "highest_revenue": sorted(all_rows, key=lambda x: -x["revenue"])[:10],
        "highest_conversion": sorted(with_views, key=lambda x: -(x["conversion_rate"] or 0))[:10],
        "lowest_conversion": sorted(with_views, key=lambda x: (x["conversion_rate"] or 0))[:10],
        "no_views_30d": [brief(s) for s in sorted(set(info) - v30)][:20],
        "no_sales_60d": [brief(s) for s in sorted(set(info) - s60)][:20],
    }


# ── Search intelligence ───────────────────────────────────────────────────────

async def _term_stats(slug: str, pair) -> dict:
    out = {}
    async for g in db.store_search_logs.aggregate([
            {"$match": {"maker_slug": slug, "at": _between(pair)}},
            {"$group": {"_id": "$q", "n": {"$sum": 1},
                        "avg_results": {"$avg": "$results"},
                        "sec_hits": {"$sum": {"$ifNull": ["$section_hits", 0]}}}}]):
        if g["_id"]:
            out[g["_id"]] = {"count": g["n"],
                             "avg_results": round(g.get("avg_results") or 0, 1),
                             "section_hits": g.get("sec_hits") or 0}
    return out


def _trending(cur: dict, prev: dict, top_n=8) -> list:
    rows = []
    for q, st in cur.items():
        p = prev.get(q, {}).get("count", 0)
        rows.append({"q": q, "count": st["count"], "prev_count": p,
                     "growth_pct": _pct(st["count"], p)})
    rows.sort(key=lambda x: (-(x["growth_pct"] if x["growth_pct"] is not None else 10**6),
                             -x["count"]))
    return rows[:top_n]


@router.get("/maker/analytics/search-insights")
async def search_insights(days: int = 30, tz: str = "UTC",
                          slug: str = Depends(current_maker_slug)):
    r = _ranges(days, tz)
    terms = await _term_stats(slug, r["cur"])

    top_terms = sorted(
        ({"q": q, **st} for q, st in terms.items()),
        key=lambda x: -x["count"])[:10]
    zero = sorted(
        ({"q": q, **st} for q, st in terms.items()
         if st["avg_results"] == 0 and st["section_hits"] == 0),
        key=lambda x: -x["count"])[:10]

    # Conversion linkage via first-party events: a term "converted" when any
    # session that clicked one of its results later added to cart.
    click_sessions: dict[str, set] = {}
    async for e in db.store_events.find(
            {"maker_slug": slug, "type": "search_click", "at": _between(r["cur"]),
             "query": {"$ne": None}}, {"_id": 0, "query": 1, "session_id": 1}):
        click_sessions.setdefault(e["query"], set()).add(e.get("session_id"))
    atc_sessions = set(await db.store_events.distinct(
        "session_id", {"maker_slug": slug, "type": "add_to_cart",
                       "at": _between(r["cur"])}))
    converted = sorted(
        q for q, sess in click_sessions.items() if sess & atc_sessions)
    not_converted = [t["q"] for t in top_terms
                     if t["q"] not in converted and t["count"] >= 2][:10]

    # Trending: fixed 7d + 30d windows vs their immediately-prior windows.
    r7, r30 = _ranges(7, tz), _ranges(30, tz)
    t7 = _trending(await _term_stats(slug, r7["cur"]),
                   await _term_stats(slug, r7["prev"]))
    t30 = _trending(await _term_stats(slug, r30["cur"]),
                    await _term_stats(slug, r30["prev"]))

    recs = []
    for t in top_terms:
        if t["count"] >= 5 and 0 < t["avg_results"] <= 3:
            recs.append(f"Customers searched for '{t['q']}' {t['count']} times "
                        f"but only ~{int(t['avg_results'])} products matched. "
                        "Consider adding more matching listings.")
    for z in zero[:5]:
        if z["count"] >= 3:
            recs.append(f"Customers searched for '{z['q']}' {z['count']} times "
                        "with zero results — a product gap worth filling.")

    return {"range": {"days": r["days"], "tz": r["tz"], **r["label"]},
            "top_terms": top_terms, "zero_result_terms": zero,
            "converted_terms": converted[:10],
            "not_converted_terms": not_converted,
            "trending_7d": t7, "trending_30d": t30,
            "recommendations": recs[:8]}


# ── Recommendations (rules + cached LLM phrasing) ─────────────────────────────

async def _build_rules(slug: str, days: int, tz: str) -> list:
    r = _ranges(days, tz)
    recs = []

    # Low inventory on sellers
    _, _, items = await _orders_revenue(slug, r["cur"])
    sold: dict[str, int] = {}
    for li in items:
        sold[li["slug"]] = sold.get(li["slug"], 0) + li["qty"]
    if sold:
        from routers.smart_sections import _effective_stock
        prods = await db.products.find(
            {"maker_slug": slug, "slug": {"$in": list(sold)}, "status": "published"},
            {"_id": 0, "slug": 1, "title": 1, "in_stock": 1, "variants.in_stock": 1}).to_list(500)
        for p in prods:
            st = _effective_stock(p)
            if st is not None and 0 <= st <= 5 and sold.get(p["slug"], 0) >= 2:
                recs.append({
                    "type": "low_inventory", "priority": "high", "confidence": 95,
                    "message": f"'{p.get('title') or p['slug']}' sold {sold[p['slug']]} units "
                               f"this period and only {st} remain. Restock soon to avoid missing sales.",
                    "data": {"product_slug": p["slug"], "sold": sold[p["slug"]], "stock": st}})

    # Search gaps
    terms = await _term_stats(slug, r["cur"])
    for q, st in sorted(terms.items(), key=lambda kv: -kv[1]["count"])[:20]:
        if st["avg_results"] == 0 and st["section_hits"] == 0 and st["count"] >= 3:
            recs.append({
                "type": "zero_result_search", "priority": "high", "confidence": 90,
                "message": f"Buyers searched for '{q}' {st['count']} times with zero results. "
                           "You may be missing a product customers want.",
                "data": {"q": q, "count": st["count"]}})
        elif st["count"] >= 5 and 0 < st["avg_results"] <= 3:
            recs.append({
                "type": "low_match_search", "priority": "medium", "confidence": 80,
                "message": f"'{q}' was searched {st['count']} times but only "
                           f"~{int(st['avg_results'])} products matched — consider adding more.",
                "data": {"q": q, "count": st["count"], "avg_results": st["avg_results"]}})

    # Section signals
    sections = (await analytics_sections(days, tz, slug))["sections"]
    for s in sections:
        if s["products"] < 3 and s["views"] >= 10:
            recs.append({
                "type": "sparse_section", "priority": "medium", "confidence": 75,
                "message": f"'{s['name']}' gets traffic ({s['views']} views) but only has "
                           f"{s['products']} product{'s' if s['products'] != 1 else ''}. "
                           f"Add more products to {s['name']}.",
                "data": {"section": s["slug"], "views": s["views"], "products": s["products"]}})
        if s["views"] >= 10 and s["conversion_rate"] >= 8:
            recs.append({
                "type": "high_conversion_section", "priority": "low", "confidence": 85,
                "message": f"Your {s['name']} section converts at {s['conversion_rate']}% — "
                           "expanding it could grow revenue.",
                "data": {"section": s["slug"], "conversion_rate": s["conversion_rate"]}})
        if s["views"] >= 30 and s["conversion_rate"] < 1 and s["product_clicks"] >= 5:
            recs.append({
                "type": "low_conversion_section", "priority": "medium", "confidence": 80,
                "message": f"{s['name']} receives many views ({s['views']}) but few purchases. "
                           "Review pricing, photos, or descriptions.",
                "data": {"section": s["slug"], "views": s["views"],
                         "conversion_rate": s["conversion_rate"]}})

    # Feature candidates
    products = await analytics_products(days, tz, slug)
    featured = set((await db.smart_section_settings.find_one(
        {"maker_slug": slug, "key": "featured"}, {"_id": 0, "product_slugs": 1})
        or {}).get("product_slugs") or [])
    for p in products["highest_conversion"][:3]:
        if p["slug"] not in featured and p["views"] >= 5 and (p["conversion_rate"] or 0) >= 10:
            recs.append({
                "type": "feature_candidate", "priority": "low", "confidence": 70,
                "message": f"'{p['title']}' converts at {p['conversion_rate']}% — "
                           "consider adding it to your Featured Products smart section.",
                "data": {"product_slug": p["slug"], "conversion_rate": p["conversion_rate"]}})
    stale = products["no_views_30d"]
    if len(stale) >= 3:
        names = ", ".join(f"'{x['title']}'" for x in stale[:3])
        recs.append({
            "type": "stale_products", "priority": "low", "confidence": 60,
            "message": f"{len(stale)} listings had no views in 30 days (e.g. {names}). "
                       "Refresh photos/titles or add them to an active section.",
            "data": {"count": len(stale)}})

    order = {"high": 0, "medium": 1, "low": 2}
    recs.sort(key=lambda x: (order[x["priority"]], -x["confidence"]))
    return recs[:15]


async def _ai_summary(slug: str, days: int, recs: list) -> str | None:
    """Daily-cached LLM phrasing of the deterministic recommendations."""
    if not recs:
        return None
    facts = [{"type": x["type"], "priority": x["priority"], "message": x["message"]}
             for x in recs]
    facts_hash = hashlib.md5(json.dumps(facts, sort_keys=True).encode()).hexdigest()
    today = datetime.now(timezone.utc).date().isoformat()
    cached = await db.maker_reco_ai_cache.find_one(
        {"maker_slug": slug, "days": days}, {"_id": 0})
    if cached and cached.get("date") == today and cached.get("facts_hash") == facts_hash:
        return cached.get("summary")
    key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not key:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=key, session_id=f"reco-{slug}-{today}",
            system_message=(
                "You are a friendly e-commerce coach for a handmade-goods seller. "
                "You are given a list of DETERMINISTIC, rule-generated insights about "
                "their store. Write a short 'what to focus on this week' summary "
                "(4-6 sentences, plain text, no markdown, no bullet lists). Only "
                "restate and prioritize the given facts — never invent numbers or "
                "insights that are not in the data."),
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")
        reply = await chat.send_message(UserMessage(
            text=f"Insights (last {days} days):\n" + json.dumps(facts, indent=1)))
        summary = str(reply).strip()[:2000]
        await db.maker_reco_ai_cache.update_one(
            {"maker_slug": slug, "days": days},
            {"$set": {"date": today, "facts_hash": facts_hash,
                      "summary": summary, "updated_at": now_iso()}}, upsert=True)
        return summary
    except Exception as e:
        logger.warning("[reco-ai] summary failed for %s · %s", slug, e)
        return (cached or {}).get("summary")


@router.get("/maker/analytics/recommendations")
async def analytics_recommendations(days: int = 30, tz: str = "UTC", ai: int = 1,
                                    slug: str = Depends(current_maker_slug)):
    r = _ranges(days, tz)
    recs = await _build_rules(slug, days, tz)
    summary = await _ai_summary(slug, r["days"], recs) if ai else None
    return {"range": {"days": r["days"], "tz": r["tz"], **r["label"]},
            "recommendations": recs, "ai_summary": summary}


# ── Admin marketplace trends ──────────────────────────────────────────────────

@router.get("/admin/marketplace-trends")
async def marketplace_trends(days: int = 30, tz: str = "UTC",
                             _: dict = Depends(current_admin)):
    r = _ranges(days, tz)

    async def _all_terms(pair):
        out = {}
        async for g in db.store_search_logs.aggregate([
                {"$match": {"at": _between(pair)}},
                {"$group": {"_id": "$q", "n": {"$sum": 1},
                            "avg_results": {"$avg": "$results"},
                            "sec_hits": {"$sum": {"$ifNull": ["$section_hits", 0]}}}}]):
            if g["_id"]:
                out[g["_id"]] = {"count": g["n"],
                                 "avg_results": round(g.get("avg_results") or 0, 1),
                                 "section_hits": g.get("sec_hits") or 0}
        return out

    cur_terms = await _all_terms(r["cur"])
    top_terms = sorted(({"q": q, **st} for q, st in cur_terms.items()),
                       key=lambda x: -x["count"])[:15]
    empty = sorted(({"q": q, **st} for q, st in cur_terms.items()
                    if st["avg_results"] == 0 and st["section_hits"] == 0),
                   key=lambda x: -x["count"])[:15]

    async def _sec_views(pair):
        out = {}
        async for g in db.store_events.aggregate([
                {"$match": {"at": _between(pair), "section_slug": {"$ne": None},
                            "type": {"$in": ["section_view", "add_to_cart"]}}},
                {"$group": {"_id": {"m": "$maker_slug", "s": "$section_slug",
                                    "t": "$type"}, "n": {"$sum": 1}}}]):
            k = (g["_id"]["m"], g["_id"]["s"])
            out.setdefault(k, {})[g["_id"]["t"]] = g["n"]
        return out

    cur_secs = await _sec_views(r["cur"])
    prev_secs = await _sec_views(r["prev"])
    smart_names = {k: n for k, n, *_ in SMART_DEFS}
    name_rows = await db.store_sections.find(
        {}, {"_id": 0, "maker_slug": 1, "slug": 1, "name": 1}).to_list(3000)
    names = {(x["maker_slug"], x["slug"]): x["name"] for x in name_rows}

    growing, converting = [], []
    for k, st in cur_secs.items():
        views = st.get("section_view", 0)
        prev_v = prev_secs.get(k, {}).get("section_view", 0)
        nm = names.get(k) or smart_names.get(k[1]) or k[1]
        if views >= 5:
            growing.append({"maker_slug": k[0], "section": nm, "views": views,
                            "prev_views": prev_v, "growth_pct": _pct(views, prev_v)})
        if views >= 10:
            atc = st.get("add_to_cart", 0)
            converting.append({"maker_slug": k[0], "section": nm, "views": views,
                               "add_to_cart": atc, "atc_rate": _rate(atc, views)})
    growing.sort(key=lambda x: (-(x["growth_pct"] if x["growth_pct"] is not None else 10**6),
                                -x["views"]))
    converting.sort(key=lambda x: -x["atc_rate"])

    async def _cat_clicks(pair):
        clicks = {}
        async for g in db.store_events.aggregate([
                {"$match": {"at": _between(pair), "type": "product_click",
                            "product_slug": {"$ne": None}}},
                {"$group": {"_id": "$product_slug", "n": {"$sum": 1}}}]):
            clicks[g["_id"]] = g["n"]
        if not clicks:
            return {}
        cats: dict[str, int] = {}
        async for p in db.products.find(
                {"slug": {"$in": list(clicks)}}, {"_id": 0, "slug": 1, "category": 1}):
            c = p.get("category") or "uncategorized"
            cats[c] = cats.get(c, 0) + clicks.get(p["slug"], 0)
        return cats

    cur_cats = await _cat_clicks(r["cur"])
    prev_cats = await _cat_clicks(r["prev"])
    trending_cats = sorted(
        ({"category": c, "clicks": n, "prev_clicks": prev_cats.get(c, 0),
          "growth_pct": _pct(n, prev_cats.get(c, 0))} for c, n in cur_cats.items()),
        key=lambda x: -x["clicks"])[:10]

    return {"range": {"days": r["days"], "tz": r["tz"], **r["label"]},
            "top_search_terms": top_terms, "empty_searches": empty,
            "fastest_growing_sections": growing[:10],
            "highest_converting_sections": converting[:10],
            "trending_categories": trending_cats}
