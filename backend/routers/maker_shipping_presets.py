"""Maker shipping-preset live-rate router (iter334).

Single endpoint:
    POST /api/maker/shipping/preset-rates    { preset_id, to_zip? }
        → live Shippo rates for the given preset (dimensions + weight),
          using the maker's saved ship-from address and a sane US
          destination ZIP fallback. Returns top 3 cheapest rates sorted
          by amount. Used by the Listing Editor's preset picker to show
          REAL carrier prices instead of static $/preset table values.

Falls back gracefully:
    * No saved ship-from → uses platform demo ship-from (Austin, TX 78701).
    * No to_zip supplied → uses 64101 (Kansas City, MO — mid-US default).
    * Shippo not configured → 503 with a clear message so the UI can hide
      the live-rate button.
"""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from core import logger
from maker_auth import current_maker_slug
import shippo_service

router = APIRouter()

# Six preset IDs, mirrored from frontend `SHIPPING_PRESETS` in
# /app/frontend/src/pages/MakerListingEditor/constants.js. Keep in sync.
_PRESETS = {
    "envelope":   {"length": 9.5,  "width": 6,    "height": 0.25, "weight": 0.25},  # 4 oz
    "small_box":  {"length": 8.625,"width": 5.375,"height": 1.625,"weight": 0.75},  # 12 oz
    "medium_box": {"length": 11,   "width": 8.5,  "height": 5.5,  "weight": 2.0},
    "large_box":  {"length": 12,   "width": 12,   "height": 5.5,  "weight": 5.0},
    "ups_ground": {"length": 24,   "width": 18,   "height": 12,   "weight": 12.0},
    "freight":    {"length": 48,   "width": 30,   "height": 24,   "weight": 75.0},
}

# Platform demo ship-from (Austin, TX) — used when the maker hasn't saved
# their own ship-from address yet so they can still get a directional
# rate quote. Marked clearly in the response so the UI can prompt them
# to save their real address for accurate numbers.
_DEMO_SHIP_FROM = {
    "name": "Crafters Market Workshop",
    "company": "Crafters Market",
    "street1": "1100 Congress Ave",
    "street2": "",
    "city": "Austin",
    "state": "TX",
    "zip": "78701",
    "country": "US",
    "phone": "",
    "email": "",
}

# Mid-US default destination (Kansas City, MO) — roughly equidistant from
# both coasts so the quoted rate represents a sensible average. Picked
# this ZIP because Shippo's test fixtures use it heavily and it has
# strong USPS + UPS service coverage.
_DEFAULT_TO_ADDR = {
    "name": "Sample Buyer",
    "company": "",
    "street1": "30 W Pershing Rd",
    "street2": "",
    "city": "Kansas City",
    "state": "MO",
    "zip": "64101",
    "country": "US",
    "phone": "",
    "email": "",
}


class PresetRatesReq(BaseModel):
    model_config = ConfigDict(extra="ignore")
    preset_id: str = Field(..., description="One of: envelope, small_box, medium_box, large_box, ups_ground, freight")
    to_zip: str | None = Field(None, description="Optional 5-digit US ZIP; falls back to 64101")


@router.post("/maker/shipping/preset-rates")
async def preset_rates(body: PresetRatesReq, slug: str = Depends(current_maker_slug)):
    if not shippo_service.is_configured():
        raise HTTPException(503, "Shippo isn't configured on this deployment.")
    preset = _PRESETS.get(body.preset_id)
    if not preset:
        raise HTTPException(400, f"Unknown preset_id '{body.preset_id}'.")

    # Resolve ship-from: maker's saved address, else demo. Track whether
    # we used the fallback so the UI can show a "save your address for
    # accurate rates" nudge.
    from core import db
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0}) or {}
    saved = (maker.get("ship_from_address") or {})
    using_demo_from = not (saved.get("zip") and saved.get("state"))
    from_addr = {
        "name": saved.get("name") or maker.get("name") or _DEMO_SHIP_FROM["name"],
        "company": saved.get("company") or "",
        "street1": saved.get("street1") or _DEMO_SHIP_FROM["street1"],
        "street2": saved.get("street2") or "",
        "city": saved.get("city") or _DEMO_SHIP_FROM["city"],
        "state": saved.get("state") or _DEMO_SHIP_FROM["state"],
        "zip": saved.get("zip") or _DEMO_SHIP_FROM["zip"],
        "country": saved.get("country") or "US",
        "phone": "",
        "email": "",
    }

    # Resolve ship-to: caller's zip if provided, else mid-US default.
    to_addr = dict(_DEFAULT_TO_ADDR)
    cleaned_zip = (body.to_zip or "").strip()
    if cleaned_zip and cleaned_zip.isdigit() and len(cleaned_zip) == 5:
        to_addr["zip"] = cleaned_zip
        # Strip city/state for non-default zips — Shippo validates from zip alone.
        to_addr["city"] = ""
        to_addr["state"] = ""

    try:
        result = shippo_service.get_rates(
            from_addr=from_addr,
            to_addr=to_addr,
            parcel=preset,
        )
    except shippo_service.ShippoError as e:
        logger.warning("[preset-rates] shippo error maker=%s preset=%s: %s", slug, body.preset_id, e)
        raise HTTPException(400, str(e))

    rates = (result.get("rates") or [])[:5]  # top 5 cheapest
    return {
        "preset_id": body.preset_id,
        "rates": rates,
        "using_demo_from": using_demo_from,
        "test_mode": shippo_service.is_test_key(),
        "to_zip": to_addr["zip"],
        "messages": result.get("messages") or [],
    }
