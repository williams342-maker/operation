"""Image watermarking helper — applies a maker-name watermark to product
photos before they're uploaded to R2.

Design choices:
  - **Destructive** at upload time: we watermark the image bytes once and
    store only the watermarked version. R2 never holds the unwatermarked
    original, which means it can't leak via a guessable URL.
  - Diagonal **repeating tiled** label across the full image, low opacity.
    Single-corner watermarks get cropped out by anyone with a pair of
    eyes; tiled watermarks force the thief to manually inpaint dozens of
    overlapping marks.
  - Plus a stronger **bottom-right corner stamp** ("◆ {SHOP NAME} ·
    crafters market") so the brand is unmistakable in the listing
    thumbnail.
  - JPEG only (re-encode at quality=88). Watermarks on PNG / WebP would
    be removable via simple alpha-channel tricks, and our listing flow
    accepts JPEG anyway. We coerce to JPEG to keep the pipeline simple.
"""
from __future__ import annotations
import io
import logging
import math
from typing import Optional

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# Pre-loaded fonts — Liberation ships in the container by default.
_FONT_PATH_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
_FONT_PATH_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"


def _font(path: str, size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype(path, size=size)
    except Exception:
        # Fallback to default bitmap font if the system font isn't where we
        # expect — keeps the watermark working everywhere even if it looks
        # less polished. Better than crashing the upload pipeline.
        return ImageFont.load_default()


def watermark_image_bytes(
    raw: bytes,
    shop_name: str,
    *,
    max_width: int = 2400,
    quality: int = 88,
) -> bytes:
    """Apply a tiled diagonal watermark + corner stamp to the image bytes.

    Args:
        raw:        original image bytes (any Pillow-supported format)
        shop_name:  maker's display name, e.g. "Iron & Oak Studio"
        max_width:  cap the long edge so we don't store 6000px originals;
                    helps preview load times AND makes any leaked image
                    less commercially valuable.

    Returns: JPEG bytes ready for R2 upload.
    """
    src = Image.open(io.BytesIO(raw))
    # Always normalise to RGB — JPEG can't store alpha and many uploads
    # come in as RGBA / palette PNGs.
    if src.mode != "RGB":
        src = src.convert("RGB")

    # Constrain long edge for both deterrence (lower-res = less useful for
    # resale) and bandwidth.
    if max(src.size) > max_width:
        scale = max_width / max(src.size)
        new_size = (int(src.size[0] * scale), int(src.size[1] * scale))
        src = src.resize(new_size, Image.Resampling.LANCZOS)

    w, h = src.size
    # Build the watermark on a separate RGBA layer so we can rotate it
    # cleanly and then alpha-composite back onto the RGB photo.
    wm = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    # 1. TILED DIAGONAL WATERMARK -------------------------------------------
    # Render the brand mark to a tile bitmap, then paste it across a
    # rotated canvas at evenly spaced intervals.
    label = f"◆ {shop_name.upper()} · CRAFTERS MARKET"
    tile_font_size = max(18, int(min(w, h) * 0.025))
    font_tile = _font(_FONT_PATH_BOLD, tile_font_size)

    # Measure the rendered text once so we can compute the tile pitch.
    measure_img = Image.new("RGBA", (10, 10))
    measure_draw = ImageDraw.Draw(measure_img)
    bbox = measure_draw.textbbox((0, 0), label, font=font_tile)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Build a layer twice as big as the photo so that, after rotation,
    # the tiled text still covers every corner.
    pad = int(math.hypot(w, h)) // 2
    canvas_w, canvas_h = w + pad * 2, h + pad * 2
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    canvas_draw = ImageDraw.Draw(canvas)

    pitch_x = text_w + tile_font_size * 4
    pitch_y = text_h + tile_font_size * 5
    # Soft white at low opacity — visible but doesn't ruin the photo.
    fill = (255, 255, 255, 64)
    for row, y in enumerate(range(0, canvas_h, pitch_y)):
        # Stagger every other row by half a pitch — looks more deliberate
        # and harder to clone-stamp out.
        x_offset = (pitch_x // 2) if (row % 2) else 0
        for x in range(-pitch_x, canvas_w, pitch_x):
            canvas_draw.text((x + x_offset, y), label, fill=fill, font=font_tile)

    # Rotate ~ -28° for the diagonal sweep, then crop back to image size.
    canvas = canvas.rotate(-28, resample=Image.Resampling.BICUBIC, expand=False)
    # Centre-crop the rotated canvas to the photo's dimensions.
    crop_x = (canvas_w - w) // 2
    crop_y = (canvas_h - h) // 2
    tiled = canvas.crop((crop_x, crop_y, crop_x + w, crop_y + h))
    wm = Image.alpha_composite(wm, tiled)

    # 2. CORNER STAMP -------------------------------------------------------
    stamp_font_size = max(20, int(min(w, h) * 0.034))
    font_stamp = _font(_FONT_PATH_BOLD, stamp_font_size)
    stamp_label = f"© {shop_name.upper()}"
    stamp_draw = ImageDraw.Draw(wm)
    sb = stamp_draw.textbbox((0, 0), stamp_label, font=font_stamp)
    sw, sh = sb[2] - sb[0], sb[3] - sb[1]
    margin = max(12, int(min(w, h) * 0.02))
    sx = w - sw - margin - 14
    sy = h - sh - margin - 14
    # Soft dark plate behind the stamp so it stays readable on light photos.
    plate_pad = 8
    stamp_draw.rectangle(
        (sx - plate_pad, sy - plate_pad, sx + sw + plate_pad, sy + sh + plate_pad),
        fill=(0, 0, 0, 120),
    )
    stamp_draw.text((sx, sy), stamp_label, fill=(255, 255, 255, 230), font=font_stamp)

    # 3. COMPOSITE + ENCODE -------------------------------------------------
    base = src.convert("RGBA")
    out = Image.alpha_composite(base, wm).convert("RGB")
    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def maybe_watermark_data_url(
    data_url: str,
    shop_name: Optional[str],
) -> Optional[tuple[bytes, str]]:
    """Decode a `data:image/...;base64,...` URL, watermark it, return
    (jpeg_bytes, "image/jpeg"). Returns None when the input isn't a base64
    image data URL (caller should fall through to the original path).
    """
    import base64
    import re
    m = re.match(r"^data:(?P<ct>image/[\w+.\-]+);base64,(?P<b64>.+)$", data_url, re.DOTALL)
    if not m:
        return None
    raw = base64.b64decode(m.group("b64"), validate=False)
    name = (shop_name or "Crafters Market").strip() or "Crafters Market"
    try:
        wm = watermark_image_bytes(raw, name)
    except Exception as e:
        logger.exception("watermark failed for shop=%s: %s", shop_name, e)
        return None
    return wm, "image/jpeg"
