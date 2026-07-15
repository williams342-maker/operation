"""One-time migration: walk every product image stored as a base64 `data:` URL
in MongoDB, upload it to Cloudflare R2, and rewrite the URL in-place.

Idempotent — products that already have http(s) URLs are left alone.

Run from backend dir:
    cd /app/backend
    python -m scripts.migrate_images_to_r2
"""
from __future__ import annotations

from config import settings
import asyncio
import os
import sys

# Allow running both as `python -m scripts.migrate_images_to_r2` and
# `python /app/backend/scripts/migrate_images_to_r2.py`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient   # noqa: E402
import r2_storage   # noqa: E402


async def main():
    if not r2_storage.is_configured():
        print("R2 not configured (missing env). Aborting.")
        return 1

    mongo = AsyncIOMotorClient(settings.mongo_url)
    db = mongo[settings.db_name]

    cursor = db.products.find({}, {"_id": 0})
    total = migrated = unchanged = errors = 0
    async for p in cursor:
        total += 1
        slug = p.get("slug") or p.get("id") or "unknown"
        maker_slug = p.get("maker_slug", "misc")
        imgs = p.get("images") or []
        new_imgs = []
        changed = False
        for img in imgs:
            if not isinstance(img, str):
                new_imgs.append(img)
                continue
            if img.startswith("data:"):
                try:
                    url = r2_storage.upload_data_url(
                        img, key_prefix=f"products/{maker_slug}"
                    )
                    if url:
                        new_imgs.append(url)
                        changed = True
                        print(f"  ✓ {slug}: uploaded → {url}")
                    else:
                        new_imgs.append(img)
                except Exception as e:
                    errors += 1
                    new_imgs.append(img)
                    print(f"  ✗ {slug}: upload failed: {e}")
            else:
                new_imgs.append(img)
        if changed:
            await db.products.update_one(
                {"slug": p["slug"]},
                {"$set": {"images": new_imgs}},
            )
            migrated += 1
        else:
            unchanged += 1

    print("\n=== migration summary ===")
    print(f"products scanned : {total}")
    print(f"  migrated       : {migrated}")
    print(f"  unchanged      : {unchanged}")
    print(f"  errors         : {errors}")
    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
