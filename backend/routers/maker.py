"""Maker self-serve portal: magic-link auth + profile / products / orders endpoints."""
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from core import db, logger, now_iso
from email_service import send_maker_magic_link
from maker_auth import (
    current_maker_slug, issue_magic_token, issue_session_jwt, verify_magic_token,
)
from models import (
    Maker, MakerLoginRequest, MakerProductCreate, MakerProfileUpdate,
    MakerVerifyRequest, Product,
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
    model_url: Optional[str] = None
    images: Optional[List[str]] = None


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
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if updates:
        await db.products.update_one({"slug": product_slug}, {"$set": updates})
    updated = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    return updated


@router.post("/maker/products", response_model=Product)
async def maker_create_product(
    payload: MakerProductCreate,
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
        try:
            from r2_storage import is_configured as _r2_ok, upload_data_url
        except Exception:
            _r2_ok = lambda: False  # noqa: E731
            upload_data_url = None
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
        maker_slug=slug,
        in_stock=int(payload.in_stock),
    )
    await db.products.insert_one(product.model_dump())
    # Bump maker's listings_count (denormalized counter shown on profile cards)
    await db.makers.update_one(
        {"slug": slug}, {"$inc": {"listings_count": 1}}
    )
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


@router.get("/maker/orders")
async def maker_orders(slug: str = Depends(current_maker_slug)):
    """Returns paid orders that include at least one product from this maker."""
    products = await db.products.find({"maker_slug": slug}, {"_id": 0}).to_list(500)
    by_id = {p["id"]: p for p in products}
    by_slug = {p["slug"]: p for p in products}

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
            my_lines.append({
                "product_slug": p["slug"],
                "title": p["title"],
                "price": p["price"],
                "quantity": qty,
                "subtotal": round(float(p["price"]) * qty, 2),
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
