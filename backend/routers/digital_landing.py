"""Digital Downloads marketplace landing and catalog endpoints.

These endpoints are intentionally thin discovery surfaces over the existing
Product listing model. Digital delivery, checkout, entitlement, and secure
download links continue to live in the existing digital_products/checkout
routers.
"""
from datetime import datetime, timedelta, timezone
import math
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from core import db

router = APIRouter()

# key, label, blurb, matcher spec
GROUPS = [
    ("svg-files", "SVG Files", "Cut-ready vector art for Cricut, Silhouette & more", {"exts": {"svg"}}),
    ("laser-files", "Laser Files", "DXF / AI / EPS files tuned for laser cutters", {"exts": {"dxf", "ai", "eps"}}),
    ("cnc-files", "CNC Files", "Toolpath-ready DXF, DWG & STEP files for routers & plasma", {"exts": {"dxf", "dwg", "step", "stp"}}),
    ("3d-print-files", "3D Print Files", "STL & 3MF models ready to slice", {"exts": {"stl", "3mf"}}),
    ("embroidery-patterns", "Embroidery Patterns", "Stitch files & patterns for machine embroidery", {"text": ("embroider",)}),
    ("woodworking-plans", "Woodworking Plans", "Build plans, templates & cut lists", {"text": ("plan", "template", "blueprint"), "category": "Woodworking"}),
    ("printable-pdfs", "Printable PDFs", "Print-at-home art, patterns & guides", {"exts": {"pdf"}}),
    ("ebooks", "eBooks", "EPUB guides & books from makers", {"exts": {"epub"}}),
    ("audiobooks", "Audiobooks", "MP3 audio from creators", {"exts": {"mp3"}}),
]

FORMAT_LABELS = {
    "svg": "SVG", "dxf": "DXF", "ai": "AI", "eps": "EPS", "pdf": "PDF",
    "stl": "STL", "3mf": "3MF", "zip": "ZIP", "png": "PNG", "jpg": "JPG",
    "jpeg": "JPG", "epub": "EPUB", "mp3": "MP3", "mp4": "MP4",
    "dwg": "DWG", "step": "STEP", "stp": "STP",
}
ALLOWED_SORTS = {"newest", "price_asc", "price_desc", "popularity", "rating"}
async def ensure_digital_marketplace_indexes() -> None:
    await db.products.create_index([("listing_type", 1), ("status", 1), ("deleted_at", 1), ("created_at", -1)])
    await db.products.create_index([("category", 1), ("listing_type", 1), ("status", 1)])
    await db.products.create_index("digital_files.ext")
    await db.events.create_index([("type", 1), ("product_slug", 1), ("created_at", -1)])
    await db.reviews.create_index([("product_slug", 1), ("published_publicly", 1)])


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def _safe_files(product: dict) -> list[dict]:
    safe = []
    for f in product.get("digital_files") or []:
        status = ((f.get("scan") or {}).get("status") or "clean").lower()
        if status in {"failed", "infected", "quarantined", "blocked"}:
            continue
        ext = (f.get("ext") or "").lower().lstrip(".")
        if ext:
            safe.append({
                "id": f.get("id"),
                "filename": f.get("filename"),
                "ext": ext,
                "size_bytes": f.get("size_bytes"),
                "version": f.get("version") or 1,
                "uploaded_at": f.get("uploaded_at"),
                "scan": {"status": (f.get("scan") or {}).get("status")},
            })
    return safe


def _eligible_query() -> dict:
    return {
        "listing_type": {"$in": ["digital", "both"]},
        "status": "published",
        "deleted_at": None,
        "digital_files.0": {"$exists": True},
    }


async def _eligible_products(limit: int = 5000) -> list[dict]:
    rows = await db.products.find(_eligible_query(), {"_id": 0}).to_list(limit)
    return [p for p in rows if _safe_files(p)]


def _matches(p: dict, spec: dict) -> bool:
    exts = {f.get("ext") for f in _safe_files(p)}
    if spec.get("exts") and exts & spec["exts"]:
        return True
    hay = " ".join([
        p.get("title") or "",
        p.get("description") or "",
        " ".join(p.get("tags") or p.get("seo_tags") or []),
        p.get("category") or "",
    ]).lower()
    if spec.get("text") and any(t in hay for t in spec["text"]):
        if not spec.get("category") or p.get("category") == spec["category"]:
            return True
    if spec.get("category") and not spec.get("text") and p.get("category") == spec["category"]:
        return True
    return False


def _public_product(p: dict, review: Optional[dict] = None) -> dict:
    files = _safe_files(p)
    exts = sorted({(f.get("ext") or "").lower() for f in files if f.get("ext")})
    out = {
        "id": p.get("id") or p.get("slug"),
        "slug": p.get("slug"),
        "title": p.get("title"),
        "description": p.get("description") or "",
        "price": p.get("price"),
        "images": p.get("images") or [],
        "image": (p.get("images") or [None])[0],
        "category": p.get("category"),
        "technique": p.get("technique"),
        "tags": p.get("tags") or p.get("seo_tags") or [],
        "maker_slug": p.get("maker_slug"),
        "maker_name": p.get("maker_name"),
        "listing_type": p.get("listing_type"),
        "digital_files": files,
        "file_formats": [FORMAT_LABELS.get(e, e.upper()) for e in exts],
        "download_limit": p.get("download_limit"),
        "download_ttl_days": p.get("download_ttl_days"),
        "instant_download": True,
        "personal_use": bool(p.get("personal_use") or p.get("license_personal_use") or True),
        "commercial_use": bool(p.get("commercial_use") or p.get("license_commercial_use")),
        "unlimited_downloads": p.get("download_limit") in (None, "", 0),
        "secure_file": True,
        "created_at": p.get("created_at"),
        "updated_at": p.get("updated_at") or p.get("created_at"),
        "in_stock": p.get("in_stock"),
        "featured": p.get("featured"),
        "promoted_until": p.get("promoted_until"),
        "maker_is_plus": bool(p.get("maker_is_plus")),
        "maker_is_veteran": bool(p.get("maker_is_veteran")),
    }
    if review:
        out["review_avg"] = round(float(review.get("avg") or 0), 2)
        out["review_count"] = int(review.get("count") or 0)
    return out


async def _review_map(slugs: list[str]) -> dict[str, dict]:
    if not slugs:
        return {}
    return {
        d["_id"]: {"avg": d.get("avg") or 0, "count": d.get("count") or 0}
        async for d in db.reviews.aggregate([
            {"$match": {"product_slug": {"$in": slugs}, "published_publicly": {"$ne": False}}},
            {"$group": {"_id": "$product_slug", "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
        ])
    }


async def _view_counts(slugs: list[str], days: int = 30) -> dict[str, int]:
    if not slugs:
        return {}
    since = (_now_utc() - timedelta(days=days)).isoformat()
    return {
        d["_id"]: int(d.get("count") or 0)
        async for d in db.events.aggregate([
            {"$match": {"type": "product_view", "product_slug": {"$in": slugs}, "created_at": {"$gte": since}}},
            {"$group": {"_id": "$product_slug", "count": {"$sum": 1}}},
        ])
    }


async def _maker_names(products: list[dict]) -> dict[str, dict]:
    slugs = sorted({p.get("maker_slug") for p in products if p.get("maker_slug")})
    if not slugs:
        return {}
    return {
        m["slug"]: m
        async for m in db.makers.find(
            {"slug": {"$in": slugs}, "deleted_at": {"$in": [None, ""]}},
            {"_id": 0, "slug": 1, "name": 1, "portrait": 1, "cover": 1, "bio": 1, "rating": 1},
        )
    }


def _haystack(p: dict, maker_name: str = "") -> str:
    fields = [
        p.get("title") or "",
        p.get("description") or "",
        p.get("category") or "",
        p.get("technique") or "",
        maker_name,
        " ".join(p.get("tags") or p.get("seo_tags") or []),
        " ".join((f.get("ext") or "") for f in _safe_files(p)),
    ]
    return " ".join(fields).lower()


@router.get("/digital-downloads/summary")
async def digital_downloads_summary():
    prods = await _eligible_products()
    makers = await _maker_names(prods)
    for p in prods:
        maker = makers.get(p.get("maker_slug")) or {}
        if maker and not p.get("maker_name"):
            p["maker_name"] = maker.get("name")
    seven_days_ago = _now_utc() - timedelta(days=7)
    groups = []
    for key, label, blurb, spec in GROUPS:
        hits = [p for p in prods if _matches(p, spec)]
        new_count = sum(
            1 for p in hits
            if (_parse_iso(p.get("created_at")) or datetime(1970, 1, 1, tzinfo=timezone.utc)) >= seven_days_ago
        )
        groups.append({
            "key": key,
            "label": label,
            "blurb": blurb,
            "count": len(hits),
            "new_7d": new_count,
            "browse_url": f"/digital-downloads/category/{key}",
            "samples": [{
                "slug": p["slug"],
                "title": p["title"],
                "price": p.get("price"),
                "image": (p.get("images") or [None])[0],
                "maker_name": p.get("maker_name"),
            } for p in hits[:4]],
        })
    return {"total_digital": len(prods), "groups": groups}


@router.get("/digital-downloads/search")
async def digital_downloads_search(q: str = Query("", min_length=0), limit: int = 8):
    q = (q or "").strip().lower()
    limit = max(1, min(12, int(limit or 8)))
    if len(q) < 2:
        return {"results": []}
    prods = await _eligible_products(2000)
    makers = await _maker_names(prods)
    hits = []
    for p in prods:
        maker = makers.get(p.get("maker_slug")) or {}
        maker_name = p.get("maker_name") or maker.get("name") or ""
        if q not in _haystack(p, maker_name):
            continue
        item = _public_product({**p, "maker_name": maker_name})
        item["url"] = f"/shop/{p.get('slug')}"
        hits.append(item)
    hits.sort(key=lambda p: (0 if (p.get("title") or "").lower().startswith(q) else 1, (p.get("title") or "").lower()))
    return {"results": hits[:limit]}


def _filter_products(products: list[dict], *, category: Optional[str], q: Optional[str], fmt: Optional[str], price: str, license: Optional[str], instant_download: Optional[bool]) -> list[dict]:
    if category:
        spec = next((g[3] for g in GROUPS if g[0] == category), None)
        if spec is None:
            raise HTTPException(400, "Invalid digital category.")
        products = [p for p in products if _matches(p, spec)]
    if fmt:
        wanted = fmt.lower().lstrip(".")
        if wanted not in FORMAT_LABELS:
            raise HTTPException(400, "Invalid file format.")
        products = [p for p in products if wanted in {(f.get("ext") or "").lower() for f in _safe_files(p)}]
    if price == "free":
        products = [p for p in products if float(p.get("price") or 0) <= 0]
    elif price == "paid":
        products = [p for p in products if float(p.get("price") or 0) > 0]
    elif price != "all":
        raise HTTPException(400, "Invalid price filter.")
    if license == "commercial":
        products = [p for p in products if bool(p.get("commercial_use") or p.get("license_commercial_use"))]
    elif license == "personal":
        products = [p for p in products if bool(p.get("personal_use") or p.get("license_personal_use") or True)]
    elif license:
        raise HTTPException(400, "Invalid license filter.")
    if instant_download is not None and instant_download is False:
        products = []
    if q:
        ql = q.strip().lower()
        products = [p for p in products if ql in _haystack(p, p.get("maker_name") or "")]
    return products


@router.get("/digital-downloads/catalog")
async def digital_downloads_catalog(
    q: Optional[str] = None,
    category: Optional[str] = None,
    format: Optional[str] = None,
    price: str = "all",
    license: Optional[str] = None,
    instant_download: Optional[bool] = None,
    sort: str = "newest",
    page: int = 1,
    per_page: int = 24,
):
    sort = (sort or "newest").lower()
    if sort not in ALLOWED_SORTS:
        raise HTTPException(400, "Invalid sort.")
    page = max(1, int(page or 1))
    per_page = max(1, min(48, int(per_page or 24)))
    prods = await _eligible_products()
    makers = await _maker_names(prods)
    for p in prods:
        maker = makers.get(p.get("maker_slug")) or {}
        if maker and not p.get("maker_name"):
            p["maker_name"] = maker.get("name")

    filtered = _filter_products(prods, category=category, q=q, fmt=format, price=price, license=license, instant_download=instant_download)
    slugs = [p.get("slug") for p in filtered if p.get("slug")]
    reviews = await _review_map(slugs)
    views = await _view_counts(slugs)

    if sort == "price_asc":
        filtered.sort(key=lambda p: float(p.get("price") or 0))
    elif sort == "price_desc":
        filtered.sort(key=lambda p: float(p.get("price") or 0), reverse=True)
    elif sort == "popularity":
        filtered.sort(key=lambda p: (views.get(p.get("slug") or "", 0), p.get("created_at") or ""), reverse=True)
    elif sort == "rating":
        filtered.sort(
            key=lambda p: (
                int((reviews.get(p.get("slug") or "") or {}).get("count") or 0) >= 1,
                float((reviews.get(p.get("slug") or "") or {}).get("avg") or 0),
                int((reviews.get(p.get("slug") or "") or {}).get("count") or 0),
            ),
            reverse=True,
        )
    else:
        filtered.sort(key=lambda p: p.get("created_at") or "", reverse=True)

    all_exts = sorted({
        (f.get("ext") or "").lower()
        for p in prods
        for f in _safe_files(p)
        if (f.get("ext") or "").lower() in FORMAT_LABELS
    })
    total = len(filtered)
    start = (page - 1) * per_page
    items = [_public_product(p, reviews.get(p.get("slug") or "")) for p in filtered[start:start + per_page]]
    return {
        "items": items,
        "page": page,
        "per_page": per_page,
        "total": total,
        "pages": math.ceil(total / per_page) if total else 0,
        "facets": {
            "formats": [{"value": e, "label": FORMAT_LABELS.get(e, e.upper())} for e in all_exts],
            "categories": [{"value": k, "label": label} for k, label, *_ in GROUPS],
        },
    }


@router.get("/digital-downloads/sections")
async def digital_downloads_sections():
    prods = await _eligible_products()
    makers = await _maker_names(prods)
    for p in prods:
        maker = makers.get(p.get("maker_slug")) or {}
        if maker and not p.get("maker_name"):
            p["maker_name"] = maker.get("name")
    slugs = [p.get("slug") for p in prods if p.get("slug")]
    reviews = await _review_map(slugs)
    views = await _view_counts(slugs, days=14)
    seven_days_ago = _now_utc() - timedelta(days=7)

    def pub(rows):
        return [_public_product(p, reviews.get(p.get("slug") or "")) for p in rows[:8]]

    trending = sorted(prods, key=lambda p: views.get(p.get("slug") or "", 0), reverse=True)
    new_week = sorted(
        [p for p in prods if (_parse_iso(p.get("created_at")) or datetime(1970, 1, 1, tzinfo=timezone.utc)) >= seven_days_ago],
        key=lambda p: p.get("created_at") or "",
        reverse=True,
    )
    laser_cnc = [p for p in prods if _matches(p, {"exts": {"dxf", "ai", "eps", "dwg", "step", "stp"}})]
    printable = [p for p in prods if _matches(p, {"exts": {"pdf", "png", "jpg", "jpeg"}})]

    maker_counts = {}
    for p in prods:
        if p.get("maker_slug"):
            maker_counts[p["maker_slug"]] = maker_counts.get(p["maker_slug"], 0) + 1
    featured_creator = None
    if maker_counts:
        slug = max(maker_counts, key=maker_counts.get)
        maker = makers.get(slug)
        if maker:
            featured_creator = {
                "maker": maker,
                "digital_count": maker_counts[slug],
                "products": pub([p for p in prods if p.get("maker_slug") == slug]),
            }

    free_downloads = [p for p in prods if float(p.get("price") or 0) <= 0]
    recently_updated = sorted([p for p in prods if p.get("updated_at")], key=lambda p: p.get("updated_at") or "", reverse=True)
    bundles = [p for p in prods if "bundle" in " ".join([p.get("title") or "", p.get("category") or "", " ".join(p.get("seo_tags") or p.get("tags") or [])]).lower()]
    staff_picks = sorted(prods, key=lambda p: (int(p.get("staff_pick") is True), int((reviews.get(p.get("slug") or "") or {}).get("count") or 0), p.get("created_at") or ""), reverse=True)
    featured_collections = []
    for key, label, _desc, match in GROUPS:
        rows = [p for p in prods if _matches(p, match)]
        if rows:
            featured_collections.append({"key": key, "label": label, "count": len(rows), "products": pub(rows)})

    return {
        "sections": {
            "trending": pub([p for p in trending if views.get(p.get("slug") or "", 0) > 0] or trending),
            "new_this_week": pub(new_week),
            "laser_cnc": pub(laser_cnc),
            "printable_projects": pub(printable),
            "staff_picks": pub(staff_picks),
            "free_downloads": pub(free_downloads),
            "recently_updated": pub(recently_updated),
            "recommended_for_you": pub(trending),
            "bundle_highlights": pub(bundles),
            "featured_collections": featured_collections[:6],
        },
        "featured_creator": featured_creator,
    }
