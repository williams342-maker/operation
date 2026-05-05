"""iter125 — DXF→SVG converter handles paperspace-only / empty layouts.

Bug: user clicked Generate to convert a DXF→SVG and got "empty bounding
box" — raw ezdxf error surfacing because the DXF's geometry was in
paperspace, not modelspace, but `Frontend.draw_layout(msp)` was always
called against modelspace.

Fix: the converter now falls back to paperspace layouts in tab order
when modelspace is empty, and surfaces actionable error copy when
every layout is empty.
"""
import io
import sys

import pytest

sys.path.insert(0, "/app/backend")

from dxf_converter import convert_dxf_bytes_to_svg  # noqa: E402


def _build_dxf(populate):
    """Helper: spin up an ezdxf doc, run `populate(doc)`, return bytes."""
    import ezdxf
    doc = ezdxf.new("R2010")
    populate(doc)
    out = io.StringIO()
    doc.write(out)
    return out.getvalue().encode("utf-8")


def test_modelspace_geometry_renders():
    """Regression: the happy path must keep working after the
    paperspace-fallback refactor."""
    dxf = _build_dxf(lambda doc: (
        doc.modelspace().add_line((0, 0), (100, 100)),
        doc.modelspace().add_circle((50, 50), 30),
    ))
    svg = convert_dxf_bytes_to_svg(dxf)
    assert svg.startswith(b"<?xml") or svg.startswith(b"<svg")
    assert len(svg) >= 400


def test_paperspace_only_dxf_falls_back_cleanly():
    """The exact scenario the user hit: geometry lives in 'Layout1'
    paperspace, modelspace is empty. Before the fix this raised
    'empty bounding box'. Now it should render via fallback."""
    def populate(doc):
        psp = doc.layouts.get("Layout1")
        psp.add_line((0, 0), (100, 100))
        psp.add_circle((50, 50), 30)
    dxf = _build_dxf(populate)
    svg = convert_dxf_bytes_to_svg(dxf)
    assert len(svg) >= 400, "paperspace fallback returned a near-empty SVG"


def test_truly_empty_dxf_returns_friendly_error():
    """DXF with no geometry anywhere — user gets a clear, actionable
    error string they can act on, NOT a raw 'empty bounding box'."""
    dxf = _build_dxf(lambda doc: None)
    with pytest.raises(ValueError) as exc_info:
        convert_dxf_bytes_to_svg(dxf)
    msg = str(exc_info.value).lower()
    # Must be the friendly user-facing copy, not the raw ezdxf message.
    assert "empty bounding box" not in msg, "raw ezdxf message leaked to user"
    assert "no drawable" in msg or "empty" in msg
    # And it must give the user a recovery action.
    assert ("svg" in msg or "frozen" in msg or "re-export" in msg or
            "unfreeze" in msg or "cad tool" in msg)


def test_corrupt_dxf_falls_through_to_recover_path():
    """Garbled bytes that look DXF-like but aren't parseable must surface
    the 'corrupted or unsupported variant' message, not crash."""
    garbage = b"0\nSECTION\n2\nHEADER\nGARBAGE_TAG_NOT_DXF\n"
    with pytest.raises(ValueError):
        convert_dxf_bytes_to_svg(garbage)


def test_oversize_dxf_rejected_with_friendly_msg():
    """Files over the size cap should fail BEFORE we call ezdxf to
    avoid spending CPU on a doomed parse."""
    huge = b"X" * (60 * 1024 * 1024)  # 60 MB
    with pytest.raises(ValueError) as exc_info:
        convert_dxf_bytes_to_svg(huge)
    assert "max" in str(exc_info.value).lower()
