"""Buyer-side personalization image upload (iter150).

Public-facing route — buyers aren't logged in when shopping.
Uploads land in R2 under `personalization/<uuid>.<ext>` and the
returned URL is stored on the cart line item, then on the order
doc, then surfaced in the maker's order email.

Abuse mitigations (free upload endpoint = honeypot target):
  • Hard size cap (5 MB, enforced before R2 call)
  • Whitelisted content types (PNG, JPEG, WEBP, HEIC, GIF)
  • Per-IP rate limit (10 uploads / hour, sliding window in
    Mongo so this is process-wide, not per-pod)
  • Cloudflare-aware IP extraction (cf-connecting-ip first)
  • Auto-expiry: a TTL cleanup pass runs in the scheduler and
    deletes orphan uploads after 7 days IF they're never
    referenced by an order. (Cleanup job — not in this file.)

We accept base64 data URLs (matches the existing R2 flow used
by makers — keeps the frontend simple and avoids multipart edge
cases on mobile Safari).
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core import db, logger
from r2_storage import upload_data_url, is_configured

router = APIRouter()

MAX_UPLOAD_BYTES = 5 * 1024 * 1024            # 5 MB
RATE_LIMIT_PER_HOUR = 10                       # uploads per IP per hour
RATE_WINDOW_SECONDS = 3600


def _ip_hash(request: Request) -> str:
    """Hash the originating IP. Same logic as the share counter."""
    ip = (
        request.headers.get("cf-connecting-ip")
        or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        or (request.client.host if request.client else "")
        or "unknown"
    )
    return hashlib.sha256(ip.encode("utf-8")).hexdigest()[:24]


class PersonalizationUpload(BaseModel):
    image_data_url: str = Field(..., min_length=64, max_length=10_000_000)


@router.post("/personalization/upload")
async def upload_personalization_image(
    payload: PersonalizationUpload, request: Request,
) -> dict:
    """Accept a base64 data URL → store in R2 → return public URL.

    Anonymous endpoint by design — buyers aren't authenticated when
    shopping. Anti-abuse: size cap, content-type whitelist (enforced
    in r2_storage), per-IP hourly rate limit.
    """
    if not is_configured():
        raise HTTPException(503, "Image upload service is not configured.")

    # Size sanity check before we burn CPU on base64 decode. A 5 MB
    # raw image is ~6.8 MB in base64; we cap the URL at 10 MB to
    # leave headroom for the header bytes but not let a 50 MB upload
    # tie up the worker. Real enforcement is on the decoded bytes
    # which `upload_data_url` would catch — but we want to fail fast.
    if len(payload.image_data_url) > MAX_UPLOAD_BYTES * 1.5:
        raise HTTPException(413, "Image is too large. Max 5 MB.")

    # Per-IP rate limit. We record each successful upload in
    # `personalization_uploads` so we can also use the same collection
    # later for orphan cleanup (delete R2 keys never referenced by an
    # order after 7 days). Window is a sliding 1h count.
    iph = _ip_hash(request)
    now = datetime.now(timezone.utc)
    cutoff_iso = (now - timedelta(seconds=RATE_WINDOW_SECONDS)).isoformat()
    same_window = await db.personalization_uploads.count_documents({
        "ip_hash": iph, "created_at": {"$gte": cutoff_iso},
    })
    if same_window >= RATE_LIMIT_PER_HOUR:
        raise HTTPException(
            429,
            "Too many uploads in the last hour. Please try again later.",
        )

    try:
        url = upload_data_url(payload.image_data_url, "personalization")
    except ValueError as e:
        # Unsupported content type — surface a friendly error so the
        # buyer knows to convert to JPG/PNG.
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("[personalization] R2 upload failed: %s", e)
        raise HTTPException(500, "Upload failed. Please try again.")

    if not url:
        raise HTTPException(400, "Could not decode image. Please try a JPG/PNG.")

    # Record for orphan-cleanup tracking + rate limit accounting.
    await db.personalization_uploads.insert_one({
        "ip_hash": iph,
        "url": url,
        "created_at": now.isoformat(),
        "referenced": False,    # flipped to True when an order uses it
    })

    return {"url": url}
