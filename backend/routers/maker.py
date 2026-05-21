"""Maker self-serve portal: magic-link auth + profile / products / orders endpoints."""
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict

from core import db, logger, now_iso
from email_service import send_maker_magic_link, send_buyer_shipped
from maker_auth import (
    current_maker_slug, issue_magic_token, issue_session_jwt, verify_magic_token,
)
from models import (
    Maker, MakerLoginRequest, MakerProductCreate, MakerProfileUpdate,
    MakerVerifyRequest, Product, ProductVariant,
)

router = APIRouter()


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(s: str) -> str:
    s = (s or "").lower().strip()
    s = _SLUG_RE.sub("-", s).strip("-")
    return s[:80] or "listing"


async def _upload_listing_image(
    data_url: str, maker_slug: str, key_prefix: str,
) -> Optional[str]:
    """Watermark-aware upload of a single base64 data URL to R2.

    Reads `watermark_images` + `name` off the maker doc. When watermarking
    is ON, decodes → composites a tiled diagonal label + corner stamp →
    re-encodes as JPEG → uploads. Otherwise falls back to the standard
    `upload_data_url` passthrough.

    Returns the public R2 URL, or None if R2 isn't configured or the
    input wasn't a valid image data URL (caller decides the fallback).
    Raises HTTPException(502) on R2 failures (caller should let it bubble).
    """
    try:
        from r2_storage import (
            ALLOWED_CONTENT_TYPES,
            is_configured as _r2_ok,
            upload_bytes,
            upload_data_url,
        )
    except Exception:
        return None
    if not _r2_ok():
        return None

    maker_doc = await db.makers.find_one(
        {"slug": maker_slug}, {"_id": 0, "watermark_images": 1, "name": 1},
    )
    wm_on = bool(maker_doc and maker_doc.get("watermark_images"))
    shop_name = (maker_doc or {}).get("name") or maker_slug

    if wm_on:
        from image_watermark import maybe_watermark_data_url
        result = maybe_watermark_data_url(data_url, shop_name)
        if result is not None:
            wm_bytes, wm_ct = result
            ext = ALLOWED_CONTENT_TYPES.get(wm_ct, "jpg")
            key = f"{key_prefix.rstrip('/')}/{uuid.uuid4().hex}.{ext}"
            return upload_bytes(wm_bytes, key, wm_ct)
    return upload_data_url(data_url, key_prefix=key_prefix)


@router.post("/maker/auth/request")
async def maker_auth_request(payload: MakerLoginRequest, bg: BackgroundTasks):
    """Send a magic link if a maker with that email exists. Always returns 200 (no enumeration)."""
    email = payload.email.lower().strip()
    maker = await db.makers.find_one({"email": email}, {"_id": 0})
    if maker:
        token = issue_magic_token(email)
        link = f"{payload.origin_url.rstrip('/')}/maker/verify?token={token}"
        bg.add_task(send_maker_magic_link, email, maker["name"], link)
        logger.info("magic link issued for maker=%s", maker["slug"])
    else:
        logger.info("magic link requested for unknown email=%s (silent)", email)
    return {"sent": True, "message": "If that email matches a maker on file, a sign-in link is on its way."}


@router.post("/maker/auth/verify")
async def maker_auth_verify(payload: MakerVerifyRequest):
    email = verify_magic_token(payload.token)
    maker = await db.makers.find_one({"email": email}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker no longer exists.")
    jwt_token = issue_session_jwt(maker["slug"], email)
    return {"token": jwt_token, "maker": maker}


@router.get("/maker/me", response_model=Maker)
async def maker_me(slug: str = Depends(current_maker_slug)):
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found")
    return maker


@router.patch("/maker/profile", response_model=Maker)
async def maker_update_profile(
    payload: MakerProfileUpdate,
    slug: str = Depends(current_maker_slug),
):
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if updates:
        await db.makers.update_one({"slug": slug}, {"$set": updates})
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found")
    return maker


@router.get("/maker/products", response_model=List[Product])
async def maker_products(slug: str = Depends(current_maker_slug)):
    return await db.products.find({"maker_slug": slug}, {"_id": 0}).sort("created_at", -1).to_list(200)


class MakerProductUpdate(BaseModel):
    """Fields a maker is allowed to edit on their own products."""
    model_config = ConfigDict(extra="ignore")
    title: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    in_stock: Optional[int] = None
    category: Optional[str] = None
    technique: Optional[str] = None
    materials: Optional[List[str]] = None
    dimensions: Optional[str] = None
    model_url: Optional[str] = None
    video_url: Optional[str] = None
    images: Optional[List[str]] = None
    variants: Optional[List["ProductVariantInput"]] = None
    variant_axis1_name: Optional[str] = None
    variant_axis2_name: Optional[str] = None
    status: Optional[str] = None     # "draft" | "published"
    # Extended fields — all optional so PATCH only updates what's sent.
    who_made_it: Optional[str] = None
    condition: Optional[str] = None
    length_in: Optional[float] = None
    width_in: Optional[float] = None
    height_in: Optional[float] = None
    dim_unit: Optional[str] = None
    weight_lbs: Optional[float] = None
    weight_oz: Optional[float] = None
    colors: Optional[List[str]] = None
    occasions: Optional[List[str]] = None
    personalization_enabled: Optional[bool] = None
    personalization_instructions: Optional[str] = None
    free_shipping: Optional[bool] = None
    shipping_domestic_usd: Optional[float] = None
    shipping_international_usd: Optional[float] = None
    shipping_carrier: Optional[str] = None
    shipping_est_delivery: Optional[str] = None
    processing_time: Optional[str] = None
    packed_length_in: Optional[float] = None
    packed_width_in: Optional[float] = None
    packed_height_in: Optional[float] = None
    accept_returns: Optional[bool] = None
    accept_exchanges: Optional[bool] = None
    seo_tags: Optional[List[str]] = None
    contact_email: Optional[str] = None
    accepts_backorders: Optional[bool] = None
    backorder_lead_weeks: Optional[int] = None
    renewal_option: Optional[str] = None  # "automatic" | "manual"


class ProductVariantInput(BaseModel):
    """Variant payload for PATCH — same validation as create."""
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    label: str
    price_delta: float = 0.0
    in_stock: int = 0
    axis1: Optional[str] = None
    axis2: Optional[str] = None
    image: Optional[str] = None


MakerProductUpdate.model_rebuild()


@router.patch("/maker/products/{product_slug}", response_model=Product)
async def maker_update_product(
    product_slug: str, payload: MakerProductUpdate,
    bg: BackgroundTasks,
    slug: str = Depends(current_maker_slug),
):
    prod = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    if not prod:
        raise HTTPException(404, "Product not found")
    if prod.get("maker_slug") != slug:
        raise HTTPException(403, "You can only edit your own listings.")
    if payload.status and payload.status not in ("draft", "published"):
        raise HTTPException(400, "status must be 'draft' or 'published'.")
    if payload.seo_tags is not None and len(payload.seo_tags) > 13:
        raise HTTPException(400, "Maximum 13 SEO tags per listing.")
    if payload.renewal_option is not None and payload.renewal_option not in ("automatic", "manual"):
        raise HTTPException(400, "renewal_option must be 'automatic' or 'manual'.")
    if payload.variants is not None:
        for v in payload.variants:
            if not v.label.strip():
                raise HTTPException(400, "Each variant needs a label.")
            if v.in_stock < 0:
                raise HTTPException(400, "Variant stock must be non-negative.")

    # If the patch includes new images as data URLs (the editor still
    # ships them as base64 until upload), push them through R2 with the
    # same watermark-aware pipeline used on create. http(s) URLs pass
    # straight through.
    if payload.images is not None:
        new_images: List[str] = []
        for img in payload.images:
            if isinstance(img, str) and img.startswith("data:"):
                try:
                    url = await _upload_listing_image(img, slug, f"products/{slug}")
                    new_images.append(url or img)
                except HTTPException:
                    raise
                except Exception as e:
                    logger.exception("R2 upload (patch) failed for maker=%s: %s", slug, e)
                    raise HTTPException(502, "Could not upload image to storage.")
            else:
                new_images.append(img)
        payload.images = new_images

    if payload.variants is not None:
        for v in payload.variants:
            if v.image and isinstance(v.image, str) and v.image.startswith("data:"):
                try:
                    url = await _upload_listing_image(
                        v.image, slug, f"products/{slug}/variants",
                    )
                    if url:
                        v.image = url
                except HTTPException:
                    raise
                except Exception as e:
                    logger.exception("R2 variant upload (patch) failed maker=%s: %s", slug, e)
                    raise HTTPException(502, "Could not upload variant image.")

    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if updates:
        await db.products.update_one({"slug": product_slug}, {"$set": updates})
    updated = await db.products.find_one({"slug": product_slug}, {"_id": 0})

    # If the maker just raised stock from 0 → positive, drain the
    # restock waitlist and email everyone who asked to be notified.
    if "in_stock" in updates:
        try:
            from routers.restock_waitlist import fire_restock_notifications_if_needed
            await fire_restock_notifications_if_needed(
                product_id=prod["id"],
                prev_stock=int(prod.get("in_stock") or 0),
                new_stock=int(updated.get("in_stock") or 0),
                bg=bg,
            )
        except Exception as e:
            logger.exception("restock notify dispatch failed: %s", e)
    return updated


@router.post("/maker/products/{product_slug}/publish", response_model=Product)
async def maker_publish_product(
    product_slug: str, bg: BackgroundTasks,
    slug: str = Depends(current_maker_slug),
):
    """Publish a draft listing. Accrues a $0.20 fee if past the free quota and
    sets a fresh expiry timestamp (renews the listing).

    Idempotent: republishing an already-live listing does NOT re-charge the
    listing fee (use /renew for that path)."""
    from revenue import accrue_listing_charge, expiry_iso_from_now
    prod = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    if not prod or prod.get("maker_slug") != slug:
        raise HTTPException(404, "Product not found")
    was_already_published = prod.get("status") == "published" and not prod.get("deleted_at")
    if not was_already_published:
        await accrue_listing_charge(slug, product_slug, kind="listing_publish")
    await db.products.update_one(
        {"slug": product_slug},
        {"$set": {
            "status": "published",
            "expires_at": expiry_iso_from_now(),
            "renewal_reminder_sent_at": None,
        }},
    )
    updated = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    # Fire notifications in the background — keeps the API response snappy
    # even when the listing has hundreds of followers. notify_listing_published
    # is idempotent so re-publishes won't re-broadcast.
    from listing_notify import notify_listing_published
    bg.add_task(_safe_notify_listing_published, product_slug)
    return updated


async def _safe_notify_listing_published(product_slug: str) -> None:
    """Wrapper so a transient email outage doesn't bubble up as an unhandled
    BackgroundTasks exception (which logs noisy stack traces)."""
    try:
        from listing_notify import notify_listing_published
        await notify_listing_published(product_slug)
    except Exception as e:
        logger.exception("[bg/notify] listing-publish notify failed: %s", e)


@router.post("/maker/products/{product_slug}/renew", response_model=Product)
async def maker_renew_product(product_slug: str, slug: str = Depends(current_maker_slug)):
    """Renew an expired listing (or extend a live one). Same $0.20 listing fee."""
    from revenue import accrue_listing_charge, expiry_iso_from_now
    prod = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    if not prod or prod.get("maker_slug") != slug:
        raise HTTPException(404, "Product not found")
    await accrue_listing_charge(slug, product_slug, kind="listing_renew")
    await db.products.update_one(
        {"slug": product_slug},
        {
            "$set": {
                "status": "published",
                "expires_at": expiry_iso_from_now(),
                "renewal_reminder_sent_at": None,
            },
            "$inc": {"renewals_count": 1},
        },
    )
    return await db.products.find_one({"slug": product_slug}, {"_id": 0})



# ────────────────────────────────────────────────────────────────────
# Per-listing stats panel (Etsy-style) + Renewals dashboard
# ────────────────────────────────────────────────────────────────────
@router.get("/maker/products/stats")
async def maker_products_stats(slug: str = Depends(current_maker_slug)):
    """Return Etsy-style per-listing stats keyed by product slug:

        { <slug>: {
            visits_30d:   int,
            sales_all:    int,
            revenue_all:  float,
            renewals:     int,
            expires_at:   ISO | None,
            renewal_mode: "automatic" | "manual",
            smart_paused_at: ISO | None,
        }, ... }

    All numbers come from collections we already maintain — no new
    instrumentation. Visits use `pageview_events.path` startsWith
    /shop/<slug>; sales/revenue come from `transactions.items`."""
    from datetime import timedelta
    cutoff_30d = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat().replace("+00:00", "Z")

    products = await db.products.find(
        {"maker_slug": slug},
        {
            "_id": 0, "slug": 1, "expires_at": 1,
            "renewal_option": 1, "renewals_count": 1,
            "smart_paused_at": 1,
        },
    ).to_list(500)
    out: dict[str, dict] = {}
    for p in products:
        out[p["slug"]] = {
            "visits_30d": 0,
            "sales_all": 0,
            "revenue_all": 0.0,
            "renewals": int(p.get("renewals_count") or 0),
            "expires_at": p.get("expires_at"),
            "renewal_mode": p.get("renewal_option") or "automatic",
            "smart_paused_at": p.get("smart_paused_at"),
        }
    if not out:
        return out

    # Visits — single aggregation over pageview_events for all slugs.
    slugs = list(out.keys())
    paths = [f"/shop/{s}" for s in slugs]
    pipe = [
        {"$match": {"ts": {"$gte": cutoff_30d}, "path": {"$in": paths}}},
        {"$group": {"_id": "$path", "n": {"$sum": 1}}},
    ]
    async for row in db.pageview_events.aggregate(pipe):
        s = (row.get("_id") or "").rsplit("/", 1)[-1]
        if s in out:
            out[s]["visits_30d"] = int(row.get("n") or 0)

    # Sales + revenue — pulled from paid transactions. Iterate once.
    orders = await db.transactions.find(
        {"items.maker_slug": slug, "payment_status": "paid"},
        {"_id": 0, "items": 1},
    ).to_list(5000)
    for o in orders:
        for line in o.get("items", []) or []:
            s = line.get("slug") or line.get("product_slug")
            if s and s in out and line.get("maker_slug") == slug:
                qty = int(line.get("quantity") or 1)
                price = float(line.get("price") or 0)
                out[s]["sales_all"] += qty
                out[s]["revenue_all"] += price * qty

    for s in out:
        out[s]["revenue_all"] = round(out[s]["revenue_all"], 2)
    return out



@router.get("/maker/products/indexing-status")
async def maker_products_indexing_status(slug: str = Depends(current_maker_slug)):
    """Per-listing sitemap inclusion status (proxy for Google indexing).

    We can't query Google's actual index without GSC OAuth — but we CAN
    tell the maker exactly what state our sitemap is in for their listings.
    That's enough to drive a useful 3-tier badge:

      • "established"     — in sitemap AND created >7 days ago.
                             Google has had a full crawl cycle to find it.
      • "submitted"       — in sitemap AND created within last 7 days.
                             Submitted but Googlebot may not have visited yet.
      • "not_in_sitemap"  — listing is draft, deleted, or filtered as a
                             test slug. Won't surface in organic search.

    A listing is in our sitemap iff status != "draft" AND deleted_at is None
    AND its slug isn't a test/seed artifact (see _is_test_slug in seo.py).
    """
    from routers.seo import _is_test_slug  # share the test-slug heuristic
    now = datetime.now(timezone.utc)
    cutoff_7d = now - timedelta(days=7)

    products = await db.products.find(
        {"maker_slug": slug},
        {
            "_id": 0, "slug": 1, "status": 1, "deleted_at": 1, "created_at": 1,
            "gsc_tier": 1, "gsc_checked_at": 1, "gsc_coverage": 1,
        },
    ).to_list(500)

    out: dict[str, dict] = {}
    for p in products:
        s = p["slug"]
        in_sitemap = (
            p.get("status") != "draft"
            and not p.get("deleted_at")
            and not _is_test_slug(s)
        )
        days_in_sitemap = None
        tier = "not_in_sitemap"
        if in_sitemap:
            try:
                created = datetime.fromisoformat(
                    (p.get("created_at") or "").replace("Z", "+00:00"),
                )
                days_in_sitemap = max(0, int((now - created).total_seconds() // 86400))
            except Exception:
                days_in_sitemap = 0
            try:
                created_dt = datetime.fromisoformat(
                    (p.get("created_at") or "").replace("Z", "+00:00"),
                )
                tier = "established" if created_dt < cutoff_7d else "submitted"
            except Exception:
                tier = "submitted"  # conservative when timestamps are missing
        # Prefer real GSC data when we have a recent inspection (<=14 days).
        gsc_tier = p.get("gsc_tier")
        gsc_at_iso = p.get("gsc_checked_at") or ""
        gsc_fresh = False
        if gsc_tier and gsc_at_iso:
            try:
                gsc_at = datetime.fromisoformat(gsc_at_iso.replace("Z", "+00:00"))
                gsc_fresh = (now - gsc_at).days <= 14
            except Exception:
                gsc_fresh = False
        out[s] = {
            "tier": gsc_tier if gsc_fresh else tier,
            "in_sitemap": in_sitemap,
            "days_in_sitemap": days_in_sitemap,
            # Surface the source so the UI can show "verified by Google"
            # vs "heuristic" if we ever want to differentiate.
            "source": "gsc" if gsc_fresh else "sitemap",
            "gsc_coverage": p.get("gsc_coverage") if gsc_fresh else None,
            "gsc_checked_at": gsc_at_iso if gsc_fresh else None,
        }
    return out



@router.get("/maker/renewals/summary")
async def maker_renewals_summary(slug: str = Depends(current_maker_slug)):
    """Renewal dashboard widget data + calendar grid for the next 30 days.

    Response shape:
        {
          counts: {next_7d, next_14d, next_30d, total_auto, total_manual},
          listings: [{slug, title, image, expires_at, renewal_mode, days_left}],
          calendar: [{date, count, listings: [{slug, title}]}],   # 30 entries
        }
    """
    now = datetime.now(timezone.utc)
    h7 = (now + timedelta(days=7)).isoformat()
    h14 = (now + timedelta(days=14)).isoformat()
    h30 = (now + timedelta(days=30)).isoformat()
    nowiso = now.isoformat()

    base_match = {
        "maker_slug": slug,
        "deleted_at": None,
        "status": "published",
        "expires_at": {"$ne": None},
    }

    cursor = db.products.find(
        base_match,
        {
            "_id": 0, "slug": 1, "title": 1, "images": 1,
            "expires_at": 1, "renewal_option": 1,
        },
    ).sort("expires_at", 1)
    products = await cursor.to_list(500)

    listings: list[dict] = []
    next_7d = next_14d = next_30d = 0
    total_auto = total_manual = 0
    for p in products:
        exp = p.get("expires_at") or ""
        mode = p.get("renewal_option") or "automatic"
        if mode == "manual":
            total_manual += 1
        else:
            total_auto += 1
        if exp >= nowiso and exp <= h7:
            next_7d += 1
        if exp >= nowiso and exp <= h14:
            next_14d += 1
        if exp >= nowiso and exp <= h30:
            next_30d += 1
        try:
            d = datetime.fromisoformat(exp.replace("Z", "+00:00"))
            days_left = max(0, int((d - now).total_seconds() // 86400))
        except Exception:
            days_left = None
        listings.append({
            "slug": p["slug"],
            "title": p.get("title") or p["slug"],
            "image": (p.get("images") or [None])[0],
            "expires_at": exp,
            "renewal_mode": mode,
            "days_left": days_left,
        })

    # Calendar — 30-day grid starting today, with listings expiring on each day.
    cal: list[dict] = []
    for i in range(30):
        day = (now + timedelta(days=i)).date().isoformat()
        cal.append({"date": day, "count": 0, "listings": []})
    by_date = {row["date"]: row for row in cal}
    for li in listings:
        try:
            d = datetime.fromisoformat(li["expires_at"].replace("Z", "+00:00")).date().isoformat()
        except Exception:
            continue
        row = by_date.get(d)
        if row is not None:
            row["count"] += 1
            if len(row["listings"]) < 4:
                row["listings"].append({"slug": li["slug"], "title": li["title"]})
    return {
        "counts": {
            "next_7d": next_7d,
            "next_14d": next_14d,
            "next_30d": next_30d,
            "total_auto": total_auto,
            "total_manual": total_manual,
        },
        "listings": listings,
        "calendar": cal,
    }


# ────────────────────────────────────────────────────────────────────
# Bulk renewal actions
# ────────────────────────────────────────────────────────────────────
class BulkSlugs(BaseModel):
    """Payload for bulk-mutation endpoints — list of product slugs owned
    by the caller. Validation is per-row server-side; unknown slugs are
    silently skipped so a stale UI list doesn't blow up the whole call."""
    model_config = ConfigDict(extra="ignore")
    slugs: List[str]


class BulkRenewalOption(BulkSlugs):
    renewal_option: str  # "automatic" | "manual"


@router.post("/maker/products/bulk-renew")
async def maker_bulk_renew(
    payload: BulkSlugs, slug: str = Depends(current_maker_slug),
):
    """Renew every owned listing in `slugs` (accrues the standard fee for
    each, just like the per-listing /renew endpoint). Returns per-slug
    outcomes so the UI can surface partial failures."""
    from revenue import accrue_listing_charge, expiry_iso_from_now
    if not payload.slugs:
        return {"renewed": [], "skipped": [], "errors": []}
    renewed: list[str] = []
    skipped: list[dict] = []
    errors: list[dict] = []
    for s in payload.slugs[:200]:
        try:
            prod = await db.products.find_one(
                {"slug": s, "maker_slug": slug, "deleted_at": None},
                {"_id": 0, "slug": 1},
            )
            if not prod:
                skipped.append({"slug": s, "reason": "not_found_or_not_owned"})
                continue
            await accrue_listing_charge(slug, s, kind="listing_bulk_renew")
            await db.products.update_one(
                {"slug": s},
                {
                    "$set": {
                        "status": "published",
                        "expires_at": expiry_iso_from_now(),
                        "renewal_reminder_sent_at": None,
                    },
                    "$inc": {"renewals_count": 1},
                },
            )
            renewed.append(s)
        except Exception as e:
            errors.append({"slug": s, "error": str(e)[:200]})
    return {"renewed": renewed, "skipped": skipped, "errors": errors}


@router.post("/maker/products/bulk-renewal-option")
async def maker_bulk_renewal_option(
    payload: BulkRenewalOption, slug: str = Depends(current_maker_slug),
):
    """Flip the renewal mode for every owned listing in `slugs`. Cheap —
    no fees, no expiry mutation."""
    if payload.renewal_option not in ("automatic", "manual"):
        raise HTTPException(400, "renewal_option must be 'automatic' or 'manual'.")
    if not payload.slugs:
        return {"updated": 0}
    res = await db.products.update_many(
        {"slug": {"$in": payload.slugs[:500]}, "maker_slug": slug, "deleted_at": None},
        {"$set": {"renewal_option": payload.renewal_option}},
    )
    return {"updated": int(res.modified_count or 0)}


@router.post("/maker/products/bulk-pause")
async def maker_bulk_pause(
    payload: BulkSlugs, slug: str = Depends(current_maker_slug),
):
    """Bulk-flip published listings to draft. Maker-initiated 'pause' —
    listing stops showing in search until they republish."""
    if not payload.slugs:
        return {"paused": 0}
    res = await db.products.update_many(
        {
            "slug": {"$in": payload.slugs[:500]},
            "maker_slug": slug,
            "deleted_at": None,
            "status": "published",
        },
        {"$set": {"status": "draft"}},
    )
    return {"paused": int(res.modified_count or 0)}




@router.post("/maker/products/{product_slug}/duplicate", response_model=Product)
async def maker_duplicate_product(
    product_slug: str, slug: str = Depends(current_maker_slug),
):
    """One-click clone — copy the product as a new draft. Title gets `(copy)`
    appended; slug + id are regenerated; lifecycle fields (`expires_at`,
    `promoted_until`, `created_at`) are reset; `deleted_at` is cleared.
    Variant rows keep their labels but get fresh ids so editing the clone
    doesn't mutate the source."""
    src = await db.products.find_one(
        {"slug": product_slug, "maker_slug": slug, "deleted_at": None}, {"_id": 0},
    )
    if not src:
        raise HTTPException(404, "Product not found.")
    base_slug = re.sub(r"[^a-z0-9-]", "-", src["slug"].split("-copy")[0]).strip("-") or "listing"
    candidate = f"{base_slug}-copy-{uuid.uuid4().hex[:6]}"
    new_title = src["title"]
    if not new_title.lower().endswith("(copy)"):
        new_title = f"{new_title} (copy)"[:80]
    new_id = str(uuid.uuid4())
    fresh_variants = []
    for v in (src.get("variants") or []):
        fresh_variants.append({**v, "id": str(uuid.uuid4())})
    clone = {
        **src,
        "id": new_id,
        "slug": candidate,
        "title": new_title,
        "status": "draft",
        "expires_at": None,
        "promoted_until": None,
        "deleted_at": None,
        "featured": False,
        "variants": fresh_variants,
        "created_at": now_iso(),
    }
    await db.products.insert_one(clone)
    clone.pop("_id", None)
    logger.info("[maker] duplicated %s → %s for %s", product_slug, candidate, slug)
    return clone



@router.post("/maker/products/{product_slug}/promote", response_model=Product)
async def maker_promote_product(
    product_slug: str, weeks: int = 1, slug: str = Depends(current_maker_slug),
):
    """Pin this listing to the top of search & category for `weeks` weeks at
    flat $5/week. Charge accrues to maker's pending balance immediately."""
    from revenue import accrue_promotion_charge, promotion_until_iso
    if weeks < 1 or weeks > 52:
        raise HTTPException(400, "weeks must be between 1 and 52.")
    prod = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    if not prod or prod.get("maker_slug") != slug:
        raise HTTPException(404, "Product not found")
    if prod.get("status") != "published" or prod.get("deleted_at"):
        raise HTTPException(400, "Only published listings can be promoted.")
    await accrue_promotion_charge(slug, product_slug, weeks=weeks)
    await db.products.update_one(
        {"slug": product_slug},
        {"$set": {"promoted_until": promotion_until_iso(weeks)}},
    )
    return await db.products.find_one({"slug": product_slug}, {"_id": 0})


class AutoRenewPromotionToggle(BaseModel):
    enabled: bool


# ───────────── Community boost credits ─────────────
@router.get("/maker/boost-credits")
async def maker_boost_credits(slug: str = Depends(current_maker_slug)):
    """Free 24h promotion credits earned by uploading at least one design
    file to the community in a given calendar week. Idempotent per ISO
    week — see `community.grant_weekly_boost_credit`. Returns only the
    unredeemed, unexpired credits the maker can spend right now."""
    now_iso_str = now_iso()
    rows = await db.community_boost_credits.find(
        {
            "maker_slug": slug,
            "consumed_at": None,
            "expires_at": {"$gt": now_iso_str},
        },
        {"_id": 0},
    ).sort("granted_at", 1).to_list(50)
    # Plus a lifetime stat for "you've earned N total" UI flourish.
    lifetime = await db.community_boost_credits.count_documents({"maker_slug": slug})
    return {"credits": rows, "available": len(rows), "lifetime_earned": lifetime}


class BoostCreditRedeem(BaseModel):
    product_slug: str


@router.post("/maker/boost-credits/{credit_id}/redeem", response_model=Product)
async def maker_redeem_boost_credit(
    credit_id: str, body: BoostCreditRedeem,
    slug: str = Depends(current_maker_slug),
):
    """Spend a 24h boost credit on one of the caller's published
    listings. Bumps `promoted_until` by 24h from now (or extends an
    existing promotion by another 24h). Marks the credit consumed.
    All-or-nothing — if the listing isn't owned/published, the credit
    stays unused so the maker can re-target.
    """
    credit = await db.community_boost_credits.find_one(
        {"id": credit_id, "maker_slug": slug, "consumed_at": None},
        {"_id": 0},
    )
    if not credit:
        raise HTTPException(404, "Credit not found or already used.")
    now = datetime.now(timezone.utc)
    if credit.get("expires_at") and credit["expires_at"] < now.isoformat():
        raise HTTPException(410, "This credit has expired. New uploads earn fresh credits each week.")

    prod = await db.products.find_one({"slug": body.product_slug}, {"_id": 0})
    if not prod or prod.get("maker_slug") != slug:
        raise HTTPException(404, "Product not found")
    if prod.get("status") != "published" or prod.get("deleted_at"):
        raise HTTPException(400, "Only published listings can be boosted.")

    # Compute new promoted_until: extend if currently promoted, else now+24h
    hours = int(credit.get("duration_hours") or 24)
    cur_until_str = prod.get("promoted_until")
    base = now
    if cur_until_str:
        try:
            cur = datetime.fromisoformat(cur_until_str.replace("Z", "+00:00"))
            if cur > now:
                base = cur
        except Exception:
            pass
    new_until = (base + timedelta(hours=hours)).isoformat()

    await db.products.update_one(
        {"slug": body.product_slug},
        {"$set": {"promoted_until": new_until}},
    )
    await db.community_boost_credits.update_one(
        {"id": credit_id},
        {"$set": {"consumed_at": now.isoformat(),
                  "consumed_for_product_slug": body.product_slug}},
    )
    return await db.products.find_one({"slug": body.product_slug}, {"_id": 0})


@router.post("/maker/products/{product_slug}/auto-renew-promotion", response_model=Product)
async def maker_toggle_auto_renew_promotion(
    product_slug: str, body: AutoRenewPromotionToggle,
    slug: str = Depends(current_maker_slug),
):
    """Toggle automatic weekly renewal on a promoted listing.

    When enabled, the hourly `auto_renew_promotions` scheduler job will
    extend `promoted_until` by 7 days whenever it falls inside the next 6
    hours. Plus subscribers ride for free; everyone else accrues the
    standard $5/week fee to their pending balance.
    """
    prod = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    if not prod or prod.get("maker_slug") != slug:
        raise HTTPException(404, "Product not found")
    if prod.get("status") != "published" or prod.get("deleted_at"):
        raise HTTPException(400, "Only published listings support auto-renew.")
    if body.enabled and not prod.get("promoted_until"):
        raise HTTPException(
            400,
            "This listing isn't promoted yet — boost it once first, then "
            "auto-renew will keep it featured.",
        )
    await db.products.update_one(
        {"slug": product_slug},
        {"$set": {"auto_renew_promotion": bool(body.enabled)}},
    )
    return await db.products.find_one({"slug": product_slug}, {"_id": 0})


@router.post("/maker/products/{product_slug}/unpublish", response_model=Product)
async def maker_unpublish_product(product_slug: str, slug: str = Depends(current_maker_slug)):
    prod = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    if not prod or prod.get("maker_slug") != slug:
        raise HTTPException(404, "Product not found")
    await db.products.update_one(
        {"slug": product_slug}, {"$set": {"status": "draft"}}
    )
    updated = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    return updated


@router.post("/maker/products", response_model=Product)
async def maker_create_product(
    payload: MakerProductCreate,
    bg: BackgroundTasks,
    slug: str = Depends(current_maker_slug),
):
    """Self-serve listing creation. Auto-slugifies the title, ensures uniqueness
    by appending -2, -3, … on collision. Enforces at most 5 images per listing
    (caller should already compress to ~120KB max — we cap each image string at
    400KB raw to absorb edge cases without blowing the 16MB Mongo doc limit)."""
    if payload.price < 0:
        raise HTTPException(400, "Price must be non-negative.")
    if payload.in_stock < 0:
        raise HTTPException(400, "Stock must be non-negative.")
    if len(payload.images) > 8:
        raise HTTPException(400, "Maximum 8 images per listing.")
    for img in payload.images:
        if len(img) > 8_000_000:
            raise HTTPException(
                400,
                "An image is too large (>8MB).",
            )
    if payload.status not in ("draft", "published"):
        raise HTTPException(400, "status must be 'draft' or 'published'.")
    if len(payload.seo_tags or []) > 13:
        raise HTTPException(400, "Maximum 13 SEO tags per listing.")
    if payload.renewal_option not in ("automatic", "manual"):
        raise HTTPException(400, "renewal_option must be 'automatic' or 'manual'.")
    # Validate variants — labels are required and stock must be non-negative
    for v in payload.variants or []:
        if not v.label.strip():
            raise HTTPException(400, "Each variant needs a label.")
        if v.in_stock < 0:
            raise HTTPException(400, "Variant stock must be non-negative.")

    base = _slugify(payload.slug or payload.title)
    candidate = base
    n = 2
    # Treat soft-deleted listings as freeing up their slug — searching for
    # `deleted_at: {$exists: false}` skips them.
    while await db.products.find_one(
        {"slug": candidate, "deleted_at": None}, {"_id": 0}
    ):
        candidate = f"{base}-{n}"
        n += 1
        if n > 200:
            raise HTTPException(409, "Could not generate a unique slug.")

    # Upload any inline base64 data URLs to R2 (if configured) so we never
    # bloat MongoDB with image bytes. Pass-through any http(s) URLs as-is.
    final_images: List[str] = []
    if payload.images:
        for img in payload.images:
            if img.startswith("data:"):
                try:
                    url = await _upload_listing_image(img, slug, f"products/{slug}")
                    final_images.append(url or img)
                except HTTPException:
                    raise
                except Exception as e:
                    logger.exception("R2 upload failed for maker=%s: %s", slug, e)
                    raise HTTPException(502, "Could not upload image to storage.")
            else:
                final_images.append(img)

    # Per-variant images: same R2 path, different prefix so the sweeper can
    # tell them apart (and we don't bloat Mongo with base64 data URLs).
    final_variants: List[ProductVariant] = []
    for v in (payload.variants or []):
        img = v.image
        if img and isinstance(img, str) and img.startswith("data:"):
            try:
                url = await _upload_listing_image(img, slug, f"products/{slug}/variants")
                v_dump = v.model_dump()
                v_dump["image"] = url or img
                final_variants.append(ProductVariant(**v_dump))
                continue
            except HTTPException:
                raise
            except Exception as e:
                logger.exception("R2 variant-image upload failed maker=%s: %s", slug, e)
                raise HTTPException(502, "Could not upload variant image.")
        final_variants.append(v)

    product = Product(
        slug=candidate,
        title=payload.title.strip(),
        category=payload.category,
        technique=payload.technique,
        price=float(payload.price),
        description=payload.description.strip(),
        materials=payload.materials,
        dimensions=payload.dimensions,
        images=final_images,
        model_url=payload.model_url,
        video_url=payload.video_url,
        maker_slug=slug,
        in_stock=int(payload.in_stock),
        variants=final_variants,
        variant_axis1_name=payload.variant_axis1_name,
        variant_axis2_name=payload.variant_axis2_name,
        status=payload.status,
        # Extended fields
        who_made_it=payload.who_made_it,
        condition=payload.condition,
        length_in=payload.length_in,
        width_in=payload.width_in,
        height_in=payload.height_in,
        dim_unit=payload.dim_unit or "in",
        weight_lbs=payload.weight_lbs,
        weight_oz=payload.weight_oz,
        colors=payload.colors or [],
        occasions=payload.occasions or [],
        personalization_enabled=bool(payload.personalization_enabled),
        personalization_instructions=payload.personalization_instructions,
        free_shipping=bool(payload.free_shipping),
        shipping_domestic_usd=payload.shipping_domestic_usd,
        shipping_international_usd=payload.shipping_international_usd,
        shipping_carrier=payload.shipping_carrier,
        shipping_est_delivery=payload.shipping_est_delivery,
        processing_time=payload.processing_time,
        packed_length_in=payload.packed_length_in,
        packed_width_in=payload.packed_width_in,
        packed_height_in=payload.packed_height_in,
        accept_returns=bool(payload.accept_returns),
        accept_exchanges=bool(payload.accept_exchanges),
        seo_tags=(payload.seo_tags or [])[:13],
        contact_email=payload.contact_email,
        renewal_option=payload.renewal_option,
        # Auto-set expiry only on publish; drafts have no expiry until published.
        expires_at=(
            __import__("revenue").expiry_iso_from_now()
            if payload.status == "published" else None
        ),
    )
    await db.products.insert_one(product.model_dump())
    # Accrue the listing fee + bump usage counter (only for published listings —
    # drafts don't burn against the 10-free quota until they go live).
    if product.status == "published":
        from revenue import accrue_listing_charge
        await accrue_listing_charge(slug, product.slug, kind="listing_create")
        await db.makers.update_one(
            {"slug": slug}, {"$inc": {"listings_count": 1}}
        )
        # Fan out the publish notifications in the background so a maker with
        # many followers doesn't experience perceptible latency on create.
        bg.add_task(_safe_notify_listing_published, product.slug)
    return product


@router.delete("/maker/products/{product_slug}")
async def maker_delete_product(
    product_slug: str, slug: str = Depends(current_maker_slug),
):
    """Soft-delete a listing — sets deleted_at so order history stays intact
    and refunds still work. Listing disappears from /api/products and from
    every public-facing query that uses _public_filter()."""
    prod = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    if not prod:
        raise HTTPException(404, "Product not found")
    if prod.get("maker_slug") != slug:
        raise HTTPException(403, "You can only delete your own listings.")
    if prod.get("deleted_at"):
        return {"already_deleted": True, "deleted_at": prod["deleted_at"]}
    deleted_at = now_iso()
    await db.products.update_one(
        {"slug": product_slug},
        {"$set": {"deleted_at": deleted_at}},
    )
    await db.makers.update_one(
        {"slug": slug}, {"$inc": {"listings_count": -1}}
    )
    return {"deleted": True, "deleted_at": deleted_at}


@router.post("/maker/products/{product_slug}/restore", response_model=Product)
async def maker_restore_product(
    product_slug: str, slug: str = Depends(current_maker_slug),
):
    """Undo a soft-delete. Available to the listing owner indefinitely so
    accidental deletes are reversible."""
    prod = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    if not prod:
        raise HTTPException(404, "Product not found")
    if prod.get("maker_slug") != slug:
        raise HTTPException(403, "You can only restore your own listings.")
    if not prod.get("deleted_at"):
        return prod
    await db.products.update_one(
        {"slug": product_slug},
        {"$unset": {"deleted_at": ""}},
    )
    await db.makers.update_one(
        {"slug": slug}, {"$inc": {"listings_count": 1}}
    )
    return await db.products.find_one({"slug": product_slug}, {"_id": 0})


@router.delete("/maker/products/{product_slug}/purge")
async def maker_purge_product(
    product_slug: str, slug: str = Depends(current_maker_slug),
):
    """Permanently delete an already-archived listing.

    Hard-delete is gated on `deleted_at != None` so a maker can never wipe
    a live listing by accident — they have to archive it first (which is
    one click + a confirm), then come back to the Archived view to purge.
    Also gated on no associated paid orders so refund history stays
    intact.
    """
    prod = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    if not prod:
        raise HTTPException(404, "Product not found")
    if prod.get("maker_slug") != slug:
        raise HTTPException(403, "You can only delete your own listings.")
    if not prod.get("deleted_at"):
        raise HTTPException(
            400,
            "Listing must be archived before it can be permanently deleted.",
        )
    # Block purge if there's any payment_transactions row referencing this
    # listing — orphaning paid-order rows would corrupt refund history,
    # the maker's own /maker/orders view, and the admin financials feed.
    #
    # Defensive query: legacy rows store `product_id` as the product UUID
    # OR (in older data) as the slug, and a few callsites also write
    # `slug` as a sibling field. We OR across all three so no historical
    # write path can slip past the gate.
    has_orders = await db.payment_transactions.find_one(
        {
            "$or": [
                {"items.product_id": prod.get("id")},
                {"items.product_id": product_slug},
                {"items.slug": product_slug},
            ]
        },
        {"_id": 1},
    )
    if has_orders:
        raise HTTPException(
            400,
            "This listing has order history and can't be permanently deleted. "
            "It will stay archived (and hidden from buyers) for your records.",
        )
    await db.products.delete_one({"slug": product_slug})
    return {"purged": True, "slug": product_slug}




# ---------------- File uploads (R2) ------------------------------------------

@router.post("/maker/uploads/model")
async def maker_upload_model(
    file: UploadFile = File(...),
    slug: str = Depends(current_maker_slug),
):
    """Upload a `.glb` / `.gltf` 3D model to R2; returns the public URL.
    Used by the listing modal so makers can attach a 3D viewer to their product.
    """
    try:
        from r2_storage import is_configured as _r2_ok, upload_model_bytes
    except Exception:
        raise HTTPException(503, "R2 storage is not available.")
    if not _r2_ok():
        raise HTTPException(503, "R2 storage is not configured.")

    fname = (file.filename or "").lower()
    if not (fname.endswith(".glb") or fname.endswith(".gltf")):
        raise HTTPException(400, "Only .glb or .gltf files are supported.")

    body = await file.read()
    try:
        url = upload_model_bytes(
            body,
            key_prefix=f"models/{slug}",
            filename=fname,
            content_type=file.content_type or "application/octet-stream",
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("model upload failed for maker=%s: %s", slug, e)
        raise HTTPException(502, "Could not upload model.")
    return {"url": url, "size": len(body)}



@router.post("/maker/uploads/video")
async def maker_upload_video(
    file: UploadFile = File(...),
    slug: str = Depends(current_maker_slug),
):
    """Upload a listing showcase video (.mp4 / .webm / .mov, 50 MB cap) to R2.
    Returns the public URL for the maker to attach to a listing's `video_url`
    field via the editor. Files are served from R2's CDN — no transcoding."""
    try:
        from r2_storage import (
            ALLOWED_VIDEO_TYPES, is_configured as _r2_ok, upload_video_bytes,
        )
    except Exception:
        raise HTTPException(503, "R2 storage is not available.")
    if not _r2_ok():
        raise HTTPException(503, "R2 storage is not configured.")

    fname = (file.filename or "").lower()
    ct = (file.content_type or "").lower()
    if ct not in ALLOWED_VIDEO_TYPES and not fname.endswith((".mp4", ".webm", ".mov")):
        raise HTTPException(400, "Only .mp4, .webm, or .mov videos are supported.")

    body = await file.read()
    try:
        url = upload_video_bytes(
            body,
            key_prefix=f"videos/{slug}",
            filename=fname,
            content_type=ct or "video/mp4",
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("video upload failed for maker=%s: %s", slug, e)
        raise HTTPException(502, "Could not upload video.")
    return {"url": url, "size": len(body)}


@router.post("/maker/uploads/banner")
async def maker_upload_banner(
    file: UploadFile = File(...),
    slug: str = Depends(current_maker_slug),
):
    """Upload a custom shop banner (Plus subscribers only) to R2 and persist
    the URL on the maker. Returns the new banner URL."""
    try:
        from r2_storage import is_configured as _r2_ok, upload_bytes, ALLOWED_CONTENT_TYPES
    except Exception:
        raise HTTPException(503, "R2 storage is not available.")
    if not _r2_ok():
        raise HTTPException(503, "R2 storage is not configured.")

    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found.")
    if m.get("subscription_status") != "active":
        raise HTTPException(
            403, "Custom shop banners are a Crafters Plus benefit. Upgrade to unlock.",
        )

    ct = (file.content_type or "").lower()
    if ct not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(400, "Banner must be a PNG / JPG / WebP image.")
    body = await file.read()
    if len(body) == 0:
        raise HTTPException(400, "Empty file.")

    import uuid
    ext = ALLOWED_CONTENT_TYPES[ct]
    key = f"banners/{slug}/{uuid.uuid4().hex}.{ext}"
    try:
        url = upload_bytes(body, key, ct)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("banner upload failed for maker=%s: %s", slug, e)
        raise HTTPException(502, "Could not upload banner.")

    await db.makers.update_one(
        {"slug": slug}, {"$set": {"banner_image_url": url}}
    )
    return {"url": url, "size": len(body)}


@router.post("/maker/uploads/portrait")
async def maker_upload_portrait(
    file: UploadFile = File(...),
    slug: str = Depends(current_maker_slug),
):
    """Upload a maker portrait photo (square headshot shown on the shop
    profile + listing pages). Persists URL onto makers.portrait."""
    return await _upload_profile_image(file, slug, kind="portrait", folder="portraits")


@router.post("/maker/uploads/cover")
async def maker_upload_cover(
    file: UploadFile = File(...),
    slug: str = Depends(current_maker_slug),
):
    """Upload a maker cover photo (wide hero image shown atop the shop page).
    Persists URL onto makers.cover."""
    return await _upload_profile_image(file, slug, kind="cover", folder="covers")


async def _upload_profile_image(
    file: UploadFile, slug: str, *, kind: str, folder: str,
) -> dict:
    """Shared implementation for portrait/cover uploads — both write to R2
    and update the maker doc with the resulting CDN URL on a single field
    matching `kind` (one of "portrait" | "cover")."""
    try:
        from r2_storage import is_configured as _r2_ok, upload_bytes, ALLOWED_CONTENT_TYPES
    except Exception:
        raise HTTPException(503, "R2 storage is not available.")
    if not _r2_ok():
        raise HTTPException(503, "R2 storage is not configured.")

    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found.")

    ct = (file.content_type or "").lower()
    if ct not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(400, f"{kind.capitalize()} must be a PNG / JPG / WebP image.")
    body = await file.read()
    if len(body) == 0:
        raise HTTPException(400, "Empty file.")
    # ~10 MB hard cap (matches existing listing-image limits).
    if len(body) > 10 * 1024 * 1024:
        raise HTTPException(400, f"{kind.capitalize()} must be 10 MB or smaller.")

    import uuid
    ext = ALLOWED_CONTENT_TYPES[ct]
    key = f"{folder}/{slug}/{uuid.uuid4().hex}.{ext}"
    try:
        url = upload_bytes(body, key, ct)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("%s upload failed for maker=%s: %s", kind, slug, e)
        raise HTTPException(502, f"Could not upload {kind}.")

    await db.makers.update_one({"slug": slug}, {"$set": {kind: url}})
    return {"url": url, "size": len(body)}


# ---------------- Billing ledger ---------------------------------------------

@router.get("/maker/billing")
async def maker_billing(slug: str = Depends(current_maker_slug)):
    """Return the maker's listing usage, pending charges, fee policy, and
    recent charge history (last 25 entries). Used by the dashboard's billing
    panel so makers see a transparent breakdown of what they owe."""
    from revenue import (
        LISTING_FEE_CENTS, LISTING_FREE_QUOTA, LISTING_EXPIRY_DAYS,
        PROMOTION_WEEKLY_FEE_CENTS,
    )
    from routers.stripe_connect import (
        PLATFORM_FEE_BPS, PROCESSING_FEE_BPS, PROCESSING_FEE_FIXED_CENTS,
    )
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found")
    used = int(m.get("listings_used_lifetime", 0))
    free_remaining = max(0, LISTING_FREE_QUOTA - used)
    history = list(reversed(m.get("charge_history", [])))[:25]
    return {
        "listings_used_lifetime": used,
        "listings_free_remaining": free_remaining,
        "listings_free_quota": LISTING_FREE_QUOTA,
        "pending_charges_cents": int(m.get("pending_charges_cents", 0)),
        "policy": {
            "platform_fee_bps": PLATFORM_FEE_BPS,
            "processing_fee_bps": PROCESSING_FEE_BPS,
            "processing_fee_fixed_cents": PROCESSING_FEE_FIXED_CENTS,
            "listing_fee_cents": LISTING_FEE_CENTS,
            "listing_expiry_days": LISTING_EXPIRY_DAYS,
            "promotion_weekly_fee_cents": PROMOTION_WEEKLY_FEE_CENTS,
        },
        "history": history,
    }


@router.get("/maker/plus/roi")
async def maker_plus_roi(slug: str = Depends(current_maker_slug)):
    """Live ROI calculator — what would this maker save (or have saved)
    in the last 30 days if they were on Crafters Plus instead of free?

    Mechanic: every paid sale gets a 1% commission discount on Plus (5% → 4%).
    We sum up the maker's gross subtotals over the last 30d and multiply by
    that 1% to compute the "would-have-saved" dollar amount. Plus 1 free month
    of listing fees (worth quota_savings = listings_used_this_month * $0.20
    over the free quota).
    """
    from datetime import timedelta
    from revenue import (
        LISTING_FEE_CENTS, PLUS_MONTHLY_LISTING_QUOTA, PLUS_PLATFORM_FEE_BPS,
        PLUS_PRICE_USD,
    )
    from routers.stripe_connect import PLATFORM_FEE_BPS

    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found")

    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=30)
    cutoff = cutoff_dt.isoformat()
    payouts = await db.maker_payouts.find(
        {"maker_slug": slug, "updated_at": {"$gte": cutoff}},
        {"_id": 0, "amount": 1},
    ).to_list(1000)
    gross_30d = sum(float(p.get("amount") or 0) for p in payouts)

    # Commission savings: difference between free tier (5%) and Plus (4%) on
    # this maker's last-30d gross.
    bps_delta = max(0, PLATFORM_FEE_BPS - PLUS_PLATFORM_FEE_BPS)
    commission_savings = round(gross_30d * (bps_delta / 10000.0), 2)

    # Listing-fee savings: every listing past the free quota (10 lifetime on
    # free vs 15/mo on Plus) costs $0.20. We compute "would have been free
    # had they been on Plus" using listings published this calendar month.
    yyyymm = cutoff_dt.strftime("%Y-%m")
    listings_this_month = int((m.get("listings_by_month") or {}).get(yyyymm, 0))
    free_listings_savings_cents = (
        max(0, min(listings_this_month, PLUS_MONTHLY_LISTING_QUOTA))
        * LISTING_FEE_CENTS
    )
    # Only count this savings when the maker has actually paid for listings
    # past the free quota (i.e. has pending charges or a charge history).
    has_paid_listing_fees = bool(int(m.get("pending_charges_cents", 0)) > 0
                                 or m.get("charge_history"))
    listing_savings = round(
        (free_listings_savings_cents / 100.0) if has_paid_listing_fees else 0.0,
        2,
    )

    monthly_cost = float(PLUS_PRICE_USD)
    total_savings = commission_savings + listing_savings
    net_benefit = round(total_savings - monthly_cost, 2)

    return {
        "gross_30d": round(gross_30d, 2),
        "commission_savings": commission_savings,
        "listing_savings": listing_savings,
        "total_savings": round(total_savings, 2),
        "monthly_cost": monthly_cost,
        "net_benefit": net_benefit,
        "is_break_even": net_benefit >= 0,
        "free_commission_bps": PLATFORM_FEE_BPS,
        "plus_commission_bps": PLUS_PLATFORM_FEE_BPS,
    }


@router.get("/maker/orders")
async def maker_orders(slug: str = Depends(current_maker_slug)):
    """Returns paid orders that include at least one product from this maker."""
    products = await db.products.find({"maker_slug": slug}, {"_id": 0}).to_list(500)
    # Defensive: legacy/seeded rows can lack `id` — skip them rather than 500.
    by_id = {p["id"]: p for p in products if p.get("id")}
    by_slug = {p["slug"]: p for p in products if p.get("slug")}

    txs = await db.payment_transactions.find(
        {"payment_status": "paid"}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)

    out = []
    for tx in txs:
        my_lines = []
        for ci in tx.get("items", []):
            pid = ci.get("product_id")
            p = by_id.get(pid) or by_slug.get(pid)
            if not p:
                continue
            qty = int(ci.get("quantity", 1))
            unit_price = float(p["price"])
            variant_label = None
            variant_id = ci.get("variant_id")
            if variant_id:
                for v in (p.get("variants") or []):
                    if v.get("id") == variant_id:
                        unit_price = float(p["price"]) + float(v.get("price_delta", 0))
                        variant_label = v.get("label")
                        break
            my_lines.append({
                "product_slug": p["slug"],
                "title": p["title"] + (f" — {variant_label}" if variant_label else ""),
                "price": unit_price,
                "quantity": qty,
                "subtotal": round(unit_price * qty, 2),
                # iter150 — surface buyer personalization to the maker so
                # they can see WHAT to engrave on the order list AND in
                # the detail drawer without re-checking the email.
                "personalization_text": ci.get("personalization_text"),
                "personalization_image_url": ci.get("personalization_image_url"),
            })
        if not my_lines:
            continue
        out.append({
            "session_id": tx.get("session_id"),
            "buyer_email": tx.get("customer_email"),
            "buyer_name": tx.get("customer_name") or tx.get("buyer_name"),
            "created_at": tx.get("created_at"),
            "payment_status": tx.get("payment_status"),
            "order_status": tx.get("order_status") or "pending",
            "items": my_lines,
            "maker_subtotal": round(sum(line["subtotal"] for line in my_lines), 2),
            "shipped_at": tx.get("shipped_at"),
            "tracking_carrier": tx.get("tracking_carrier"),
            "tracking_number": tx.get("tracking_number"),
        })
    return out


@router.get("/maker/orders/{session_id}")
async def maker_order_detail(session_id: str, slug: str = Depends(current_maker_slug)):
    """Single order detail — shipping address, full buyer info, line items.
    Enforces that at least one product in the order belongs to the caller
    (cross-maker isolation)."""
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Order not found.")

    # Cross-maker isolation — only show if we have at least one of their products.
    products = await db.products.find({"maker_slug": slug}, {"_id": 0}).to_list(500)
    by_id = {p["id"]: p for p in products if p.get("id")}
    by_slug = {p["slug"]: p for p in products if p.get("slug")}

    lines = []
    for ci in tx.get("items", []):
        pid = ci.get("product_id")
        p = by_id.get(pid) or by_slug.get(pid)
        if not p:
            continue
        qty = int(ci.get("quantity", 1))
        unit_price = float(p["price"])
        variant_label = None
        variant_id = ci.get("variant_id")
        if variant_id:
            for v in (p.get("variants") or []):
                if v.get("id") == variant_id:
                    unit_price = float(p["price"]) + float(v.get("price_delta", 0))
                    variant_label = v.get("label")
                    break
        lines.append({
            "product_slug": p["slug"],
            "title": p["title"] + (f" — {variant_label}" if variant_label else ""),
            "image": (p.get("images") or [None])[0],
            "price": unit_price,
            "quantity": qty,
            "subtotal": round(unit_price * qty, 2),
            # iter150 — buyer personalization surfaces in the order
            # detail drawer so the maker can see what to engrave at a
            # glance without re-reading the email.
            "personalization_text": ci.get("personalization_text"),
            "personalization_image_url": ci.get("personalization_image_url"),
        })
    if not lines:
        raise HTTPException(404, "Order not found.")

    # Pull shipping address from Stripe when we haven't cached it locally yet.
    # (Webhook doesn't record shipping today.) Best-effort — don't 500 if Stripe
    # is unreachable or the session is a seed row.
    shipping = tx.get("shipping_details") or tx.get("customer_details") or None
    if not shipping and session_id.startswith("cs_") and not session_id.startswith("cs_test_seed"):
        try:
            import stripe as stripe_sdk
            from core import STRIPE_API_KEY
            stripe_sdk.api_key = STRIPE_API_KEY
            sess = stripe_sdk.checkout.Session.retrieve(
                session_id, expand=["shipping_details", "customer_details"],
            )
            shipping = {
                "name": (sess.get("shipping_details") or {}).get("name")
                        or (sess.get("customer_details") or {}).get("name"),
                "phone": (sess.get("customer_details") or {}).get("phone"),
                "address": (sess.get("shipping_details") or {}).get("address")
                           or (sess.get("customer_details") or {}).get("address"),
            }
            # Cache on the tx doc so subsequent opens don't re-hit Stripe.
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {"shipping_details": shipping, "updated_at": now_iso()}},
            )
        except Exception as e:
            logger.info("[maker/orders/detail] stripe retrieve skipped: %s", e)

    return {
        "session_id": session_id,
        "buyer_email": tx.get("customer_email"),
        "buyer_name": tx.get("customer_name") or tx.get("buyer_name"),
        "created_at": tx.get("created_at"),
        "payment_status": tx.get("payment_status"),
        "order_status": tx.get("order_status") or "pending",
        "items": lines,
        "maker_subtotal": round(sum(line["subtotal"] for line in lines), 2),
        "shipping": shipping,
        "shipped_at": tx.get("shipped_at"),
        "tracking_carrier": tx.get("tracking_carrier"),
        "tracking_number": tx.get("tracking_number"),
        "tracking_status": tx.get("tracking_status"),
        "tracking_status_label": tx.get("tracking_status_label"),
        "tracking_status_tier": tx.get("tracking_status_tier"),
        "tracking_status_eta": tx.get("tracking_status_eta"),
        "tracking_updated_at": tx.get("tracking_updated_at"),
        "tracking_history": tx.get("tracking_history") or [],
        "shippo_label_url": tx.get("shippo_label_url"),
        "delivered_at": tx.get("delivered_at"),
        "buyer_note": tx.get("buyer_note"),
    }


class OrderShipUpdate(BaseModel):
    tracking_number: str | None = None
    tracking_carrier: str | None = None


@router.post("/maker/orders/{session_id}/ship")
async def maker_mark_shipped(
    session_id: str, body: OrderShipUpdate, bg: BackgroundTasks,
    slug: str = Depends(current_maker_slug),
):
    """Mark an order as shipped — optionally attach a tracking # + carrier.
    The order moves to the Fulfilled tab. When a tracking number is
    provided AND the buyer hasn't already been emailed about this
    shipment, fires a buyer-shipped email with the receipt + tracking
    deep-link as a background task."""
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Order not found.")
    # Cross-maker guard — only allow if tx contains at least one of my products.
    my_pids = {p["id"] for p in await db.products.find({"maker_slug": slug}, {"_id": 0, "id": 1}).to_list(500) if p.get("id")}
    my_pslugs = {p["slug"] for p in await db.products.find({"maker_slug": slug}, {"_id": 0, "slug": 1}).to_list(500) if p.get("slug")}
    has_my_item = any(
        (ci.get("product_id") in my_pids) or (ci.get("product_id") in my_pslugs) or (ci.get("product_slug") in my_pslugs)
        for ci in tx.get("items", [])
    )
    if not has_my_item:
        raise HTTPException(404, "Order not found.")

    # Guardrail — if the seller didn't use Shippo to buy a label, they
    # MUST provide tracking # + carrier manually before the order can be
    # marked fulfilled. Prevents the "ship + ghost" pattern where a
    # maker hit Mark Shipped without any way for the buyer to track the
    # package. Shippo-bought labels already carry tracking on the tx
    # doc, so they bypass this check naturally.
    bought_via_shippo = bool(tx.get("shippo_tx_id") or tx.get("shippo_label_url"))
    existing_tracking = tx.get("tracking_number")
    incoming_tracking = (body.tracking_number or "").strip() if body.tracking_number else ""
    incoming_carrier = (body.tracking_carrier or "").strip() if body.tracking_carrier else ""
    if not bought_via_shippo and not existing_tracking:
        if not incoming_tracking or not incoming_carrier:
            raise HTTPException(
                400,
                "Tracking number and carrier are required to mark this order "
                "shipped. Either buy a label through Shippo (auto-fills tracking) "
                "or enter your manual tracking details below.",
            )
    update = {
        "order_status": "fulfilled",
        "shipped_at": now_iso(),
        "updated_at": now_iso(),
    }
    if body.tracking_number:
        update["tracking_number"] = body.tracking_number.strip()
    if body.tracking_carrier:
        update["tracking_carrier"] = body.tracking_carrier.strip()
    await db.payment_transactions.update_one(
        {"session_id": session_id}, {"$set": update},
    )

    # Buyer notification — only when we have BOTH a tracking number AND a
    # buyer email, AND we haven't already emailed this shipment. Idempotent
    # via `shipped_email_sent` flag so re-clicking Mark Shipped doesn't
    # double-send.
    final_tracking = update.get("tracking_number") or tx.get("tracking_number")
    final_carrier = update.get("tracking_carrier") or tx.get("tracking_carrier") or ""
    buyer_email = tx.get("customer_email") or (tx.get("shipping_details") or {}).get("email")
    if final_tracking and buyer_email and not tx.get("shipped_email_sent"):
        # Stamp first so a duplicate request loses the idempotency race.
        await db.payment_transactions.update_one(
            {"session_id": session_id, "shipped_email_sent": {"$ne": True}},
            {"$set": {"shipped_email_sent": True, "shipped_email_at": now_iso()}},
        )
        bg.add_task(
            send_buyer_shipped,
            buyer_email,
            tx.get("customer_name") or (tx.get("shipping_details") or {}).get("name"),
            final_tracking,
            final_carrier,
            tx.get("items") or [],
            float(tx.get("amount") or 0) or None,
            tx.get("id") or session_id,
            tx.get("tracking_url_provider"),
        )

    # Public ticker: announce the shipment so the homepage/social-proof
    # banner picks it up. Best-effort — never block the API on this.
    try:
        maker_doc = await db.makers.find_one(
            {"slug": slug}, {"_id": 0, "name": 1},
        ) or {}
        ship_addr = (tx.get("shipping_details") or {}).get("address") or {}
        city = (ship_addr.get("city") or "").strip()
        state = (ship_addr.get("state") or "").strip()
        location = f"{city}, {state}" if city and state else (city or "Crafters Market")
        await db.activity_events.insert_one({
            "id": str(uuid.uuid4()),
            "kind": "shipped",
            "text": _shipped_ticker_text(tx.get("items") or [], maker_doc.get("name") or ""),
            "location": location,
            "created_at": now_iso(),
        })
    except Exception as e:
        logger.warning("[ticker] shipped event emit failed: %s", e)

    # Buyer push companion to the shipped email — replaces the SMS nudge
    # we deferred. Fires only when the buyer has registered a Web Push
    # subscription against their email AND the maker hasn't opted out
    # via Settings → Notifications. Dispatched in the background so it
    # never blocks the API response.
    try:
        from routers.push import notify_buyer_push
        maker_doc_for_push = await db.makers.find_one(
            {"slug": slug}, {"_id": 0, "push_on_ship_optout": 1},
        ) or {}
        if buyer_email and not maker_doc_for_push.get("push_on_ship_optout"):
            ship_to = "your order"
            try:
                items = tx.get("items") or []
                if items:
                    best = max(items, key=lambda it: float(it.get("price") or 0))
                    if best.get("title"):
                        ship_to = best["title"]
            except Exception:
                pass
            track_carrier = final_carrier or "carrier"
            push_body = (
                f"{ship_to} just shipped via {track_carrier}. "
                f"Tap for tracking."
            ) if final_tracking else f"{ship_to} just shipped — tracking on the way."
            bg.add_task(
                notify_buyer_push,
                buyer_email,
                "Your Crafters Market order shipped",
                push_body,
                f"/account/orders/{tx.get('id') or session_id}",
                "cm-buyer-shipped",
            )
    except Exception as e:
        logger.warning("[push] shipped buyer push schedule failed: %s", e)

    return {"ok": True, "order_status": "fulfilled", "shipped_at": update["shipped_at"]}


def _shipped_ticker_text(items: list, maker_name: str) -> str:
    """Build the public-ticker headline for a freshly-shipped order.
    Picks the highest-priced line as the spotlight item; falls back to
    a generic 'an order' when nothing usable is in items."""
    headline = ""
    if items:
        try:
            best = max(items, key=lambda it: float(it.get("price") or 0))
            headline = (best.get("title") or "").strip()
        except Exception:
            headline = ""
    if headline and maker_name:
        return f"{maker_name} shipped {headline}"
    if headline:
        return f"Just shipped — {headline}"
    return f"{maker_name or 'A maker'} shipped an order"


@router.post("/maker/orders/{session_id}/resend-tracking-email")
async def resend_tracking_email(
    session_id: str, bg: BackgroundTasks,
    slug: str = Depends(current_maker_slug),
):
    """Re-send the buyer's "shipped + tracking" email. Useful when the
    buyer accidentally deleted it, the email landed in spam, or the
    maker updated the tracking number after first ship.

    Reuses `send_buyer_shipped` (iter72) so the email body is bit-for-bit
    identical to what the buyer originally received, except for a small
    "Resent at <ts>" footer note. Stamps `last_tracking_resend_at` to
    rate-limit accidental triple-clicks (1 resend / 60 seconds)."""
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Order not found.")
    # Cross-maker guard mirrors the mark-shipped endpoint
    my_pids = {p["id"] for p in await db.products.find({"maker_slug": slug}, {"_id": 0, "id": 1}).to_list(500) if p.get("id")}
    my_pslugs = {p["slug"] for p in await db.products.find({"maker_slug": slug}, {"_id": 0, "slug": 1}).to_list(500) if p.get("slug")}
    has_my_item = any(
        (ci.get("product_id") in my_pids) or (ci.get("product_id") in my_pslugs) or (ci.get("product_slug") in my_pslugs)
        for ci in tx.get("items", [])
    )
    if not has_my_item:
        raise HTTPException(404, "Order not found.")
    tracking = tx.get("tracking_number")
    if not tracking:
        raise HTTPException(400, "No tracking number on this order yet — mark it shipped first.")
    buyer_email = tx.get("customer_email") or (tx.get("shipping_details") or {}).get("email")
    if not buyer_email:
        raise HTTPException(400, "No buyer email on file for this order.")
    # Throttle — 60 seconds between resends so a triple-click doesn't
    # trigger 3 inboxed emails. Compare ISO strings via `>=`.
    last = tx.get("last_tracking_resend_at")
    if last:
        try:
            from datetime import datetime, timezone
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            delta = (datetime.now(timezone.utc) - last_dt).total_seconds()
            if delta < 60:
                raise HTTPException(429, f"Please wait {int(60 - delta)}s before resending again.")
        except ValueError:
            pass  # corrupt timestamp — let it through
    ts = now_iso()
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {"last_tracking_resend_at": ts, "tracking_resend_count": (tx.get("tracking_resend_count") or 0) + 1}},
    )
    bg.add_task(
        send_buyer_shipped,
        buyer_email,
        tx.get("customer_name") or (tx.get("shipping_details") or {}).get("name"),
        tracking,
        tx.get("tracking_carrier") or "",
        tx.get("items") or [],
        float(tx.get("amount") or 0) or None,
        tx.get("id") or session_id,
        tx.get("tracking_url_provider"),
    )
    return {"ok": True, "resent_at": ts}


@router.get("/maker/stats")
async def maker_stats(slug: str = Depends(current_maker_slug)):
    """Stats tab — surfaces aggregates already in the DB. No new data
    collection. Returns active listings, total orders fulfilled vs pending,
    gross + net revenue, and a 30-day-window trend bucket so the UI can
    render a sparkline without a second round-trip."""
    from datetime import timedelta
    cutoff_30d = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat().replace("+00:00", "Z")

    active_listings = await db.products.count_documents(
        {"maker_slug": slug, "deleted_at": {"$in": [None, ""]}}
    )

    # Orders that contain at least one of this maker's items.
    orders = await db.transactions.find(
        {"items.maker_slug": slug, "payment_status": "paid"},
        {"_id": 0, "items": 1, "created_at": 1, "payment_status": 1},
    ).sort("created_at", -1).to_list(2000)

    paid_count = len(orders)
    fulfilled_count = await db.transactions.count_documents(
        {"items.maker_slug": slug, "payment_status": "paid", "order_status": "fulfilled"}
    )
    pending_count = paid_count - fulfilled_count

    gross = 0.0
    last_30d_revenue = 0.0
    for o in orders:
        sub = sum(
            (line.get("price", 0) * line.get("quantity", 1))
            for line in o.get("items", []) if line.get("maker_slug") == slug
        )
        gross += sub
        if (o.get("created_at") or "") >= cutoff_30d:
            last_30d_revenue += sub

    return {
        "active_listings": active_listings,
        "paid_orders": paid_count,
        "pending_orders": max(0, pending_count),
        "fulfilled_orders": fulfilled_count,
        "gross_revenue": round(gross, 2),
        "last_30d_revenue": round(last_30d_revenue, 2),
        "currency": "USD",
    }


@router.get("/maker/analytics/plus")
async def maker_analytics_plus(slug: str = Depends(current_maker_slug)):
    """Crafters Plus advanced analytics — Plus subscribers only (active
    OR trialing). Returns the four Plus-exclusive dashboard cards:

      1. conversion_rate:    paid orders ÷ unique sessions visiting any
                             /shop/<my-slug> page in the last 30 days
      2. repeat_buyer_pct:   share of buyers (by email) who have made
                             ≥2 paid orders from this maker, all-time
      3. revenue_trend:      daily revenue buckets for last 30 + 90 days
                             (powers the sparkline / trend chart)
      4. traffic_sources:    pageview-event 'medium' breakdown for the
                             maker's listing pages over last 30 days

    Free-tier makers get 403 with `code: plus_required` so the frontend
    can render a clean upgrade prompt.

    All numbers derived from existing collections (`pageview_events`,
    `transactions`, `makers`) — no new instrumentation.
    """
    m = await db.makers.find_one({"slug": slug}, {"_id": 0, "subscription_status": 1})
    if not m:
        raise HTTPException(404, "Maker not found.")
    # `subscription_status` is 'active' for both active and trialing
    # subs (see _sync_sub_to_maker). Free / canceled / past_due are
    # locked out.
    if (m.get("subscription_status") or "free") != "active":
        raise HTTPException(403, {
            "code": "plus_required",
            "message": "Advanced analytics is a Crafters Plus benefit.",
        })

    from datetime import timedelta
    now = datetime.now(timezone.utc)
    cutoff_30d_iso = (now - timedelta(days=30)).isoformat().replace("+00:00", "Z")
    cutoff_90d_iso = (now - timedelta(days=90)).isoformat().replace("+00:00", "Z")

    # ---------- 1. Conversion rate (last 30 days) ----------
    slugs = [
        p["slug"] for p in await db.products.find(
            {"maker_slug": slug}, {"_id": 0, "slug": 1},
        ).to_list(2000)
    ]
    paths = [f"/shop/{s}" for s in slugs]

    unique_sessions_30d = 0
    if paths:
        pipe = [
            {"$match": {"ts": {"$gte": cutoff_30d_iso}, "path": {"$in": paths}}},
            {"$group": {"_id": "$session_id"}},
            {"$count": "n"},
        ]
        async for row in db.pageview_events.aggregate(pipe):
            unique_sessions_30d = int(row.get("n") or 0)

    paid_orders_30d_cursor = db.transactions.find(
        {
            "items.maker_slug": slug,
            "payment_status": "paid",
            "created_at": {"$gte": cutoff_30d_iso},
        },
        {"_id": 0, "buyer_email": 1, "items": 1, "created_at": 1},
    )
    paid_orders_30d = await paid_orders_30d_cursor.to_list(5000)
    paid_count_30d = len(paid_orders_30d)
    conversion_rate = (
        round((paid_count_30d / unique_sessions_30d) * 100, 2)
        if unique_sessions_30d > 0 else 0.0
    )

    # ---------- 2. Repeat-buyer % (all-time) ----------
    all_orders = await db.transactions.find(
        {"items.maker_slug": slug, "payment_status": "paid"},
        {"_id": 0, "buyer_email": 1, "items": 1, "created_at": 1},
    ).to_list(20000)
    # Buckets buyer_email → order count
    by_buyer: dict[str, int] = {}
    for o in all_orders:
        email = (o.get("buyer_email") or "").lower().strip()
        if not email:
            continue
        by_buyer[email] = by_buyer.get(email, 0) + 1
    total_buyers = len(by_buyer)
    repeat_buyers = sum(1 for n in by_buyer.values() if n >= 2)
    repeat_buyer_pct = (
        round((repeat_buyers / total_buyers) * 100, 1)
        if total_buyers > 0 else 0.0
    )

    # ---------- 3. Revenue trend (daily buckets, 30d + 90d) ----------
    def _maker_subtotal(order: dict) -> float:
        return sum(
            (float(line.get("price", 0)) * int(line.get("quantity", 1)))
            for line in (order.get("items") or [])
            if line.get("maker_slug") == slug
        )

    trend_90d: dict[str, float] = {}
    for o in all_orders:
        created = o.get("created_at") or ""
        if created < cutoff_90d_iso:
            continue
        day = created[:10]  # YYYY-MM-DD
        trend_90d[day] = round(trend_90d.get(day, 0.0) + _maker_subtotal(o), 2)

    # Fill in zero-revenue days so the chart has a continuous line.
    series_30d: list[dict] = []
    series_90d: list[dict] = []
    for d in range(89, -1, -1):
        day_dt = (now - timedelta(days=d)).date()
        day_key = day_dt.isoformat()
        rev = trend_90d.get(day_key, 0.0)
        point = {"date": day_key, "revenue": rev}
        series_90d.append(point)
        if d < 30:
            series_30d.append(point)

    # ---------- 4. Traffic source breakdown (30d) ----------
    traffic: list[dict] = []
    if paths:
        pipe = [
            {"$match": {"ts": {"$gte": cutoff_30d_iso}, "path": {"$in": paths}}},
            {"$group": {"_id": "$medium", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]
        async for row in db.pageview_events.aggregate(pipe):
            medium = (row.get("_id") or "direct").lower()
            traffic.append({"medium": medium, "count": int(row.get("count") or 0)})

    return {
        "as_of": now.isoformat(),
        "conversion": {
            "rate_pct": conversion_rate,
            "paid_orders_30d": paid_count_30d,
            "unique_sessions_30d": unique_sessions_30d,
        },
        "repeat_buyer": {
            "pct": repeat_buyer_pct,
            "repeat_buyers": repeat_buyers,
            "total_buyers": total_buyers,
        },
        "revenue_trend": {
            "series_30d": series_30d,
            "series_90d": series_90d,
        },
        "traffic_sources": traffic,
    }



@router.get("/maker/violations")
async def maker_violations(slug: str = Depends(current_maker_slug)):
    """Violations tab — pulls from the audit_log (chat moderation, listing
    rejections, EUA breaches) and the ai_mod_log (forum/chat warns/blocks)
    filtered to this maker's email. Shown so makers can see exactly what
    triggered any warning, with timestamps + reasons. Read-only."""
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0, "email": 1})
    if not maker:
        return {"violations": []}
    email = maker["email"]
    out = []
    audit_rows = await db.audit_log.find(
        {"$or": [{"email": email}, {"maker_slug": slug}]},
        {"_id": 0},
    ).sort("created_at", -1).limit(100).to_list(100)
    for r in audit_rows:
        kind = r.get("kind", "audit")
        if kind in (
            "password_set", "password_reset_consumed",
            "admin_password_set_direct", "admin_password_reset_sent",
            "admin_force_signout",
        ):
            continue  # not violations — suppress
        out.append({
            "kind": kind,
            "reason": r.get("reason") or r.get("notes") or "",
            "severity": "warn" if "warn" in kind else "info",
            "source": "audit",
            "created_at": r.get("created_at"),
        })
    mod_rows = await db.ai_mod_log.find(
        {"user_email": email, "action": {"$in": ["warn", "block"]}},
        {"_id": 0},
    ).sort("created_at", -1).limit(100).to_list(100)
    for r in mod_rows:
        out.append({
            "kind": f"chat_{r['action']}",
            "reason": r.get("reason") or "",
            "channel": r.get("channel"),
            "severity": "block" if r["action"] == "block" else "warn",
            "source": "ai_moderator",
            "created_at": r.get("created_at"),
        })
    out.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return {"violations": out[:100]}


@router.get("/maker/transactions")
async def maker_transactions(slug: str = Depends(current_maker_slug)):
    """Transaction history for the Financials tab — combines paid order
    payouts (credits) and listing-fee charges (debits) into one chronological
    ledger so makers see exactly what's hitting their balance."""
    rows = []
    txns = await db.transactions.find(
        {"items.maker_slug": slug, "payment_status": "paid"},
        {"_id": 0, "items": 1, "created_at": 1, "id": 1, "stripe_session_id": 1},
    ).sort("created_at", -1).limit(200).to_list(200)
    for t in txns:
        my_lines = [li for li in t.get("items", []) if li.get("maker_slug") == slug]
        if not my_lines:
            continue
        amount = round(sum(li.get("price", 0) * li.get("quantity", 1) for li in my_lines), 2)
        rows.append({
            "kind": "sale",
            "amount": amount,
            "direction": "credit",
            "reference": t.get("stripe_session_id") or t.get("id"),
            "items_count": sum(li.get("quantity", 1) for li in my_lines),
            "created_at": t.get("created_at"),
        })
    charges = await db.maker_charges.find(
        {"maker_slug": slug}, {"_id": 0},
    ).sort("created_at", -1).limit(200).to_list(200)
    for c in charges:
        rows.append({
            "kind": c.get("kind", "fee"),
            "amount": round(float(c.get("amount_cents", 0)) / 100, 2),
            "direction": "debit",
            "reference": c.get("description", ""),
            "created_at": c.get("created_at"),
        })
    rows.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return {"transactions": rows[:200]}



# ─────────────────────────────────────────────────────────────────────────────
# Account lifecycle — close / reopen shop + request 30-day deletion.
#
# "Close shop" is reversible: sets `shop_closed=True`, hides the shop from
# public search, blocks new listings, but preserves all data. Reopen anytime.
#
# "Request deletion" starts a 30-day grace window during which the maker
# (or admin) can cancel. A scheduled job purges the shop + every related
# row (listings, payouts, messages) on day 30. The maker can log in during
# the grace window and see a red banner with the countdown.
# ─────────────────────────────────────────────────────────────────────────────

from datetime import timedelta as _td


@router.post("/maker/account/close")
async def maker_close_shop(slug: str = Depends(current_maker_slug)):
    """Pause the shop platform-wide (reversible). Hides from search, blocks
    new orders + listings, keeps existing data intact."""
    now = now_iso()
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"shop_closed": True, "shop_closed_at": now, "vacation_mode": True}},
    )
    await db.admin_audit.insert_one({
        "id": uuid.uuid4().hex,
        "kind": "maker_shop_closed",
        "actor": slug,
        "created_at": now,
    })
    return {"ok": True, "shop_closed": True, "shop_closed_at": now}


@router.post("/maker/account/reopen")
async def maker_reopen_shop(slug: str = Depends(current_maker_slug)):
    """Un-close a previously-closed shop. Does NOT auto-disable vacation
    mode — the maker can toggle that separately from Settings."""
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"shop_closed": False, "shop_closed_at": None}},
    )
    return {"ok": True, "shop_closed": False}


@router.post("/maker/account/request-deletion")
async def maker_request_deletion(slug: str = Depends(current_maker_slug)):
    """Start a 30-day deletion grace period. After 30 days a scheduled job
    hard-purges the maker + listings + payouts + forum posts + files.

    Cancellable anytime via /maker/account/cancel-deletion while in grace.
    We ALSO close the shop immediately so no new orders land during the
    window — nothing worse than a buyer placing an order minutes before
    the shop vanishes.
    """
    m = await db.makers.find_one({"slug": slug}, {"_id": 0, "deletion_requested_at": 1})
    if m and m.get("deletion_requested_at"):
        raise HTTPException(400, "A deletion request is already active. Cancel it first to restart the clock.")
    now_dt = datetime.now(timezone.utc)
    purge_dt = now_dt + _td(days=30)
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {
            "deletion_requested_at": now_dt.isoformat(),
            "deletion_cancels_at": purge_dt.isoformat(),
            "shop_closed": True,
            "shop_closed_at": now_dt.isoformat(),
            "vacation_mode": True,
        }},
    )
    await db.admin_audit.insert_one({
        "id": uuid.uuid4().hex,
        "kind": "maker_deletion_requested",
        "actor": slug,
        "created_at": now_dt.isoformat(),
        "purge_at": purge_dt.isoformat(),
    })
    return {
        "ok": True,
        "deletion_requested_at": now_dt.isoformat(),
        "purge_at": purge_dt.isoformat(),
        "days_remaining": 30,
    }


@router.post("/maker/account/cancel-deletion")
async def maker_cancel_deletion(slug: str = Depends(current_maker_slug)):
    """Back out of a pending 30-day deletion. Leaves the shop in its
    closed state — the maker can call /reopen separately to resume sales."""
    m = await db.makers.find_one({"slug": slug}, {"_id": 0, "deletion_requested_at": 1})
    if not m or not m.get("deletion_requested_at"):
        raise HTTPException(400, "No deletion request is active.")
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"deletion_requested_at": None, "deletion_cancels_at": None}},
    )
    await db.admin_audit.insert_one({
        "id": uuid.uuid4().hex,
        "kind": "maker_deletion_canceled",
        "actor": slug,
        "created_at": now_iso(),
    })
    return {"ok": True}


@router.get("/maker/auto-boost/status")
async def maker_auto_boost_status(slug: str = Depends(current_maker_slug)):
    """Stats for the Marketing Ads auto-boost panel: current toggle state,
    last-run timestamp, lifetime spend, and the listing count that would
    boost on the next run (preview)."""
    from datetime import datetime, timezone, timedelta
    m = await db.makers.find_one(
        {"slug": slug},
        {"_id": 0, "auto_boost_enabled": 1, "auto_boost_min_orders_30d": 1,
         "auto_boost_max_per_run": 1, "auto_boost_last_run_at": 1,
         "auto_boost_total_spent_usd": 1},
    ) or {}
    min_orders = m.get("auto_boost_min_orders_30d") or 10
    max_per = m.get("auto_boost_max_per_run") or 3
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    now_v = datetime.now(timezone.utc).isoformat()
    pipe = [
        {"$match": {"maker_slug": slug, "status": {"$in": ["succeeded", "succeeded-zero"]}, "created_at": {"$gte": cutoff}}},
        {"$unwind": "$line_items"},
        {"$group": {"_id": "$line_items.product_slug", "n": {"$sum": "$line_items.quantity"}}},
        {"$match": {"n": {"$gte": min_orders}}},
        {"$sort": {"n": -1}},
        {"$limit": max_per * 4},  # extra to filter already-promoted
    ]
    rows = [r async for r in db.maker_payouts.aggregate(pipe)]
    next_candidates = []
    for r in rows:
        if not r["_id"]:
            continue
        p = await db.products.find_one({"slug": r["_id"], "maker": slug, "deleted_at": None}, {"_id": 0, "title": 1, "promoted_until": 1, "status": 1, "images": 1})
        if not p or p.get("status") != "published":
            continue
        if p.get("promoted_until") and p["promoted_until"] > now_v:
            continue
        next_candidates.append({"slug": r["_id"], "title": p.get("title"), "orders_30d": r["n"], "thumbnail": (p.get("images") or [None])[0]})
        if len(next_candidates) >= max_per:
            break
    return {
        "enabled": bool(m.get("auto_boost_enabled")),
        "min_orders_30d": min_orders,
        "max_per_run": max_per,
        "last_run_at": m.get("auto_boost_last_run_at"),
        "total_spent_usd": m.get("auto_boost_total_spent_usd") or 0,
        "next_candidates": next_candidates,
        "next_run_at": "Daily at 04:00 UTC",
    }


class AutoBoostUpdate(BaseModel):
    enabled: Optional[bool] = None
    min_orders_30d: Optional[int] = None
    max_per_run: Optional[int] = None


@router.patch("/maker/auto-boost")
async def maker_update_auto_boost(
    body: AutoBoostUpdate, slug: str = Depends(current_maker_slug),
):
    """Update auto-boost preferences. All fields optional; pass only what
    you want to change. Sane bounds enforced server-side so a curious
    operator can't auto-spend $1000/wk by accident."""
    update: dict = {}
    if body.enabled is not None:
        update["auto_boost_enabled"] = bool(body.enabled)
    if body.min_orders_30d is not None:
        update["auto_boost_min_orders_30d"] = max(3, min(100, int(body.min_orders_30d)))
    if body.max_per_run is not None:
        update["auto_boost_max_per_run"] = max(1, min(10, int(body.max_per_run)))
    if not update:
        raise HTTPException(400, "Nothing to update.")
    await db.makers.update_one({"slug": slug}, {"$set": update})
    return {"ok": True, "applied": update}



# ---------------- Admin-routed briefs ----------------
@router.get("/maker/briefs")
async def maker_assigned_briefs(slug: str = Depends(current_maker_slug)):
    """List custom-order briefs that an admin routed to this maker via
    POST /api/admin/custom-orders/{id}/push-to-maker. Newest first."""
    rows = await db.custom_orders.find(
        {"assigned_maker_slug": slug},
        {"_id": 0},
    ).sort("assigned_at", -1).to_list(200)
    return rows


@router.get("/maker/briefs/{brief_id}")
async def maker_get_brief(brief_id: str, slug: str = Depends(current_maker_slug)):
    """Fetch a single brief — used by the print-friendly bench sheet
    page so the maker can pull just one brief without paging."""
    brief = await db.custom_orders.find_one(
        {"id": brief_id, "assigned_maker_slug": slug},
        {"_id": 0},
    )
    if not brief:
        raise HTTPException(404, "Brief not found or not assigned to your shop.")
    return brief


class BriefStatusUpdate(BaseModel):
    status: str  # "accepted" | "declined" | "in_progress" | "completed" | "won_bid"
    note: Optional[str] = None


@router.patch("/maker/briefs/{brief_id}")
async def maker_update_brief(
    brief_id: str, body: BriefStatusUpdate,
    slug: str = Depends(current_maker_slug),
):
    """Maker action on an admin-routed brief — accept, decline, mark
    in-progress, mark complete, OR mark won-the-bid (the brief
    converted from a routed lead into actual paid work). The 'won_bid'
    status drives the admin's conversion-rate analytics."""
    valid = {"accepted", "declined", "in_progress", "completed", "won_bid"}
    if body.status not in valid:
        raise HTTPException(400, f"status must be one of: {', '.join(sorted(valid))}")
    brief = await db.custom_orders.find_one(
        {"id": brief_id, "assigned_maker_slug": slug},
        {"_id": 0},
    )
    if not brief:
        raise HTTPException(404, "Brief not found or not assigned to your shop.")
    update = {
        "maker_response_status": body.status,
        "maker_response_at": now_iso(),
        "maker_response_note": (body.note or "").strip()[:2000] or None,
    }
    if body.status == "won_bid":
        update["won_bid_at"] = now_iso()
    await db.custom_orders.update_one({"id": brief_id}, {"$set": update})
    return {"ok": True, "status": body.status}


@router.post("/maker/journal/upload-image")
async def maker_journal_upload_image(
    file: UploadFile = File(...),
    slug: str = Depends(current_maker_slug),
):
    """Drag-and-drop image upload for the journal editor. Returns the
    public R2 URL the editor inlines as a markdown image tag. Reuses
    the same content-type allowlist + bucket pattern as listing
    images so we get free CDN caching, content-disposition handling,
    and parity with the rest of the upload surface."""
    try:
        from r2_storage import is_configured as _r2_ok, upload_bytes, ALLOWED_CONTENT_TYPES
    except Exception:
        raise HTTPException(503, "R2 storage is not available.")
    if not _r2_ok():
        raise HTTPException(503, "R2 storage is not configured.")

    ct = (file.content_type or "").lower()
    if ct not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(400, "Image must be PNG / JPG / WebP.")
    body = await file.read()
    if len(body) == 0:
        raise HTTPException(400, "Empty file.")
    # 8MB upper bound — matches the listing-photo limit so makers learn
    # one cap not two. Anything bigger is almost always an unoptimized
    # phone capture; toast on the frontend nudges them to compress.
    if len(body) > 8 * 1024 * 1024:
        raise HTTPException(413, "Image too large — keep under 8MB.")

    ext = ALLOWED_CONTENT_TYPES[ct]
    key = f"journal/{slug}/{uuid.uuid4().hex}.{ext}"
    try:
        url = upload_bytes(body, key, ct)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("journal image upload failed for maker=%s: %s", slug, e)
        raise HTTPException(502, "Could not upload image.")
    return {"url": url}


# ---------------------------------------------------------------------------
# Maker journal authoring
# Lets a vetted maker publish posts directly into the public Journal feed
# without admin gatekeeping for every entry. Keeps the editorial cadence high
# (more content = better SEO + more reasons for buyers to come back) while
# still recording `created_by_maker` so the admin can quickly demote bad
# actors. Slug is auto-derived from title with a collision suffix because
# makers shouldn't have to think about URL paths.
class MakerJournalCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    excerpt: str
    body: str
    cover: Optional[str] = None        # public image URL (R2/CDN/Unsplash); optional
    read_min: Optional[int] = None     # auto-estimated from body if missing


def _estimate_read_min(body: str) -> int:
    """Rough WPM-based read time. ~225 WPM is the established
    average for English prose; we round up so a 1-minute-and-1-word
    post still shows "2 min read"."""
    words = max(1, len(re.findall(r"\w+", body or "")))
    return max(1, -(-words // 225))


async def _unique_blog_slug(base: str) -> str:
    """Slug-collision strategy: try the bare slug first, then append
    -2, -3, etc. Capped at 25 attempts so a runaway title can't hammer
    Mongo."""
    base = _slugify(base)
    if not await db.blog_posts.find_one({"slug": base}, {"_id": 1}):
        return base
    for n in range(2, 26):
        cand = f"{base}-{n}"
        if not await db.blog_posts.find_one({"slug": cand}, {"_id": 1}):
            return cand
    # Last-ditch: append a 6-char random suffix
    return f"{base}-{uuid.uuid4().hex[:6]}"


@router.post("/maker/journal")
async def maker_create_journal_post(
    payload: MakerJournalCreate,
    slug: str = Depends(current_maker_slug),
):
    """Publish a journal post under the signed-in maker's brand name.

    The post lands directly in the public feed (no admin queue). We
    stamp `created_by_maker` so admins can audit/remove if needed,
    and we cap the body at 50k chars to keep one runaway draft from
    blowing up the API response when listing posts.
    """
    title = (payload.title or "").strip()
    excerpt = (payload.excerpt or "").strip()
    body = (payload.body or "").strip()
    if not title or len(title) < 6:
        raise HTTPException(422, "Title must be at least 6 characters.")
    if not excerpt or len(excerpt) < 20:
        raise HTTPException(422, "Excerpt must be at least 20 characters — give buyers a hook.")
    if not body or len(body) < 100:
        raise HTTPException(422, "Body must be at least 100 characters — share enough to make the read worthwhile.")
    if len(body) > 50_000:
        raise HTTPException(413, "Body too long — please keep posts under 50,000 characters.")
    cover = (payload.cover or "").strip() or None
    if cover and not (cover.startswith("https://") or cover.startswith("http://")):
        raise HTTPException(422, "Cover image must be a public https:// URL.")

    maker = await db.makers.find_one({"slug": slug}, {"_id": 0, "name": 1, "cover": 1})
    if not maker:
        raise HTTPException(404, "Maker not found")

    # If no cover was provided, fall back to the maker's shop cover so
    # the Journal feed never renders a card with a broken image slot.
    final_cover = cover or maker.get("cover") or ""

    new_slug = await _unique_blog_slug(title)
    doc = {
        "id": str(uuid.uuid4()),
        "slug": new_slug,
        "title": title,
        "excerpt": excerpt,
        "body": body,
        "cover": final_cover,
        "author": maker.get("name") or slug,
        "read_min": payload.read_min or _estimate_read_min(body),
        "created_at": now_iso(),
        "created_by_maker": slug,
    }
    await db.blog_posts.insert_one(doc)
    # Strip Mongo-injected `_id` before returning so the response is
    # JSON-serializable; insert_one mutates the dict.
    doc.pop("_id", None)
    logger.info("[maker.journal] %s published post: %s", slug, new_slug)
    return doc


@router.get("/maker/journal/mine")
async def maker_my_journal_posts(slug: str = Depends(current_maker_slug)):
    """List posts authored by the current maker (newest first)."""
    return await db.blog_posts.find(
        {"created_by_maker": slug},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)


@router.delete("/maker/journal/{post_slug}")
async def maker_delete_journal_post(
    post_slug: str,
    slug: str = Depends(current_maker_slug),
):
    """Maker can delete their own posts. We only permit deletion when
    the `created_by_maker` matches the signed-in maker — admin-seeded
    posts are off-limits."""
    res = await db.blog_posts.delete_one({
        "slug": post_slug,
        "created_by_maker": slug,
    })
    if res.deleted_count == 0:
        raise HTTPException(404, "Post not found, or not authored by this maker.")
    return {"ok": True}
