"""iter319c — Auto-thumbnail generator for design files.

Renders a PNG preview for any design file that has a downloadable
primary URL but no `thumbnail_url`. Supports:

    SVG   — CairoSVG direct render (lossless vector → PNG)
    DXF   — ezdxf MatplotlibBackend → PNG
    STL   — existing `stl_renderer.render_stl_to_png` (3D mesh → PNG)
    Raster (JPG/PNG/WebP) — Pillow resize-and-pad to 800x800 canvas

Failure modes are non-fatal: the renderer returns None and the caller
logs + skips. Bulk endpoint walks all thumbnailless rows in one pass
and writes results back to `db.design_files`.

Storage uses the existing `r2_storage.upload_design_file_bytes` helper
so generated thumbnails live alongside the source assets in R2.
"""
from __future__ import annotations

import io
import logging
from typing import Optional

import httpx

logger = logging.getLogger("crafters.auto_thumbnail")

# Output canvas — 800x800 is the Pinterest catalog minimum (≥600x600)
# with headroom. PNG is preferred for vector renders; raster passthrough
# preserves the source format where possible.
CANVAS_SIZE = (800, 800)
HTTP_TIMEOUT = 30.0


# ──────────────────────────────────────────────────────────────────
# Per-format renderers
# ──────────────────────────────────────────────────────────────────

def _render_svg(svg_bytes: bytes) -> Optional[bytes]:
    """Vector SVG → PNG via CairoSVG."""
    try:
        import cairosvg
        return cairosvg.svg2png(
            bytestring=svg_bytes,
            output_width=CANVAS_SIZE[0],
            output_height=CANVAS_SIZE[1],
            background_color="#ffffff",
        )
    except Exception as e:
        logger.warning("[auto_thumb] SVG render failed: %s", e)
        return None


def _render_dxf(dxf_bytes: bytes) -> Optional[bytes]:
    """DXF → PNG via ezdxf's matplotlib backend.

    ezdxf doesn't accept bytes directly — we round-trip through a
    `io.BytesIO` text stream. The matplotlib backend produces a clean
    line drawing that works for laser/plasma cut-files.
    """
    try:
        import ezdxf
        from ezdxf.addons.drawing import RenderContext, Frontend
        from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
        import matplotlib
        matplotlib.use("Agg")  # headless
        import matplotlib.pyplot as plt

        # ezdxf.readzip / readfile both need a path or text stream
        text = dxf_bytes.decode("utf-8", errors="ignore")
        doc = ezdxf.read(io.StringIO(text))
        msp = doc.modelspace()
        fig = plt.figure(figsize=(8, 8), dpi=100)
        ax = fig.add_axes([0, 0, 1, 1])  # full-bleed
        ax.set_axis_off()
        ctx = RenderContext(doc)
        out = MatplotlibBackend(ax)
        Frontend(ctx, out).draw_layout(msp, finalize=True)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", facecolor="white",
                    bbox_inches="tight", pad_inches=0.05)
        plt.close(fig)
        return buf.getvalue()
    except Exception as e:
        logger.warning("[auto_thumb] DXF render failed: %s", e)
        return None


def _render_stl(stl_bytes: bytes) -> Optional[bytes]:
    """3D STL mesh → PNG via the existing stl_renderer module."""
    try:
        from stl_renderer import render_stl_to_png
        return render_stl_to_png(stl_bytes)
    except Exception as e:
        logger.warning("[auto_thumb] STL render failed: %s", e)
        return None


def _render_raster(src_bytes: bytes, fmt: str) -> Optional[bytes]:
    """JPG/PNG/WebP → PNG resized + padded to CANVAS_SIZE."""
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(src_bytes))
        im.thumbnail(CANVAS_SIZE, Image.LANCZOS)
        # Pad onto a white square canvas (Pinterest/Meta prefer square).
        canvas = Image.new("RGB", CANVAS_SIZE, (255, 255, 255))
        x = (CANVAS_SIZE[0] - im.width) // 2
        y = (CANVAS_SIZE[1] - im.height) // 2
        if im.mode in ("RGBA", "LA"):
            canvas.paste(im, (x, y), im)
        else:
            canvas.paste(im.convert("RGB"), (x, y))
        out = io.BytesIO()
        canvas.save(out, format="PNG", optimize=True)
        return out.getvalue()
    except Exception as e:
        logger.warning("[auto_thumb] raster (%s) render failed: %s", fmt, e)
        return None


# ──────────────────────────────────────────────────────────────────
# Dispatcher
# ──────────────────────────────────────────────────────────────────

_RASTER_FORMATS = {"JPG", "JPEG", "PNG", "WEBP"}
_VECTOR_FORMATS = {"SVG", "DXF", "STL"}


async def _fetch(url: str) -> Optional[bytes]:
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as cli:
            r = await cli.get(url)
            r.raise_for_status()
            return r.content
    except Exception as e:
        logger.warning("[auto_thumb] fetch %s failed: %s", url, e)
        return None


def _pick_renderable_source(doc: dict) -> Optional[tuple[str, str]]:
    """Returns (format, url) of the renderable source — prefers SVG/DXF/STL
    (high-quality vector) over raster, falls back to first available."""
    primary_fmt = (doc.get("file_type") or "").upper()
    primary_url = doc.get("primary_url") or doc.get("download_url")
    variants = doc.get("variants") or []
    sources: list[tuple[str, str]] = []
    if primary_fmt and primary_url:
        sources.append((primary_fmt, primary_url))
    for v in variants:
        f = (v.get("format") or "").upper()
        u = v.get("url")
        if f and u:
            sources.append((f, u))
    # Prefer vector formats first (better quality output).
    for f, u in sources:
        if f in _VECTOR_FORMATS:
            return (f, u)
    for f, u in sources:
        if f in _RASTER_FORMATS:
            return (f, u)
    return sources[0] if sources else None


async def generate_thumbnail_for_doc(doc: dict) -> Optional[bytes]:
    """Returns PNG bytes for the design file, or None if no source is
    renderable. Doesn't touch the DB — caller decides where to store."""
    source = _pick_renderable_source(doc)
    if not source:
        return None
    fmt, url = source
    raw = await _fetch(url)
    if not raw:
        return None
    if fmt == "SVG":
        return _render_svg(raw)
    if fmt == "DXF":
        return _render_dxf(raw)
    if fmt == "STL":
        return _render_stl(raw)
    if fmt in _RASTER_FORMATS:
        return _render_raster(raw, fmt)
    logger.info("[auto_thumb] no renderer for format %r", fmt)
    return None


async def generate_and_store_thumbnail(doc: dict) -> Optional[str]:
    """Render + upload to R2 + return the resulting URL. Doesn't mutate
    the DB — caller is responsible for the update_one."""
    png = await generate_thumbnail_for_doc(doc)
    if not png:
        return None
    from r2_storage import upload_design_file_bytes
    uploader_label = doc.get("maker_slug") or doc.get("uploader_id") or "auto"
    try:
        url, _ext = upload_design_file_bytes(
            png,
            key_prefix=f"community-files/{uploader_label}",
            filename=f"{doc.get('id')}-auto-thumbnail.png",
            content_type="image/png",
        )
        return url
    except Exception as e:
        logger.warning("[auto_thumb] R2 upload failed for %s: %s",
                       doc.get("id"), e)
        return None
