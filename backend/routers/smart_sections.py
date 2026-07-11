"""iter452 — Smart Sections (Phase 3).

Automatic, data-driven storefront sections a maker can toggle on/off,
rendered alongside their manual Store Sections but computed live from
product/order/review data. Two of the nine ("Staff Picks", "Featured
Products") are manual pick-lists. Settings live in
db.smart_section_settings: {maker_slug, key, enabled, product_slugs[], updated_at}
"""
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, now_iso
from maker_auth import current_maker_slug

router = APIRouter()

MAX_PER_SECTION = 24

# key, name, description, auto (computed) vs manual (pick list)
SMART_DEFS = [
    ("new-arrivals",      "New Arrivals",       "Added in the last 30 days", True),
    ("best-sellers",      "Best Sellers",       "Top sellers over the last 30 days", True),
    ("on-sale",           "On Sale",            "Currently discounted items", True),
    ("recently-updated",  "Recently Updated",   "Updated in the last 14 days", True),
    ("customer-favorites","Customer Favorites", "Highest-rated by buyers", True),
    ("low-inventory",     "Low Inventory",      "5 or fewer left in stock", True),
    ("nearly-sold-out",   "Nearly Sold Out",    "Only 1–2 left — almost gone", True),
    ("digital-downloads", "Digital Downloads",  "Instant-download files from this shop", True),
    ("staff-picks",       "Staff Picks",        "Hand-picked by the shop", False),
    ("featured",          "Featured Products",  "The shop's featured items", False),
]
SMART_KEYS = {k for k, *_ in SMART_DEFS}


def _effective_stock(p: dict) -> Optional[int]:
    variants = p.get("variants") or []
    if variants:
        vals = [v.get("in_stock") for v in variants if v.get("in_stock") is not None]
        return sum(int(v) for v in vals) if vals else None
    s = p.get("in_stock")
    return int(s) if s is not None else None


async def compute_smart_members(maker_slug: str) -> dict:
    """All nine membership lists in one pass. Returns {key: [product_slug…]}."""
    now = datetime.now(timezone.utc)
    d30 = (now - timedelta(days=30)).isoformat()
    d14 = (now - timedelta(days=14)).isoformat()

    prods = await db.products.find(
        {"maker_slug": maker_slug, "status": "published"},
        {"_id": 0, "slug": 1, "price": 1, "compare_at_price": 1, "on_sale": 1,
         "in_stock": 1, "variants.in_stock": 1, "published_at": 1,
         "updated_at": 1, "created_at": 1, "listing_type": 1}).to_list(2000)
    slugs = {p["slug"] for p in prods}

    # Units sold per product (paid transactions, last 30d)
    sold: dict[str, int] = {}
    async for tx in db.transactions.find(
            {"items.maker_slug": maker_slug, "payment_status": "paid",
             "created_at": {"$gte": d30}}, {"_id": 0, "items": 1}):
        for li in tx.get("items") or []:
            s = li.get("slug") or li.get("product_slug")
            if s in slugs and li.get("maker_slug") == maker_slug:
                sold[s] = sold.get(s, 0) + max(1, int(li.get("quantity") or 1))

    # Review aggregates (rating >= 4.5 avg, at least one review)
    fav_scores: dict[str, tuple] = {}
    async for g in db.reviews.aggregate([
            {"$match": {"product_slug": {"$in": list(slugs)}}},
            {"$group": {"_id": "$product_slug", "avg": {"$avg": "$rating"},
                        "n": {"$sum": 1}}}]):
        if g["_id"] and (g.get("avg") or 0) >= 4.5:
            fav_scores[g["_id"]] = (g["n"], g["avg"])

    out: dict[str, list] = {k: [] for k in SMART_KEYS}
    fresh = [(p.get("published_at") or p.get("created_at") or "", p["slug"])
             for p in prods if (p.get("published_at") or p.get("created_at") or "") >= d30]
    out["new-arrivals"] = [s for _, s in sorted(fresh, reverse=True)]
    out["best-sellers"] = [s for s, _ in sorted(sold.items(), key=lambda kv: -kv[1])]
    out["on-sale"] = [p["slug"] for p in prods
                      if p.get("on_sale")
                      or (p.get("compare_at_price") or 0) > (p.get("price") or 0)]
    upd = [(p.get("updated_at") or "", p["slug"])
           for p in prods if (p.get("updated_at") or "") >= d14]
    out["recently-updated"] = [s for _, s in sorted(upd, reverse=True)]
    out["customer-favorites"] = [s for s, _ in sorted(
        fav_scores.items(), key=lambda kv: (-kv[1][0], -kv[1][1]))]
    low, nearly = [], []
    for p in prods:
        st = _effective_stock(p)
        if st is None or st <= 0:
            continue
        if st <= 2:
            nearly.append((st, p["slug"]))
        if st <= 5:
            low.append((st, p["slug"]))
    out["low-inventory"] = [s for _, s in sorted(low)]
    out["nearly-sold-out"] = [s for _, s in sorted(nearly)]
    out["digital-downloads"] = [
        p["slug"] for p in prods if p.get("listing_type") in ("digital", "both")]

    # Manual pick lists from settings (only keep still-published slugs)
    rows = await db.smart_section_settings.find(
        {"maker_slug": maker_slug, "key": {"$in": ["staff-picks", "featured"]}},
        {"_id": 0, "key": 1, "product_slugs": 1}).to_list(5)
    for r in rows:
        out[r["key"]] = [s for s in (r.get("product_slugs") or []) if s in slugs]

    for k in out:
        out[k] = out[k][:MAX_PER_SECTION]
    return out


async def _settings_map(maker_slug: str) -> dict:
    rows = await db.smart_section_settings.find(
        {"maker_slug": maker_slug}, {"_id": 0}).to_list(20)
    return {r["key"]: r for r in rows}


async def enabled_smart_sections(maker_slug: str) -> list:
    """Public payload: enabled smart sections with live membership + counts."""
    settings = await _settings_map(maker_slug)
    enabled = [k for k, *_ in SMART_DEFS if settings.get(k, {}).get("enabled")]
    if not enabled:
        return []
    members = await compute_smart_members(maker_slug)
    # A manual section owning the same slug wins — suppress the smart one.
    manual = {s["slug"] async for s in db.store_sections.find(
        {"maker_slug": maker_slug}, {"_id": 0, "slug": 1})}
    out = []
    for key, name, desc, auto in SMART_DEFS:
        if key in enabled and key not in manual:
            out.append({"key": key, "slug": key, "name": name,
                        "description": desc, "auto": auto,
                        "count": len(members[key]),
                        "product_slugs": members[key]})
    return out


class SmartUpdate(BaseModel):
    enabled: Optional[bool] = None
    product_slugs: Optional[List[str]] = None


@router.get("/maker/smart-sections")
async def maker_smart_sections(slug: str = Depends(current_maker_slug)):
    settings = await _settings_map(slug)
    members = await compute_smart_members(slug)
    rows = []
    for key, name, desc, auto in SMART_DEFS:
        st = settings.get(key, {})
        rows.append({
            "key": key, "name": name, "description": desc, "auto": auto,
            "enabled": bool(st.get("enabled")),
            "count": len(members[key]),
            "product_slugs": st.get("product_slugs") or [] if not auto else [],
            "preview": members[key][:6],
        })
    return {"sections": rows}


@router.patch("/maker/smart-sections/{key}")
async def update_smart_section(key: str, body: SmartUpdate,
                               slug: str = Depends(current_maker_slug)):
    if key not in SMART_KEYS:
        raise HTTPException(404, "Unknown smart section.")
    updates: dict = {"updated_at": now_iso()}
    if body.enabled is not None:
        updates["enabled"] = bool(body.enabled)
    if body.product_slugs is not None:
        _def = next(d for d in SMART_DEFS if d[0] == key)
        if _def[3]:
            raise HTTPException(400, "This smart section is automatic — products can't be hand-picked.")
        owned = {p["slug"] async for p in db.products.find(
            {"maker_slug": slug, "status": "published"}, {"_id": 0, "slug": 1})}
        updates["product_slugs"] = [
            s for s in dict.fromkeys(body.product_slugs) if s in owned][:MAX_PER_SECTION]
    await db.smart_section_settings.update_one(
        {"maker_slug": slug, "key": key}, {"$set": updates}, upsert=True)
    row = await db.smart_section_settings.find_one(
        {"maker_slug": slug, "key": key}, {"_id": 0})
    return {"ok": True, "setting": row}


@router.get("/makers/{maker_slug}/smart-sections")
async def public_smart_sections(maker_slug: str):
    return {"sections": await enabled_smart_sections(maker_slug)}
