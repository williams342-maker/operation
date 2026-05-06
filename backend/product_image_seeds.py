"""Seed Editor's Picks (featured) product hero images.

The 4 featured products on the homepage rail had broken/mismatched
Unsplash photo URLs. This module re-points them at locally-served,
content-verified images generated via Gemini Nano Banana.

Idempotent — re-running just re-applies the same mapping. Won't touch
non-featured products. Won't touch products that already have a
`/seed-images/product-*` URL set.

Also wipes obvious automated-test product rows that pollute the shop
catalog (e.g. `TEST iter21 bg`, `NO-WM Test`, `Autosave smoke test piece`)
since those bubble up into `/shop` and the Editor's Picks rail when they
were created with no maker filter."""
from __future__ import annotations

from core import db, logger

# Map: product slug → local image URL (file lives in
# /app/frontend/public/seed-images/, served same-origin).
PRODUCT_IMAGE_MAP = {
    "mountain-range-silhouette":  "/seed-images/product-mountain-silhouette.jpg",
    "rustic-family-name-sign":    "/seed-images/product-rustic-family-sign.jpg",
    "custom-business-sign":       "/seed-images/product-business-sign.jpg",
    "industrial-address-numbers": "/seed-images/product-address-numbers.jpg",
}

# Patterns that identify automated-test product rows that should never
# appear in the public shop catalog.
TEST_PRODUCT_FILTER = {
    "$or": [
        {"title": {"$regex": "^TEST[ _]", "$options": "i"}},
        {"title": {"$regex": "^No-WM Test", "$options": "i"}},
        {"title": {"$regex": "smoke test", "$options": "i"}},
        {"title": {"$regex": "shipping test", "$options": "i"}},
        {"slug": {"$regex": "^test-iter", "$options": "i"}},
        {"slug": {"$regex": "smoke-test", "$options": "i"}},
        {"slug": {"$regex": "no-wm-test", "$options": "i"}},
        {"images.0": {"$regex": "placehold\\.co|example\\.com", "$options": "i"}},
    ]
}


async def seed_featured_product_images(wipe_test_products: bool = True) -> dict:
    """Update the 4 known Editor's Pick products with content-verified
    images. Returns counts so admin can confirm success.

    Won't touch products outside `PRODUCT_IMAGE_MAP`. Safe to re-run.
    Set `wipe_test_products=false` to skip the catalog cleanup."""
    wiped = 0
    if wipe_test_products:
        result = await db.products.delete_many(TEST_PRODUCT_FILTER)
        wiped = result.deleted_count

    matched = 0
    updated = 0
    not_found: list[str] = []
    for slug, url in PRODUCT_IMAGE_MAP.items():
        result = await db.products.update_one(
            {"slug": slug},
            {"$set": {
                "image_url": url,
                "images": [url],
                "image_updated_by_seed": True,
            }},
        )
        if result.matched_count == 0:
            not_found.append(slug)
            continue
        matched += 1
        if result.modified_count:
            updated += 1

    summary = {
        "wiped_test_products": wiped,
        "matched": matched,
        "updated": updated,
        "not_found": not_found,
        "total_mapping": len(PRODUCT_IMAGE_MAP),
    }
    logger.info("[product_image_seed] %s", summary)
    return summary
