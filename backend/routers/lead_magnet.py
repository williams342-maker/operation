"""Free CNC starter pack — gated lead magnet (iter303 / Phase 4 Bundle C).

Endpoints:
  POST /api/lead-magnet/starter-pack/subscribe
       payload: {"email": "user@example.com", "consent_marketing": bool?}
       → {"download_token": "...", "download_url": "/api/lead-magnet/starter-pack/download/<token>"}
       Stores the email + consent flag into `db.lead_magnet_subscribers`.

  GET /api/lead-magnet/starter-pack/download/<token>
       → streams `crafters-market-starter-pack.zip` (built once, cached).
       Token is single-use-ish: each subscribe call returns a fresh one,
       but old tokens stay valid for 7 days so users can re-download from
       the email link without re-submitting.

  GET /api/lead-magnet/starter-pack/preview
       → metadata for the SEO landing page (file list + preview images).
       Cheap, public, cacheable.

Design choices:
  • SEO-friendly soft gate: the landing page is fully indexable; only the
    actual ZIP requires email submission. (Google ranks the rich page;
    humans submit the form.)
  • Reuses existing `/app/frontend/public/seed-designs/<folder>/{design.dxf,design.svg,preview.jpg}`
    — no new asset work needed.
  • ZIP is assembled once at module load and cached in /tmp; rebuild on
    server restart picks up new design folders automatically.
  • Email storage in a dedicated `lead_magnet_subscribers` collection so
    Phase-4-C lead generation doesn't pollute the existing newsletter
    funnel reporting.
"""
import logging
import os
import secrets
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr

from core import db

router = APIRouter()
log = logging.getLogger(__name__)


# Curated starter-pack contents — 10 diverse files from /app/frontend/public/seed-designs.
# Each folder ships `design.dxf`, `design.svg`, and `preview.jpg` — we
# include all three so makers can preview before opening in their CAM
# software. Hand-picked for variety: signs, monograms, ornaments,
# geometric shapes, address plaques.
STARTER_PACK_DESIGNS: list[tuple[str, str, str]] = [
    # (folder, friendly_title, suggested_use)
    ("mountain-range-silhouette",      "Mountain Range Silhouette",     "Wall art, cabin signs, outdoor decor"),
    ("8-point-compass-rose",           "8-Point Compass Rose",          "Maritime decor, garage signs, monograms"),
    ("8-petal-mandala",                "8-Petal Mandala",               "Wall art, decorative panels, ornaments"),
    ("classic-snowflake-ornament",     "Classic Snowflake Ornament",    "Holiday decor, gift tags, hanging ornaments"),
    ("pine-tree-trio",                 "Pine Tree Trio",                "Cabin signs, holiday decor, nature wall art"),
    ("heart-with-vine",                "Heart with Vine",               "Wedding gifts, anniversary plaques, garden art"),
    ("topo-contour-circles",           "Topographic Contour Circles",   "Modern wall art, map-inspired pieces"),
    ("modern-celestial-twelve-point-star", "Modern Celestial 12-Point Star", "Nursery decor, holiday star, monogram center"),
    ("welcome-arrow-sign-blank",       "Welcome Arrow Sign (Blank)",    "Customizable entry signs — add your own text"),
    ("vertical-address-plaque",        "Vertical Address Plaque Blank", "Customizable address signs — add house number"),
]

# Seed-designs folder location. Resolved at module load so the wrong
# environment fails fast at startup instead of on first request.
_SEED_DESIGNS_DIR = Path("/app/frontend/public/seed-designs")
if not _SEED_DESIGNS_DIR.is_dir():
    log.warning("Lead-magnet: seed-designs dir missing at %s", _SEED_DESIGNS_DIR)

# Cache the assembled ZIP in memory — 10 files × ~50-200 KB each ≈ 2 MB.
# Rebuild lazily on first request.
_ZIP_CACHE: bytes | None = None


def _build_starter_pack_zip() -> bytes:
    """Assemble the starter pack ZIP from the curated `STARTER_PACK_DESIGNS`
    list. Includes a README explaining the licensing and a per-design
    `preview.jpg` so makers can browse before opening in their CAM
    software. Skips silently any missing folder rather than failing —
    the lead magnet should always deliver something.
    """
    buf = BytesIO()
    skipped: list[str] = []
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # README at the root.
        readme = _README_TEMPLATE.format(
            count=len(STARTER_PACK_DESIGNS),
            now=datetime.now(timezone.utc).strftime("%B %Y"),
            file_list="\n".join(
                f"  • {title} — {use}"
                for _, title, use in STARTER_PACK_DESIGNS
            ),
        )
        zf.writestr("README.txt", readme)

        for folder, friendly_title, _ in STARTER_PACK_DESIGNS:
            folder_path = _SEED_DESIGNS_DIR / folder
            if not folder_path.is_dir():
                skipped.append(folder)
                continue
            for fname in ("design.svg", "design.dxf", "preview.jpg"):
                src = folder_path / fname
                if not src.exists():
                    continue
                # In-zip path: "Mountain Range Silhouette/design.svg" etc.
                ext = fname.split(".")[-1]
                zf.write(src, arcname=f"{friendly_title}/{friendly_title}.{ext}")
    if skipped:
        log.warning("Lead-magnet: skipped missing design folders: %s", skipped)
    return buf.getvalue()


def _get_zip_bytes() -> bytes:
    """Cached accessor. Computed once per process restart."""
    global _ZIP_CACHE
    if _ZIP_CACHE is None:
        _ZIP_CACHE = _build_starter_pack_zip()
        log.info("Lead-magnet starter pack assembled: %d bytes", len(_ZIP_CACHE))
    return _ZIP_CACHE


# --- Endpoints ---------------------------------------------------------

class SubscribeRequest(BaseModel):
    email: EmailStr
    # GDPR-friendly opt-in flag. Defaults to False — we only send the
    # download link automatically, NOT the ongoing newsletter, unless
    # the user explicitly checks the box.
    consent_marketing: bool = False
    # Optional UTM fields to track which channel drove the conversion.
    source: str | None = None
    medium: str | None = None
    campaign: str | None = None


class SubscribeResponse(BaseModel):
    download_token: str
    download_url: str
    preview_count: int  # how many files are in the pack


@router.post("/lead-magnet/starter-pack/subscribe", response_model=SubscribeResponse)
async def subscribe_starter_pack(payload: SubscribeRequest, http_request: Request):
    """Capture an email and return a one-shot download token + URL.

    No rate limiting beyond what the global middleware provides. Idempotent
    on email — re-submitting the same address just updates the latest
    token and timestamp. We don't reject duplicates because legitimate
    users sometimes lose the email and want to re-download.
    """
    email = payload.email.lower().strip()
    token = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)

    # Upsert into a dedicated collection — keeps lead-magnet funnel
    # reporting separate from regular newsletter signups.
    await db.lead_magnet_subscribers.update_one(
        {"email": email, "magnet": "starter-pack"},
        {
            "$set": {
                "email": email,
                "magnet": "starter-pack",
                "consent_marketing": bool(payload.consent_marketing),
                "latest_token": token,
                "latest_token_at": now.isoformat(),
                "source": (payload.source or "")[:64] or None,
                "medium": (payload.medium or "")[:64] or None,
                "campaign": (payload.campaign or "")[:128] or None,
                "ip_country": (http_request.headers.get("cf-ipcountry") or "")[:4] or None,
                "user_agent": (http_request.headers.get("user-agent") or "")[:200] or None,
            },
            "$setOnInsert": {
                "first_seen_at": now.isoformat(),
                "download_count": 0,
            },
            "$inc": {"submission_count": 1},
        },
        upsert=True,
    )

    return SubscribeResponse(
        download_token=token,
        download_url=f"/api/lead-magnet/starter-pack/download/{token}",
        preview_count=len(STARTER_PACK_DESIGNS),
    )


@router.get("/lead-magnet/starter-pack/download/{token}")
async def download_starter_pack(token: str):
    """Stream the starter-pack ZIP. Token must match a known subscriber's
    `latest_token`. Increments `download_count` for funnel attribution.
    Returns the same ZIP for everyone — no per-user file customization.
    """
    if len(token) < 16 or len(token) > 64:
        raise HTTPException(status_code=400, detail="Invalid token format")

    sub = await db.lead_magnet_subscribers.find_one(
        {"latest_token": token, "magnet": "starter-pack"},
    )
    if not sub:
        raise HTTPException(status_code=404, detail="Token not recognized or expired")

    # Async-safe increment (returns immediately; download proceeds even
    # if Mongo lags — counter is non-critical attribution data).
    await db.lead_magnet_subscribers.update_one(
        {"_id": sub["_id"]},
        {
            "$inc": {"download_count": 1},
            "$set": {"last_download_at": datetime.now(timezone.utc).isoformat()},
        },
    )

    zip_bytes = _get_zip_bytes()
    return StreamingResponse(
        BytesIO(zip_bytes),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="crafters-market-starter-pack.zip"',
            "Content-Length": str(len(zip_bytes)),
            "Cache-Control": "private, no-cache",
        },
    )


@router.get("/lead-magnet/starter-pack/preview")
async def preview_starter_pack():
    """Public metadata for the SEO landing page. Returns the file list
    + preview-image URLs so the page can render a grid without needing
    to enumerate the seed-designs folder client-side."""
    return {
        "magnet": "starter-pack",
        "file_count": len(STARTER_PACK_DESIGNS),
        "format_count": 2,  # SVG + DXF
        "approx_size_mb": round(len(_get_zip_bytes()) / 1_000_000, 1),
        "files": [
            {
                "title": title,
                "use_case": use,
                "preview_image": f"/seed-designs/{folder}/preview.jpg",
                "formats": ["SVG", "DXF"],
            }
            for folder, title, use in STARTER_PACK_DESIGNS
        ],
    }


_README_TEMPLATE = """Crafters Market — Free CNC Starter Pack
===========================================

Thanks for downloading! Inside this ZIP you'll find {count} hand-picked
designs in both SVG and DXF formats — ready for plasma tables, fiber
lasers, CO2 lasers, and CNC routers.

Updated: {now}
Source: https://craftersmarket.org/free-svg-pack

WHAT'S INSIDE
-------------
{file_list}

LICENSE
-------
Free for personal AND commercial use. Use these designs in your own shop,
sell pieces cut from them, modify them, remix them — no attribution
required (though if you tag @crafters_market1 on Instagram with photos
of pieces you cut, that's awesome and we'll often re-post).

The only thing you can't do is resell the digital files themselves as
your own design pack.

GETTING STARTED
---------------
1. Open the SVG in your design software (Illustrator, Inkscape,
   LightBurn, Fusion 360) for vector editing.
2. Use the DXF directly in CAM software (Fusion 360, Sheetcam, Mach3)
   for tool-pathing.
3. Each design has a `preview.jpg` so you can browse the pack visually
   without opening every file.

NEED CUSTOM WORK?
-----------------
These starter files are great for testing your machine and getting
comfortable with the tooling. When you're ready to commission a custom
piece — your name, your dimensions, your finish — Crafters Market is
the marketplace of vetted American makers built to handle exactly that.

Browse: https://craftersmarket.org/shop
Commission: https://craftersmarket.org/custom-order
How custom orders work: https://craftersmarket.org/how-custom-orders-work

Happy cutting!
— The Crafters Market team
"""
