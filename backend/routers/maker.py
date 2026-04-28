"""Maker self-serve portal: magic-link auth + profile / products / orders endpoints."""
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict

from core import db, logger, now_iso
from email_service import send_maker_magic_link
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
    accept_returns: Optional[bool] = None
    accept_exchanges: Optional[bool] = None
    seo_tags: Optional[List[str]] = None
    contact_email: Optional[str] = None


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
    if payload.variants is not None:
        for v in payload.variants:
            if not v.label.strip():
                raise HTTPException(400, "Each variant needs a label.")
            if v.in_stock < 0:
                raise HTTPException(400, "Variant stock must be non-negative.")
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if updates:
        await db.products.update_one({"slug": product_slug}, {"$set": updates})
    updated = await db.products.find_one({"slug": product_slug}, {"_id": 0})
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
        {"$set": {"status": "published", "expires_at": expiry_iso_from_now()}},
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
        {"$set": {"status": "published", "expires_at": expiry_iso_from_now()}},
    )
    return await db.products.find_one({"slug": product_slug}, {"_id": 0})


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
    if len(payload.images) > 5:
        raise HTTPException(400, "Maximum 5 images per listing.")
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
    try:
        from r2_storage import is_configured as _r2_ok, upload_data_url
    except Exception:
        _r2_ok = lambda: False  # noqa: E731
        upload_data_url = None  # type: ignore
    if payload.images:
        for img in payload.images:
            if img.startswith("data:") and _r2_ok():
                try:
                    url = upload_data_url(img, key_prefix=f"products/{slug}")
                    final_images.append(url or img)
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
        if img and isinstance(img, str) and img.startswith("data:") and _r2_ok():
            try:
                url = upload_data_url(img, key_prefix=f"products/{slug}/variants")
                v_dump = v.model_dump()
                v_dump["image"] = url or img
                final_variants.append(ProductVariant(**v_dump))
                continue
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
        accept_returns=bool(payload.accept_returns),
        accept_exchanges=bool(payload.accept_exchanges),
        seo_tags=(payload.seo_tags or [])[:13],
        contact_email=payload.contact_email,
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
    from routers.stripe_connect import PLATFORM_FEE_BPS, PROCESSING_FEE_BPS
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
            })
        if not my_lines:
            continue
        out.append({
            "session_id": tx.get("session_id"),
            "buyer_email": tx.get("customer_email"),
            "created_at": tx.get("created_at"),
            "payment_status": tx.get("payment_status"),
            "items": my_lines,
            "maker_subtotal": round(sum(line["subtotal"] for line in my_lines), 2),
        })
    return out



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
