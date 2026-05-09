"""On-demand 1080×1920 (9:16) Instagram/TikTok Story template generator.

Composites the product hero image, maker name, price, and a deep-link
QR code into a single PNG that a maker can download with one click and
post directly. Pairs with the Meta/Pinterest catalog feeds — those
power tagged-product overlays in feed posts; this powers the more
viral Story / Reel format.

Why server-side and not client-side?
  - We already have Pillow + R2 fetching wired for other image flows.
  - QR codes require a stable production URL we know on the server.
  - Lets us fingerprint + cache aggressively at the CDN edge (1 hour).
  - Keeps the maker dashboard zero-asset-pipeline-dependency.
"""
from __future__ import annotations

import io
import os
from typing import Optional

import httpx
import qrcode
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from PIL import Image, ImageDraw, ImageFont

from core import db


router = APIRouter()

WIDTH, HEIGHT = 1080, 1920
SITE_URL = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")

BG = (10, 10, 10)         # near-black
FG = (255, 255, 255)
ACCENT = (255, 69, 0)     # Crafters Market orange
MUTED = (163, 163, 163)


def _font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    """Pick the system font that's actually present in this container.
    Falls back to PIL's default bitmap font if nothing else loads."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


async def _fetch_image(url: str) -> Optional[Image.Image]:
    """Fetch a hero image. Handles three URL shapes the catalog produces:
    fully-qualified R2/CDN URLs, protocol-relative `//cdn/...`, and
    site-relative `/seed-images/...` paths (resolved against SITE_URL).
    """
    if not url:
        return None
    if url.startswith("//"):
        url = "https:" + url
    elif url.startswith("/"):
        url = SITE_URL + url
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as c:
            r = await c.get(url)
            r.raise_for_status()
            return Image.open(io.BytesIO(r.content)).convert("RGB")
    except Exception:
        return None


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font, max_w: int) -> list[str]:
    """Greedy word-wrap to a pixel width using the given font."""
    words = (text or "").split()
    lines: list[str] = []
    cur = ""
    for w in words:
        candidate = (cur + " " + w).strip()
        if draw.textlength(candidate, font=font) <= max_w:
            cur = candidate
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:3]  # never more than 3 lines on a story


def _compose(product: dict, maker: dict, hero_img: Optional[Image.Image]) -> Image.Image:
    """Build the actual 1080×1920 composition."""
    canvas = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(canvas)

    # Hero image: cover-fit into a top 1080×1080 square, leaving the
    # bottom 840px for the brand band + CTA.
    if hero_img:
        src_w, src_h = hero_img.size
        scale = max(WIDTH / src_w, WIDTH / src_h)
        new_w = int(src_w * scale)
        new_h = int(src_h * scale)
        hero = hero_img.resize((new_w, new_h), Image.LANCZOS)
        # Center-crop to 1080×1080
        left = max(0, (new_w - WIDTH) // 2)
        top = max(0, (new_h - WIDTH) // 2)
        hero = hero.crop((left, top, left + WIDTH, top + WIDTH))
        canvas.paste(hero, (0, 0))
    else:
        # Subtle gradient placeholder so the composition still ships
        for y in range(WIDTH):
            t = y / WIDTH
            r = int(20 + t * 30)
            canvas.paste((r, r, r), (0, y, WIDTH, y + 1))

    # Top-right Crafters Market wordmark pill
    pill_text = "CRAFTERSMARKET.ORG"
    pill_font = _font(28, bold=True)
    pill_w = int(draw.textlength(pill_text, font=pill_font)) + 36
    pill_h = 56
    pill_x = WIDTH - pill_w - 40
    pill_y = 40
    draw.rectangle(
        [pill_x, pill_y, pill_x + pill_w, pill_y + pill_h],
        fill=(0, 0, 0, 180),
    )
    draw.rectangle(
        [pill_x, pill_y, pill_x + 6, pill_y + pill_h],
        fill=ACCENT,
    )
    draw.text((pill_x + 18, pill_y + 11), pill_text, font=pill_font, fill=FG)

    # Bottom band starts at y=1080 — tall enough for headline + CTA + QR.
    # Spans `band_top → HEIGHT` (840px) which is what the rectangle below uses.
    band_top = WIDTH  # 1080
    draw.rectangle([0, band_top, WIDTH, HEIGHT], fill=(13, 13, 13))
    draw.rectangle([0, band_top, WIDTH, band_top + 6], fill=ACCENT)

    # Eyebrow: maker name
    eyebrow = (maker.get("name") or maker.get("slug") or "Crafters Market").upper()
    eyebrow_font = _font(28, bold=True)
    draw.text((60, band_top + 60), f"◆ {eyebrow[:30]}", font=eyebrow_font, fill=ACCENT)

    # Headline: product title (wraps up to 3 lines)
    title_font = _font(72, bold=True)
    title_lines = _wrap_text(draw, product.get("title") or "", title_font, max_w=920)
    y = band_top + 120
    for line in title_lines:
        draw.text((60, y), line, font=title_font, fill=FG)
        y += 84

    # Price
    price = product.get("price")
    if price is not None:
        price_font = _font(60, bold=True)
        draw.text((60, y + 16), f"${float(price):.0f}", font=price_font, fill=ACCENT)

    # CTA + QR — bottom-right corner
    qr_size = 280
    qr_x = WIDTH - qr_size - 60
    qr_y = HEIGHT - qr_size - 80
    qr_url = f"{SITE_URL}/products/{product['slug']}?utm_source=story&utm_medium=qr"
    qr = qrcode.QRCode(box_size=10, border=1)
    qr.add_data(qr_url)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="white", back_color=(13, 13, 13)).convert("RGB")
    qr_img = qr_img.resize((qr_size, qr_size), Image.NEAREST)
    canvas.paste(qr_img, (qr_x, qr_y))

    # CTA copy left of QR
    cta_font = _font(36, bold=True)
    cta_sub_font = _font(24)
    draw.text((60, qr_y + 30), "TAP TO SHOP", font=cta_font, fill=FG)
    draw.text((60, qr_y + 80),
              "Scan with your camera", font=cta_sub_font, fill=MUTED)
    draw.text((60, qr_y + 116),
              "or visit craftersmarket.org", font=cta_sub_font, fill=MUTED)

    return canvas


@router.get("/products/{slug}/story-card.png")
async def product_story_card(slug: str):
    """Render and return the 1080×1920 PNG for a published listing.

    Public endpoint — anyone can download a Story card for any
    published listing. That's intentional: tagging products in social
    posts is the whole point. Cache 1h at the edge.
    """
    p = await db.products.find_one(
        {"slug": slug, "status": "published", "deleted_at": None},
        {"_id": 0},
    )
    if not p:
        raise HTTPException(404, "Product not found or not published.")
    maker = await db.makers.find_one(
        {"slug": p.get("maker_slug")}, {"_id": 0, "name": 1, "slug": 1},
    ) or {}

    hero_url = (p.get("images") or [None])[0]
    hero_img = await _fetch_image(hero_url) if hero_url else None
    canvas = _compose(p, maker, hero_img)

    buf = io.BytesIO()
    canvas.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="image/png",
        headers={
            "Content-Disposition": f'attachment; filename="{slug}-story.png"',
            "Cache-Control": "public, max-age=3600",
        },
    )
