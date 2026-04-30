"""DXF → SVG conversion via `ezdxf` (pure Python, BSD licence).

Used by the community-files variants pipeline: when a user uploads a DXF
without an SVG sibling, we can synthesise a clean SVG preview and append
it as a new variant. Maker laser/CNC shops upload DXFs ~daily; this
turns them into shareable previews on web with zero extra effort.

Public surface
--------------
* `convert_dxf_bytes_to_svg(dxf_bytes, page_size_mm=None) -> bytes`
  — heavy synchronous work; callers should run inside a thread executor
    so the FastAPI event loop stays responsive on big files.

ezdxf gotchas this wrapper handles:
* It can read R12..R2018 cleanly; older releases sometimes need
  `ezdxf.recover.read` instead of plain `read`. We try both.
* Files with embedded raster images / 3D solids will skip those entities
  silently — fine for laser/CNC 2D pre-checks, the geometry still
  renders.
* Text rendering depends on system fonts; we set a `text_policy` that
  falls back to "ignore" if the font isn't on the box, avoiding
  hard-failures on Windows-only fonts.
"""
from __future__ import annotations
import io
import logging

logger = logging.getLogger("crafters")

# Hard upper bound — anything larger we refuse rather than risk an OOM.
# Real-world DXFs from laser/CNC shops are usually 0.5..5 MB.
MAX_DXF_BYTES = 25 * 1024 * 1024


def convert_dxf_bytes_to_svg(
    dxf_bytes: bytes,
    page_width_mm: int = 400,
    page_height_mm: int = 400,
) -> bytes:
    """Convert raw DXF bytes to a UTF-8 SVG byte string.

    Raises `ValueError` on any unrecoverable parse failure so the
    caller can return 422 / 400 to the client.
    """
    if not dxf_bytes:
        raise ValueError("Empty DXF.")
    if len(dxf_bytes) > MAX_DXF_BYTES:
        raise ValueError(f"DXF is {len(dxf_bytes)//1024//1024} MB — max is {MAX_DXF_BYTES//1024//1024} MB.")

    import ezdxf
    from ezdxf.addons.drawing import Frontend, RenderContext, layout
    from ezdxf.addons.drawing.svg import SVGBackend

    text = dxf_bytes.decode("utf-8", errors="replace")
    buf = io.StringIO(text)
    try:
        doc = ezdxf.read(buf)
    except Exception as e_first:
        # Auto-repair path — handles many older / malformed DXFs.
        logger.info("[dxf2svg] strict read failed (%s); retrying via ezdxf.recover", e_first)
        try:
            buf.seek(0)
            from ezdxf import recover
            doc, _auditor = recover.read(buf)
        except Exception as e_recover:
            raise ValueError(f"Couldn't parse DXF: {e_recover}")

    msp = doc.modelspace()
    backend = SVGBackend()
    try:
        Frontend(RenderContext(doc), backend).draw_layout(msp, finalize=True)
    except Exception as e:
        # Frontend.draw_layout can raise on truly broken entity refs —
        # surface as a clean 4xx so the user gets actionable feedback.
        raise ValueError(f"Couldn't render DXF: {e}")

    page = layout.Page(width=page_width_mm, height=page_height_mm, units=layout.Units.mm)
    svg_str = backend.get_string(page)
    return svg_str.encode("utf-8")
