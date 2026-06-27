"""iter413cq — Platform Capabilities single source of truth.

Loretta Alvarado's seller feedback surfaced contradictory AI answers
about platform features (the assistant said videos weren't supported,
then said they might be, then said to report a bug). Root cause: the
AI prompt embedded static assumptions that drifted from reality.

This endpoint is the SINGLE source of truth the AI Help Assistant
consults before answering any platform-mechanics question. It also
backs future surfaces (admin diagnostics, automated documentation
generators, the eventual Craft Taxonomy service).

Design notes (forward-compat with the planned centralized Craft Taxonomy):
  • Aggregator pattern — each field reads from its current home
    (CATEGORIES list, TECHNIQUES_BY_CATEGORY, PRODUCT_GUIDES registry,
    env flags). When the Craft Taxonomy service exists, swap each
    aggregator for a Mongo read inside this same shape — consumers
    don't change.
  • Stable JSON shape. Additive changes only. Never remove a key.
  • No auth required — the AI Help Assistant runs in unauthenticated
    sessions too, and there's nothing sensitive here.
  • Cached at the edge for 60s (set via Cache-Control header).
"""
from __future__ import annotations

import os
from fastapi import APIRouter, Response

router = APIRouter()


# Mirrors the frontend CATEGORIES + TECHNIQUES_BY_CATEGORY constants.
# Kept in sync manually for now — a `cm taxonomy verify` CI lint will
# replace this when the Craft Taxonomy service ships.
_CATEGORIES = [
    "Wall Art", "Custom Signs", "Outdoor Art", "Home Decor",
    "Wedding Gifts", "Business Signage", "Address Numbers",
    "Lighting & Lamps", "Garden & Yard Art", "Memorial & Tribute",
    "Furniture", "Kitchen & Bar", "Sculpture", "Jewelry & Wearables",
    "Pottery & Ceramics", "Woodworking", "Leather Goods",
    "Fiber & Textiles", "Glass", "Paper Crafts", "Mixed Media",
    "Holiday & Seasonal", "Other",
]

_TECHNIQUES_BY_CATEGORY = {
    "Wall Art":            ["Plasma", "Laser", "Painting", "Photography", "Mixed Media", "Embroidery", "Wood Burning", "Other"],
    "Custom Signs":        ["Plasma", "Laser Cutting", "Laser Engraving", "Router", "CNC", "Hand-Painted", "Vinyl", "Wood Burning", "Other"],
    "Outdoor Art":         ["Plasma", "Laser", "Forge", "Stone Carving", "Mosaic", "Cast", "Other"],
    "Business Signage":    ["Plasma", "Laser Cutting", "Laser Engraving", "Router", "Vinyl", "Hand-Painted", "Engraving", "Other"],
    "Address Numbers":     ["Plasma", "Laser", "Forge", "Cast", "Hand-Painted", "Other"],
    "Garden & Yard Art":   ["Plasma", "Laser", "Forge", "Stone Carving", "Mosaic", "Mixed Media", "Other"],
    "Memorial & Tribute":  ["Engraving", "Laser Cutting", "Laser Engraving", "Forge", "Calligraphy", "Stone Carving", "Mixed Media", "Other"],
    "Woodworking":         ["Hand Carving", "Scroll Saw", "Router", "Wood Turning", "Pyrography", "CNC", "Joinery", "Other"],
    "Furniture":           ["Hand Carving", "Joinery", "Wood Turning", "CNC", "Upholstery", "Mixed Media", "Other"],
    "Kitchen & Bar":       ["Wood Turning", "Forge", "Engraving", "Laser Cutting", "Laser Engraving", "Pottery", "Resin", "Other"],
    "Sculpture":           ["Forge", "Stone Carving", "Wood Carving", "Cast", "Mixed Media", "Mosaic", "Other"],
    "Lighting & Lamps":    ["Glassblowing", "Stained Glass", "Metalwork", "Wood", "Resin", "Mixed Media", "Other"],
    "Home Decor":          ["Hand-Painted", "Macramé", "Mosaic", "Embroidery", "Quilting", "Wood Burning", "Mixed Media", "Other"],
    "Wedding Gifts":       ["Engraving", "Embroidery", "Calligraphy", "Hand-Painted", "Mixed Media", "Other"],
    "Jewelry & Wearables": ["Wire Wrapping", "Silversmithing", "Resin", "Lost Wax Casting", "Enameling", "Electroforming", "Embroidery", "Beading", "Chainmaille", "Leatherwork", "Laser Cutting", "Laser Engraving", "Other"],
    "Fiber & Textiles":    ["Embroidery", "Thread Painting", "Sewing", "Quilting", "Crochet", "Knitting", "Weaving", "Needle Felting", "Macramé", "Mixed Media", "Other"],
    "Leather Goods":       ["Tooling", "Hand Stitching", "Carving", "Dyeing", "Braiding", "Burnishing", "Laser Engraving", "Other"],
    "Pottery & Ceramics":  ["Wheel Throwing", "Hand Building", "Slip Casting", "Raku", "Glazing", "Sgraffito", "Other"],
    "Holiday & Seasonal":  ["Mixed Media", "Embroidery", "Plasma", "Laser", "Hand-Painted", "Wood Burning", "Other"],
    "Paper Crafts":        ["Origami", "Quilling", "Papier-Mâché", "Bookbinding", "Hand-Cut", "Mixed Media", "Other"],
    "Mixed Media":         ["Collage", "Assemblage", "Resin", "Hand-Painted", "Embroidery", "Other"],
    "Glass":               ["Glassblowing", "Stained Glass", "Fused Glass", "Lampwork", "Etching", "Mosaic", "Other"],
    "Other":               ["Mixed Media", "Hand-Made", "Digital Fabrication", "Hybrid", "Other"],
}

_PRODUCT_GUIDES = [
    {"slug": "metal-gauge-finish-guide", "title": "Metal Gauge & Finish Guide",
     "categories_eligible": ["Outdoor Art", "Custom Signs", "Business Signage", "Address Numbers", "Garden & Yard Art", "Wall Art", "Memorial & Tribute", "Sculpture"]},
    {"slug": "outdoor-mounting-guide", "title": "Outdoor Mounting Guide",
     "categories_eligible": ["Outdoor Art", "Garden & Yard Art", "Address Numbers", "Custom Signs", "Business Signage", "Memorial & Tribute", "Sculpture"]},
    {"slug": "plasma-vs-laser-vs-router", "title": "Plasma vs Laser vs Router",
     "categories_eligible": ["Wall Art", "Custom Signs", "Business Signage", "Address Numbers", "Outdoor Art", "Garden & Yard Art", "Memorial & Tribute"]},
]


@router.get("/platform/capabilities")
async def platform_capabilities(response: Response):
    """Single source of truth for live platform state. Consumed by:
      • The AI Help Assistant (prevents contradictory answers about
        feature availability — see Loretta Alvarado feedback).
      • Admin diagnostic surfaces.
      • Future Craft Taxonomy service migration target."""
    response.headers["Cache-Control"] = "public, max-age=60"
    return build_capabilities_payload()


def build_capabilities_payload() -> dict:
    """Same payload as the HTTP endpoint, callable in-process so the
    AI Help Assistant can inject it into its system prompt without
    a network round-trip."""
    return {
        # ── Schema version. Bump when removing/renaming a field. Add
        # fields freely without bumping — additive changes are safe. ──
        "schema_version": "1.0.0",

        # ── Feature flags (live, runtime-driven) ──────────────────────
        "features": {
            "listing_videos": {
                "upload_enabled": True,
                "gallery_render_enabled": True,
                "max_per_listing": 1,
                "supported_video_formats": ["mp4", "mov"],
                "accepted_mime_types": ["video/mp4", "video/quicktime"],
                "max_size_mb": 100,
                "max_duration_seconds": 60,
                "autoplay": False,
                "user_message": (
                    "Listings support one product video — MP4 or MOV, up to 60 seconds "
                    "and 100 MB. Native playback with native controls; no autoplay."
                ),
            },
            "community_videos": {
                "upload_enabled": True,
                "context": "Community video posts (separate from listing media) are supported.",
            },
            "custom_shop_url": {
                "enabled": True,
                "eligible_tiers": ["plus", "founder", "inaugural_founder"],
            },
            "tiktok_pixel": {
                "enabled": bool(os.environ.get("TIKTOK_PIXEL_ID")),
            },
            "tiktok_events_api": {
                "enabled": bool(os.environ.get("TIKTOK_CAPI_ACCESS_TOKEN")),
            },
            "google_search_console": {
                "enabled": (os.environ.get("GSC_ENABLED") or "").strip() == "1",
            },
        },

        # ── Listing media constraints ─────────────────────────────────
        "listing_uploads": {
            "image": {
                "accepted_mime_types": ["image/jpeg", "image/png", "image/gif", "image/webp"],
                "max_size_mb": 8,
                "min_recommended_dimensions": "1200x1200",
                "max_per_listing": 12,
            },
            "video": {
                "accepted_mime_types": ["video/mp4", "video/quicktime"],
                "max_size_mb": 100,
                "max_duration_seconds": 60,
                "max_per_listing": 1,
                "supported_extensions": ["mp4", "mov"],
                "note": "One product video per listing. Native HTML5 playback on the PDP gallery.",
            },
        },

        # ── Taxonomy (proxy to the eventual Craft Taxonomy service) ───
        "taxonomy": {
            "categories": _CATEGORIES,
            "techniques_by_category": _TECHNIQUES_BY_CATEGORY,
            "product_guides": _PRODUCT_GUIDES,
        },

        # ── Seller-tier limits + commerce ─────────────────────────────
        "seller_limits": {
            "standard": {
                "commission_pct": 5,
                "free_listings_total": 10,
                "free_listings_period": "lifetime",
            },
            "plus": {
                "commission_pct": 4,
                "free_listings_total": 15,
                "free_listings_period": "monthly",
                "price_usd_per_month": 12,
            },
            "founder": {
                "commission_pct": 3,
                "free_listings_total": 50,
                "free_listings_period": "monthly",
                "duration_days": 365,
            },
            "inaugural_founder": {
                "commission_pct": 3,
                "free_listings_total": 50,
                "free_listings_period": "monthly",
                "duration": "lifetime",
                "cohort_cap": 100,
            },
        },

        # ── Commerce policy ───────────────────────────────────────────
        "commerce": {
            "processing_fee_pct": 3,
            "free_shipping_threshold_usd": 250,
            "returns_window_days": 14,
            "craftsmanship_guarantee_days": 30,
        },

        # ── Support routing ───────────────────────────────────────────
        "support": {
            "general_email": "team@craftersmarket.org",
            "founders_email": "founders@craftersmarket.org",
        },
    }
