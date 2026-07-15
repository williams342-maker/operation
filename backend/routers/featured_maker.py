from config import env_get
"""iter455 — Featured Maker Promotion Engine.

Auto-suggest → admin confirms. Weighted Featured Score over the last 30
days, Nano Banana promo assets (square + landscape, maker's product as
focal point), AI captions/hashtags/alt-text, an API-agnostic Marketing
Center queue (manual posting today, publish-API later — only the
publishing method changes), maker congratulations email + dashboard kit,
and site-wide spotlight (homepage, storefront ribbon, makers directory).

Collections:
  featured_promotions: {id, maker_slug, status draft|ready|posted|archived,
    theme, assets{square_url,landscape_url,alt_text}, captions{...},
    score, reasons[], activated, starts_at, ends_at, platforms[],
    performance{}, created_at}
  featured_current: singleton {maker_slug, promotion_id, starts_at, ends_at}
"""
import asyncio
import base64
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_admin, current_maker_slug

router = APIRouter()

FEATURE_DAYS_DEFAULT = 7


# ── Featured Score (auto-suggest) ────────────────────────────────────────────

async def _candidates(limit: int = 15) -> list:
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    makers = await db.makers.find(
        {}, {"_id": 0, "slug": 1, "name": 1, "created_at": 1,
             "featured_count": 1, "last_featured_at": 1}).to_list(500)

    revenue, orders = {}, {}
    async for tx in db.transactions.find(
            {"payment_status": "paid", "created_at": {"$gte": since}},
            {"_id": 0, "items": 1}):
        seen = set()
        for li in tx.get("items") or []:
            m = li.get("maker_slug")
            if not m:
                continue
            revenue[m] = revenue.get(m, 0) + float(li.get("price") or 0) * max(1, int(li.get("quantity") or 1))
            if m not in seen:
                orders[m] = orders.get(m, 0) + 1
                seen.add(m)

    views, visitors = {}, {}
    async for g in db.store_events.aggregate([
            {"$match": {"at": {"$gte": since}, "type": "store_view"}},
            {"$group": {"_id": "$maker_slug", "n": {"$sum": 1},
                        "s": {"$addToSet": "$session_id"}}}]):
        views[g["_id"]] = g["n"]
        visitors[g["_id"]] = len(g["s"])

    new_listings = {}
    async for g in db.products.aggregate([
            {"$match": {"status": "published", "created_at": {"$gte": since}}},
            {"$group": {"_id": "$maker_slug", "n": {"$sum": 1}}}]):
        new_listings[g["_id"]] = g["n"]

    ratings = {}
    async for g in db.reviews.aggregate([
            {"$group": {"_id": "$maker_slug", "avg": {"$avg": "$rating"},
                        "n": {"$sum": 1}}}]):
        if g["_id"]:
            ratings[g["_id"]] = (round(g.get("avg") or 0, 2), g["n"])

    max_rev = max(revenue.values(), default=1) or 1
    max_views = max(views.values(), default=1) or 1
    max_new = max(new_listings.values(), default=1) or 1
    now = datetime.now(timezone.utc)

    rows = []
    for m in makers:
        slug = m["slug"]
        rev = revenue.get(slug, 0)
        v = views.get(slug, 0)
        conv = (orders.get(slug, 0) / visitors[slug] * 100) if visitors.get(slug) else 0
        nl = new_listings.get(slug, 0)
        rating, rating_n = ratings.get(slug, (0, 0))
        is_new = (m.get("created_at") or "") >= (now - timedelta(days=60)).isoformat()
        # Weights: sales 30 · visits 20 · conversion 15 · new listings 10 ·
        # reviews 10 · new-seller bonus 5 (response/community metrics land
        # here when those signals exist — weights renormalized to 90+10).
        score = (
            30 * (rev / max_rev)
            + 20 * (v / max_views)
            + 15 * min(conv / 10, 1)
            + 10 * (nl / max_new)
            + 10 * (rating / 5 if rating_n else 0)
            + (5 if is_new else 0)
        ) / 90 * 100
        last_f = m.get("last_featured_at")
        days_since = None
        if last_f:
            days_since = (now - datetime.fromisoformat(last_f)).days
            if days_since < 60:
                score *= 0.4  # recently featured → strong cooldown
        reasons = []
        if rev:
            reasons.append(f"${rev:,.0f} revenue in the last 30 days")
        if conv >= 3:
            reasons.append(f"{conv:.1f}% visitor→order conversion")
        if nl:
            reasons.append(f"{nl} new listing{'s' if nl != 1 else ''} this month")
        if rating >= 4.5 and rating_n:
            reasons.append(f"{rating}★ average across {rating_n} reviews")
        if is_new:
            reasons.append("New seller — founding-maker boost")
        rows.append({
            "maker_slug": slug, "name": m.get("name") or slug,
            "featured_score": round(score, 1),
            "revenue_30d": round(rev, 2), "store_views": v,
            "conversion_rate": round(conv, 2), "new_listings": nl,
            "avg_rating": rating, "review_count": rating_n,
            "featured_count": m.get("featured_count") or 0,
            "days_since_featured": days_since,
            "reasons": reasons or ["Steady presence on the marketplace"],
        })
    rows.sort(key=lambda x: -x["featured_score"])
    return rows[:limit]


@router.get("/admin/featured/candidates")
async def featured_candidates(_: dict = Depends(current_admin)):
    current = await db.featured_current.find_one({}, {"_id": 0})
    if current and current.get("ends_at", "") < now_iso():
        current = None
    return {"current": current, "candidates": await _candidates()}


# ── Asset + caption generation ────────────────────────────────────────────────

THEME_BACKDROPS = {
    "spotlight": "a premium studio spotlight scene with subtle dark backdrop and a small 'Featured Maker' ribbon motif",
    "christmas": "a warm wood tabletop with evergreen branches and soft string lights",
    "halloween": "rustic dark wood with small pumpkins and autumn leaves",
    "spring": "bright, airy scene with soft floral accents",
    "patriotic": "a tasteful red, white and blue Americana theme",
    "fathers-day": "a clean workshop / garage aesthetic with tools softly out of focus",
}


async def _gen_promo_image(product_img_b64: Optional[str], prompt: str, session: str) -> Optional[bytes]:
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    chat = LlmChat(api_key=env_get("EMERGENT_LLM_KEY"),
                   session_id=session, system_message="You are a professional marketing designer.")
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(
        modalities=["image", "text"])
    msg = UserMessage(text=prompt,
                      file_contents=[ImageContent(product_img_b64)] if product_img_b64 else None)
    _, images = await chat.send_message_multimodal_response(msg)
    if images:
        return base64.b64decode(images[0]["data"])
    return None


async def _gen_captions(maker: dict, product: dict, theme: str) -> dict:
    import json as _json
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = LlmChat(
        api_key=env_get("EMERGENT_LLM_KEY"),
        session_id=f"fm-cap-{uuid.uuid4().hex[:8]}",
        system_message=(
            "You write social media copy for a handmade-goods marketplace "
            "(Crafters Market — American makers). Respond with ONLY valid JSON, "
            "no markdown fences.")).with_model("anthropic", "claude-sonnet-4-5-20250929")
    reply = await chat.send_message(UserMessage(text=(
        f"Featured maker: {maker.get('name')} ({maker.get('slug')}). "
        f"Featured product: {product.get('title')} — ${product.get('price')}. "
        f"Theme: {theme}. Store: https://craftersmarket.org/makers/{maker.get('slug')}\n"
        'Return JSON: {"headline": str (<=60 chars), "description": str (<=160 chars), '
        '"alt_text": str, "cta": str, "hashtags": [8-10 strings with #], '
        '"captions": {"instagram": str, "facebook": str, "x": str (<=270 chars)}}')))
    txt = str(reply).strip()
    if txt.startswith("```"):
        txt = txt.strip("`").replace("json\n", "", 1)
    return _json.loads(txt)


async def _generate_all(maker: dict, product: dict, theme: str) -> tuple:
    """Generate square + landscape promo images and captions; upload to R2."""
    img_b64 = None
    img_url = (product.get("images") or [None])[0]
    if img_url and img_url.startswith("/"):
        img_url = env_get("PUBLIC_SITE_URL", "").rstrip("/") + img_url
    if img_url:
        try:
            async with httpx.AsyncClient(timeout=30) as hc:
                r = await hc.get(img_url)
                if r.status_code == 200:
                    img_b64 = base64.b64encode(r.content).decode()
        except Exception as e:
            logger.warning("[featured] reference image fetch failed: %s", e)

    backdrop = THEME_BACKDROPS.get(theme, THEME_BACKDROPS["spotlight"])
    base_prompt = (
        f"Create a polished square 1080x1080 social media promotional graphic. "
        f"Keep the handmade product from the reference image UNCHANGED as the focal point, "
        f"placed on {backdrop}. Add subtle, tasteful 'CRAFTERS MARKET' branding text and a "
        f"small 'Featured Maker' badge. Professional product-marketing quality, no watermarks, "
        f"no extra invented products.")
    land_prompt = base_prompt.replace("square 1080x1080", "wide landscape 1200x630 banner")

    sid = uuid.uuid4().hex[:10]
    sq, ld, caps = await asyncio.gather(
        _gen_promo_image(img_b64, base_prompt, f"fm-sq-{sid}"),
        _gen_promo_image(img_b64, land_prompt, f"fm-ld-{sid}"),
        _gen_captions(maker, product, theme),
        return_exceptions=True)
    for name, val in (("square", sq), ("landscape", ld)):
        if isinstance(val, Exception):
            logger.warning("[featured] %s image failed: %s", name, val)
    if isinstance(caps, Exception):
        logger.warning("[featured] captions failed: %s", caps)
        caps = {"headline": f"Featured Maker: {maker.get('name')}",
                "description": product.get("title"), "alt_text": product.get("title"),
                "cta": "Shop Now", "hashtags": ["#handmade", "#craftersmarket"],
                "captions": {"instagram": "", "facebook": "", "x": ""}}

    from r2_storage import is_configured as r2_ok, upload_bytes
    assets = {"square_url": None, "landscape_url": None,
              "alt_text": caps.get("alt_text")}
    if r2_ok():
        for key_name, img in (("square_url", sq), ("landscape_url", ld)):
            if isinstance(img, (bytes, bytearray)) and img:
                try:
                    assets[key_name] = upload_bytes(
                        bytes(img), f"featured-promos/{maker.get('slug')}/{uuid.uuid4().hex}.png",
                        "image/png", max_bytes=20 * 1024 * 1024)
                except Exception as e:
                    logger.warning("[featured] asset upload failed: %s", e)
    return assets, caps


class PromoCreate(BaseModel):
    maker_slug: str
    product_slug: Optional[str] = None
    theme: str = Field(default="spotlight", max_length=30)
    score: Optional[float] = None
    reasons: Optional[list] = None


@router.post("/admin/featured/promotions")
async def create_promotion(body: PromoCreate, _: dict = Depends(current_admin)):
    maker = await db.makers.find_one({"slug": body.maker_slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found.")
    pq = {"maker_slug": body.maker_slug, "status": "published"}
    if body.product_slug:
        pq["slug"] = body.product_slug
    product = await db.products.find_one(pq, {"_id": 0, "slug": 1, "title": 1,
                                              "price": 1, "images": 1})
    if not product:
        raise HTTPException(404, "No published product to feature.")

    assets, caps = await _generate_all(maker, product, body.theme)

    doc = {
        "id": str(uuid.uuid4()), "maker_slug": body.maker_slug,
        "maker_name": maker.get("name"), "product_slug": product["slug"],
        "product_title": product.get("title"), "theme": body.theme,
        "status": "ready" if (assets["square_url"] or assets["landscape_url"]) else "draft",
        "assets": assets, "captions": caps,
        "score": body.score, "reasons": body.reasons or [],
        "activated": False, "starts_at": None, "ends_at": None,
        "platforms": [], "performance": {}, "created_at": now_iso(),
    }
    await db.featured_promotions.insert_one({**doc})
    return doc


@router.get("/admin/featured/promotions")
async def list_promotions(status: str = "", _: dict = Depends(current_admin)):
    q = {"status": status} if status else {"status": {"$ne": "archived"}}
    rows = await db.featured_promotions.find(q, {"_id": 0}).sort(
        "created_at", -1).to_list(100)
    return {"promotions": rows}


class PromoUpdate(BaseModel):
    status: Optional[str] = Field(default=None, pattern="^(draft|ready|posted|archived)$")
    platforms: Optional[list] = None
    performance: Optional[dict] = None
    scheduled_for: Optional[str] = None


@router.patch("/admin/featured/promotions/{promo_id}")
async def update_promotion(promo_id: str, body: PromoUpdate,
                           _: dict = Depends(current_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if body.status == "posted":
        updates["posted_at"] = now_iso()
    if not updates:
        return {"ok": True}
    res = await db.featured_promotions.update_one({"id": promo_id}, {"$set": updates})
    if not res.matched_count:
        raise HTTPException(404, "Promotion not found.")
    return {"ok": True, "promotion": await db.featured_promotions.find_one(
        {"id": promo_id}, {"_id": 0})}


@router.post("/admin/featured/promotions/{promo_id}/regenerate")
async def regenerate_promotion(promo_id: str, _: dict = Depends(current_admin)):
    """Retry failed image/caption generation on an existing promotion."""
    promo = await db.featured_promotions.find_one({"id": promo_id}, {"_id": 0})
    if not promo:
        raise HTTPException(404, "Promotion not found.")
    maker = await db.makers.find_one({"slug": promo["maker_slug"]}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found.")
    proj = {"_id": 0, "slug": 1, "title": 1, "price": 1, "images": 1}
    product = await db.products.find_one(
        {"maker_slug": promo["maker_slug"], "slug": promo.get("product_slug"),
         "status": "published"}, proj) or await db.products.find_one(
        {"maker_slug": promo["maker_slug"], "status": "published"}, proj)
    if not product:
        raise HTTPException(404, "No published product to feature.")

    assets, caps = await _generate_all(maker, product, promo.get("theme") or "spotlight")
    prev = promo.get("assets") or {}
    merged = {
        "square_url": assets.get("square_url") or prev.get("square_url"),
        "landscape_url": assets.get("landscape_url") or prev.get("landscape_url"),
        "alt_text": assets.get("alt_text") or prev.get("alt_text"),
    }
    has_assets = bool(merged["square_url"] or merged["landscape_url"])
    updates = {
        "assets": merged, "captions": caps, "regenerated_at": now_iso(),
        "status": promo["status"] if promo.get("status") == "posted"
                  else ("ready" if has_assets else "draft"),
    }
    await db.featured_promotions.update_one({"id": promo_id}, {"$set": updates})
    return await db.featured_promotions.find_one({"id": promo_id}, {"_id": 0})


@router.post("/admin/featured/promotions/{promo_id}/activate")
async def activate_promotion(promo_id: str, days: int = FEATURE_DAYS_DEFAULT,
                             replace: bool = False,
                             _: dict = Depends(current_admin)):
    promo = await db.featured_promotions.find_one({"id": promo_id}, {"_id": 0})
    if not promo:
        raise HTTPException(404, "Promotion not found.")
    p_assets = promo.get("assets") or {}
    if not (p_assets.get("square_url") or p_assets.get("landscape_url")):
        raise HTTPException(
            409, "Asset generation failed for this promotion — retry generation before activating.")
    cur = await db.featured_current.find_one({}, {"_id": 0})
    if (cur and cur.get("ends_at", "") > now_iso()
            and cur.get("promotion_id") != promo_id and not replace):
        raise HTTPException(
            409, f"{cur['maker_slug']} is already featured through "
                 f"{cur.get('ends_at', '')[:10]}. Pass replace=true to swap it.")
    days = max(1, min(days, 30))
    starts, ends = now_iso(), (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    await db.featured_current.delete_many({})
    await db.featured_current.insert_one({
        "maker_slug": promo["maker_slug"], "promotion_id": promo_id,
        "starts_at": starts, "ends_at": ends})
    await db.featured_promotions.update_one(
        {"id": promo_id}, {"$set": {"activated": True, "starts_at": starts, "ends_at": ends}})
    await db.makers.update_one(
        {"slug": promo["maker_slug"]},
        {"$inc": {"featured_count": 1},
         "$set": {"last_featured_at": starts},
         "$push": {"featured_history": {"promotion_id": promo_id, "at": starts}}})

    maker = await db.makers.find_one({"slug": promo["maker_slug"]},
                                     {"_id": 0, "email": 1, "name": 1})
    if maker and maker.get("email") and not promo.get("congrats_email_sent"):
        try:
            from email_service import _send
            reasons_html = "".join(f"<li>{r}</li>" for r in promo.get("reasons") or [])
            await _send(
                maker["email"],
                "🏆 You're this week's Featured Maker on Crafters Market!",
                f"<h2>Congratulations, {maker.get('name')}!</h2>"
                f"<p>You've been selected as our Featured Maker through "
                f"{ends[:10]}. Your store is being spotlighted across the "
                f"homepage, the makers directory and our social channels.</p>"
                + (f"<p><b>Why you were selected:</b></p><ul>{reasons_html}</ul>" if reasons_html else "")
                + f"<p><a href='https://craftersmarket.org/makers/{promo['maker_slug']}'>View your storefront</a> · "
                f"<a href='https://craftersmarket.org/maker/dashboard'>Download your promotion kit</a></p>"
                f"<p>Share the news with your audience — your promotion kit "
                f"(ready-made images + captions) is waiting on your dashboard.</p>")
            await db.featured_promotions.update_one(
                {"id": promo_id}, {"$set": {"congrats_email_sent": True}})
        except Exception as e:
            logger.warning("[featured] congrats email failed: %s", e)
    return {"ok": True, "starts_at": starts, "ends_at": ends}


# ── Public + maker surfaces ───────────────────────────────────────────────────

@router.get("/featured-maker")
async def public_featured_maker():
    cur = await db.featured_current.find_one({}, {"_id": 0})
    if not cur or cur.get("ends_at", "") < now_iso():
        return {"featured": None}
    maker = await db.makers.find_one(
        {"slug": cur["maker_slug"]},
        {"_id": 0, "slug": 1, "name": 1, "bio": 1, "story": 1, "image": 1,
         "logo_url": 1, "hero_image": 1, "featured_count": 1})
    promo = await db.featured_promotions.find_one(
        {"id": cur["promotion_id"]}, {"_id": 0, "assets": 1, "captions": 1,
                                      "product_slug": 1})
    products = await db.products.find(
        {"maker_slug": cur["maker_slug"], "status": "published"},
        {"_id": 0, "slug": 1, "title": 1, "price": 1, "images": 1}).limit(4).to_list(4)
    return {"featured": {
        "maker": maker, "ends_at": cur["ends_at"],
        "headline": ((promo or {}).get("captions") or {}).get("headline"),
        "banner_url": ((promo or {}).get("assets") or {}).get("landscape_url"),
        "products": products}}


@router.get("/featured-makers/history")
async def featured_history():
    rows = await db.featured_promotions.find(
        {"activated": True}, {"_id": 0, "maker_slug": 1, "maker_name": 1,
                              "starts_at": 1, "ends_at": 1,
                              "assets.square_url": 1}).sort(
        "starts_at", -1).to_list(100)
    return {"history": rows}


@router.get("/maker/featured/status")
async def maker_featured_status(slug: str = Depends(current_maker_slug)):
    cur = await db.featured_current.find_one({}, {"_id": 0})
    if not cur or cur["maker_slug"] != slug or cur.get("ends_at", "") < now_iso():
        return {"featured": False}
    promo = await db.featured_promotions.find_one(
        {"id": cur["promotion_id"]}, {"_id": 0, "assets": 1, "captions": 1,
                                      "reasons": 1})
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0).isoformat()
    stats = {}
    async for g in db.store_events.aggregate([
            {"$match": {"maker_slug": slug, "at": {"$gte": cur["starts_at"]}}},
            {"$group": {"_id": "$type", "n": {"$sum": 1}}}]):
        stats[g["_id"]] = g["n"]
    views_today = await db.store_events.count_documents(
        {"maker_slug": slug, "type": "store_view", "at": {"$gte": today}})
    return {"featured": True, "ends_at": cur["ends_at"],
            "kit": promo or {},
            "stats": {"store_views_today": views_today,
                      "store_views_total": stats.get("store_view", 0),
                      "product_views": stats.get("product_click", 0),
                      "add_to_cart": stats.get("add_to_cart", 0)}}
