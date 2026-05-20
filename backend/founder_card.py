"""Founder Card image generation via Gemini Nano Banana.

Renders a shareable 1080x1080 social-media card for a Founder showing
their numbered status. Used by /api/founders/card/:slug.

Generation flow:
    1. Look up the maker doc → pull name/shop_name/founder_number/status.
    2. Build a richly-styled prompt that asks Gemini to produce a square
       social card with brand colors (orange + black + cream), the
       Founder's number/name burned in, and "CraftersMarket" branding.
    3. Cache the generated PNG bytes in `db.founder_cards` keyed by slug
       so re-renders are instant and we don't burn LLM credits on every
       view.
    4. Return raw PNG bytes to the caller.

Returns None on failure — caller is expected to fall back to a static
placeholder so a transient Gemini blip doesn't break the share flow.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import uuid
from typing import Optional

logger = logging.getLogger("crafters")


async def _generate_via_gemini(prompt: str) -> Optional[bytes]:
    """Call Gemini Nano Banana and return PNG bytes, or None on failure.
    Always wrapped — never raises to callers."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.warning("[founder_card] emergentintegrations unavailable: %s", e)
        return None

    api_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not api_key:
        logger.warning("[founder_card] EMERGENT_LLM_KEY missing")
        return None

    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"founder-card-{uuid.uuid4()}",
            system_message="You are an image generator producing branded social-share cards.",
        )
        chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(
            modalities=["image", "text"],
        )
        msg = UserMessage(text=prompt)
        _, images = await chat.send_message_multimodal_response(msg)
        if not images:
            return None
        # send_message_multimodal_response returns list of {data, mime_type}
        return base64.b64decode(images[0]["data"])
    except Exception as e:
        logger.warning("[founder_card] gemini call failed: %s", e)
        return None


def _build_prompt(maker: dict) -> str:
    number = int(maker.get("founder_number") or 0)
    inaugural = maker.get("founder_status") == "inaugural"
    status_label = "Inaugural Founding Maker" if inaugural else "Founding Maker"
    name = (maker.get("shop_name") or maker.get("name") or "Founder").strip()
    # Build a tight, art-directed prompt. The model behaves best when we
    # describe color palette, layout, and text content explicitly rather
    # than asking it to be creative.
    return (
        "Create a 1080x1080 square social media card with this exact composition:\n"
        "BACKGROUND: solid near-black (#0a0a0a) with a very subtle warm grain noise overlay.\n"
        "FOREGROUND ELEMENTS:\n"
        f"  - Top-left: a bold orange (#ff4500) diamond character followed by tracked-out "
        f"uppercase 'CRAFTERS MARKET' in monospace, 12pt size, letter-spacing 0.3em.\n"
        f"  - Center vertical: the text '#{number:03d}' rendered very large (about 280pt) "
        f"in a chunky condensed display sans-serif (Impact / Bebas Neue family), "
        f"color cream (#fafafa).\n"
        f"  - Just above the big number, the label '{status_label.upper()}' in uppercase "
        f"orange (#ff4500) monospace, 14pt, letter-spacing 0.4em.\n"
        f"  - Below the big number, the maker's name '{name}' in serif italic, cream (#fafafa), "
        f"24pt.\n"
        f"  - Bottom-left footer: orange diamond + 'CRAFTERSMARKET.ORG/FOUNDERS' in mono.\n"
        "STYLE: high contrast editorial poster, evokes vintage workshop signage. Sharp, "
        "no gradients, no glow effects. Premium minimal aesthetic. PNG quality."
    )


async def get_or_render_founder_card(slug: str) -> Optional[bytes]:
    """Returns cached card bytes or generates fresh ones. Cache is keyed
    on (slug, founder_number) so a re-promote (different number) busts
    the cache automatically."""
    from core import db

    maker = await db.makers.find_one(
        {"slug": slug, "tier": "founder"},
        {"_id": 0, "name": 1, "shop_name": 1, "founder_number": 1,
         "founder_status": 1},
    )
    if not maker:
        return None

    number = int(maker.get("founder_number") or 0)
    cache = await db.founder_cards.find_one({"slug": slug, "number": number})
    if cache and cache.get("png_b64"):
        return base64.b64decode(cache["png_b64"])

    png = await _generate_via_gemini(_build_prompt(maker))
    if not png:
        return None

    # Persist for future requests. Storing as base64 inside Mongo so we
    # don't bring R2 into a low-traffic feature; cards are ~50-150KB so
    # well below the 16MB document cap with many orders of magnitude to
    # spare.
    try:
        await db.founder_cards.update_one(
            {"slug": slug},
            {"$set": {
                "slug": slug, "number": number,
                "png_b64": base64.b64encode(png).decode("utf-8"),
            }},
            upsert=True,
        )
    except Exception as e:
        logger.warning("[founder_card] cache write failed: %s", e)
    return png
