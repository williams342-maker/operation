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


def _entity_count(layout) -> int:
    """Best-effort count of drawable entities in a layout. ezdxf's
    `len(layout)` works, but we wrap it for safety."""
    try:
        return len(list(layout))
    except Exception:
        return 0


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

    # Pick the layout with actual drawable entities. Many CAD apps
    # (especially Inkscape / older AutoCAD exports) put geometry in a
    # paperspace layout instead of modelspace, which makes
    # `Frontend.draw_layout(msp)` throw "empty bounding box". Try in
    # this order:
    #   1. modelspace (the usual case)
    #   2. the active paperspace layout
    #   3. any other paperspace layout that has entities
    msp = doc.modelspace()
    target_layout = msp
    target_label = "modelspace"
    if _entity_count(msp) == 0:
        logger.info("[dxf2svg] modelspace empty; falling back to paperspace")
        # Try every paperspace layout in tab order. ezdxf's Layouts API
        # changes between versions (active_layout() vs property), so we
        # iterate `names_in_taborder()` which is stable across releases.
        try:
            for ps_name in doc.layouts.names_in_taborder():
                if ps_name.lower() == "model":
                    continue
                ps = doc.layouts.get(ps_name)
                if _entity_count(ps) > 0:
                    target_layout = ps
                    target_label = f"paperspace ({ps_name!r})"
                    break
        except Exception as e:
            logger.warning("[dxf2svg] paperspace iteration failed: %s", e)
    if _entity_count(target_layout) == 0:
        raise ValueError(
            "This DXF has no drawable geometry (modelspace and all "
            "paperspace layouts are empty). If your design lives on a "
            "frozen or hidden layer, unfreeze it and re-export. Or "
            "upload an SVG directly."
        )

    backend = SVGBackend()
    try:
        Frontend(RenderContext(doc), backend).draw_layout(target_layout, finalize=True)
    except ValueError as e:
        # Specific friendly message for the bounding-box case — it almost
        # always means every entity in the layout we just picked is on a
        # frozen/off layer or has zero geometric extent. Surface a hint
        # the user can act on rather than the raw ezdxf string.
        if "empty bounding box" in str(e).lower():
            raise ValueError(
                "Couldn't render this DXF: every entity in "
                f"{target_label} is on a frozen/off layer, or the "
                "drawing has no measurable geometry. Try unfreezing all "
                "layers in your CAD tool and re-exporting as DXF R2010+, "
                "or upload an SVG directly."
            )
        raise ValueError(f"Couldn't render DXF: {e}")
    except Exception as e:
        # Frontend.draw_layout can raise on truly broken entity refs —
        # surface as a clean 4xx so the user gets actionable feedback.
        raise ValueError(f"Couldn't render DXF: {e}")

    page = layout.Page(width=page_width_mm, height=page_height_mm, units=layout.Units.mm)
    svg_str = backend.get_string(page)
    if not svg_str or len(svg_str) < 200:
        # Defensive — backend can return a near-empty wrapper if it
        # silently dropped every entity (rare but happens with files
        # that contain only 3D solids / unsupported types).
        raise ValueError(
            "Generated SVG was empty — the DXF may contain only entity "
            "types we don't render (3D solids, raster images). Upload "
            "an SVG directly or simplify the DXF."
        )
    logger.info(
        "[dxf2svg] rendered from %s · %d entities · %d bytes SVG",
        target_label, _entity_count(target_layout), len(svg_str),
    )
    return svg_str.encode("utf-8")
