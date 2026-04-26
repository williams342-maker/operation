"""R2 orphan sweeper: walks every object under `products/` and `models/` in
the configured R2 bucket and deletes any key not referenced by a `Product`
record (image_url or model_url).

Safe to run periodically. Idempotent. By default it runs in DRY mode so you
can confirm what would be deleted; pass `--apply` to actually delete.

Usage:
    cd /app/backend
    python -m scripts.sweep_r2_orphans            # dry run, prints orphan list
    python -m scripts.sweep_r2_orphans --apply    # delete confirmed orphans
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
from typing import Iterable

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient   # noqa: E402
import r2_storage   # noqa: E402

PREFIXES = ("products/", "models/", "banners/")


async def collect_referenced_keys(db) -> set[str]:
    """Build the set of R2 keys actually referenced by live + soft-deleted
    products. We never sweep keys still pointed at by *any* product row —
    soft-deleted ones may still need their images for refunds, audit, etc.
    """
    refs: set[str] = set()
    # Product references (images, model_url, variant images)
    cursor = db.products.find(
        {}, {"_id": 0, "images": 1, "model_url": 1, "variants": 1}
    )
    async for p in cursor:
        for img in (p.get("images") or []):
            k = r2_storage.key_from_public_url(img) if isinstance(img, str) else None
            if k:
                refs.add(k)
        m = p.get("model_url")
        if isinstance(m, str):
            k = r2_storage.key_from_public_url(m)
            if k:
                refs.add(k)
        for v in (p.get("variants") or []):
            vi = v.get("image") if isinstance(v, dict) else None
            if isinstance(vi, str):
                k = r2_storage.key_from_public_url(vi)
                if k:
                    refs.add(k)
    # Maker references (custom shop banners)
    mcursor = db.makers.find({}, {"_id": 0, "banner_image_url": 1})
    async for mk in mcursor:
        b = mk.get("banner_image_url")
        if isinstance(b, str):
            k = r2_storage.key_from_public_url(b)
            if k:
                refs.add(k)
    return refs


def _list_keys_under(prefix: str) -> Iterable[str]:
    """Page through R2 keys under a prefix using boto3's S3 list_objects_v2."""
    cli = r2_storage.client()
    token = None
    while True:
        kwargs = {"Bucket": r2_storage.R2_BUCKET, "Prefix": prefix, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        resp = cli.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []) or []:
            yield obj["Key"]
        if not resp.get("IsTruncated"):
            return
        token = resp.get("NextContinuationToken")


async def sweep(apply: bool = False) -> dict:
    if not r2_storage.is_configured():
        return {"error": "R2 not configured", "scanned": 0, "orphans": 0, "deleted": 0}
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ["DB_NAME"]]
    referenced = await collect_referenced_keys(db)
    scanned = 0
    orphans: list[str] = []
    for prefix in PREFIXES:
        for key in _list_keys_under(prefix):
            scanned += 1
            if key not in referenced:
                orphans.append(key)
    deleted = 0
    if apply:
        cli = r2_storage.client()
        for key in orphans:
            try:
                cli.delete_object(Bucket=r2_storage.R2_BUCKET, Key=key)
                deleted += 1
            except Exception as e:
                print(f"  ✗ failed to delete {key}: {e}")
    return {
        "scanned": scanned,
        "referenced": len(referenced),
        "orphans": len(orphans),
        "deleted": deleted,
        "orphan_keys": orphans[:50],   # truncated preview
    }


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually delete orphans")
    args = ap.parse_args()
    res = await sweep(apply=args.apply)
    print("\n=== r2 sweep ===")
    for k, v in res.items():
        if k == "orphan_keys":
            if v:
                print(f"  {k} ({len(v)} of {res['orphans']} shown):")
                for o in v:
                    print(f"    {o}")
        else:
            print(f"  {k}: {v}")
    if not args.apply and res.get("orphans", 0) > 0:
        print("\nDRY RUN. Re-run with --apply to delete.")


if __name__ == "__main__":
    asyncio.run(main())
