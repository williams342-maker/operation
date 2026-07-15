"""Rewrite every R2 image / model URL host in MongoDB. Used after switching
from the auto-generated pub-xxx.r2.dev domain to a custom CDN domain.

Idempotent. Pass --dry-run to preview without writes.

Usage:
    cd /app/backend
    python -m scripts.swap_r2_host \\
        --old https://pub-96d13eb6b15840a98236f6c1053262c3.r2.dev \\
        --new https://cdn.craftersmarket.org

    # Preview only:
    python -m scripts.swap_r2_host --old <a> --new <b> --dry-run
"""
from __future__ import annotations

from config import settings
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient   # noqa: E402


async def main(old: str, new: str, dry: bool) -> int:
    old = old.rstrip("/")
    new = new.rstrip("/")
    if old == new:
        print("old and new are identical — nothing to do.")
        return 0
    mongo = AsyncIOMotorClient(settings.mongo_url)
    db = mongo[settings.db_name]

    total = touched = errors = 0
    async for p in db.products.find({}, {"_id": 0, "slug": 1, "images": 1, "model_url": 1}):
        total += 1
        new_imgs = [
            (img.replace(old, new) if isinstance(img, str) and img.startswith(old) else img)
            for img in (p.get("images") or [])
        ]
        m = p.get("model_url")
        new_model = m.replace(old, new) if isinstance(m, str) and m.startswith(old) else m

        changed = (new_imgs != (p.get("images") or [])) or (new_model != m)
        if not changed:
            continue
        touched += 1
        if dry:
            print(f"  would update {p['slug']}: {len(new_imgs)} img(s){' + model' if new_model != m else ''}")
        else:
            try:
                upd = {"images": new_imgs}
                if new_model != m:
                    upd["model_url"] = new_model
                await db.products.update_one({"slug": p["slug"]}, {"$set": upd})
                print(f"  ✓ updated {p['slug']}")
            except Exception as e:
                errors += 1
                print(f"  ✗ {p['slug']}: {e}")

    # ---- Maker banners (Plus subscribers only have these, but rewrite all) ----
    makers_total = makers_touched = 0
    async for mk in db.makers.find({}, {"_id": 0, "slug": 1, "banner_image_url": 1}):
        makers_total += 1
        b = mk.get("banner_image_url")
        if not (isinstance(b, str) and b.startswith(old)):
            continue
        new_b = b.replace(old, new)
        makers_touched += 1
        if dry:
            print(f"  would update maker {mk['slug']}: banner")
        else:
            try:
                await db.makers.update_one({"slug": mk["slug"]}, {"$set": {"banner_image_url": new_b}})
                print(f"  ✓ updated maker {mk['slug']} (banner)")
            except Exception as e:
                errors += 1
                print(f"  ✗ maker {mk['slug']}: {e}")

    print("\n=== swap summary ===")
    print(f"products scanned : {total}")
    print(f"  affected       : {touched}")
    print(f"makers scanned   : {makers_total}")
    print(f"  affected       : {makers_touched}")
    print(f"  errors         : {errors}")
    print(f"  mode           : {'dry-run' if dry else 'applied'}")
    return 0 if errors == 0 else 2


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", required=True, help="current R2 host URL")
    ap.add_argument("--new", required=True, help="new R2 host URL")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    sys.exit(asyncio.run(main(args.old, args.new, args.dry_run)))
