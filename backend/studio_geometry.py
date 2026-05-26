"""Maker Studio geometry engine.

Takes a structured "design intent" JSON document and emits clean black-on-white
silhouette SVG suitable for CNC plasma/laser cutting (and downstream DXF
conversion).

Design philosophy:
  - Solid black fill on white background, no gradients, no rasters.
  - All shape primitives ship as parametric path strings (so they scale cleanly
    and convert losslessly to DXF polylines).
  - Two "layers" implicitly tracked: outer-cut and engraving — both rendered
    in pure black so the buyer sees a finished silhouette in the preview.

Public API:
  • PRIMITIVES — dict of slug → renderer function (sandbox the AI to this set).
  • render_svg(design)  → str           — full SVG document.
  • design_summary(design) → dict       — for analytics + filenames.
"""
from __future__ import annotations

from typing import Any, Callable

# ─────────────────────────────────────────────────────────────────────────────
# SHAPE PRIMITIVE LIBRARY
# Each primitive returns an SVG fragment (path/polygon/etc.) centered on its
# bounding box, sized to `w` × `h`, positioned by an outer transform.
# Coordinates use the SVG y-down convention.
# ─────────────────────────────────────────────────────────────────────────────


def _mountains(w: float, h: float) -> str:
    """Three jagged peaks with a small foreground peak."""
    # Build polygon points: base line + four peaks.
    points = [
        (0,        h),
        (0.10 * w, 0.55 * h),
        (0.22 * w, 0.78 * h),
        (0.38 * w, 0.20 * h),
        (0.55 * w, 0.62 * h),
        (0.68 * w, 0.32 * h),
        (0.82 * w, 0.70 * h),
        (w,        0.45 * h),
        (w,        h),
    ]
    pts = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
    return f'<polygon points="{pts}" fill="#000" />'


def _pine_trees(w: float, h: float) -> str:
    """Row of three triangular pine trees, central one taller."""
    def tree(cx, scale_h, trunk_w_ratio=0.08):
        tw = w * 0.18 * (scale_h / h)  # tree width scales with height
        th = scale_h
        # 3 stacked triangles (top → bottom), each wider, then a trunk.
        layers = []
        for i, (top_y, bot_y, half_w_ratio) in enumerate([
            (h - th, h - 0.72 * th, 0.45),
            (h - 0.78 * th, h - 0.42 * th, 0.70),
            (h - 0.48 * th, h - 0.08 * th, 1.00),
        ]):
            half = tw * half_w_ratio
            layers.append(
                f'<polygon points="{cx:.2f},{top_y:.2f} '
                f'{cx - half:.2f},{bot_y:.2f} '
                f'{cx + half:.2f},{bot_y:.2f}" fill="#000" />'
            )
        # trunk
        tw_half = tw * trunk_w_ratio
        layers.append(
            f'<rect x="{cx - tw_half:.2f}" y="{h - 0.10 * th:.2f}" '
            f'width="{2 * tw_half:.2f}" height="{0.10 * th:.2f}" fill="#000" />'
        )
        return "".join(layers)

    return (
        tree(w * 0.22, h * 0.78) +
        tree(w * 0.50, h * 0.96) +
        tree(w * 0.78, h * 0.72)
    )


def _deer(w: float, h: float) -> str:
    """Side-profile silhouette: body, legs, neck, antlered head."""
    cx, cy = w / 2, h / 2
    # Single closed polygon outline of a stylized standing buck.
    pts = [
        (0.08, 0.78), (0.08, 0.70), (0.18, 0.62), (0.30, 0.62),
        (0.32, 0.52), (0.36, 0.52), (0.40, 0.42), (0.48, 0.30),
        (0.46, 0.18), (0.44, 0.05), (0.52, 0.10), (0.55, 0.04),
        (0.58, 0.14), (0.64, 0.06), (0.66, 0.18), (0.62, 0.30),
        (0.70, 0.42), (0.72, 0.55), (0.86, 0.60), (0.90, 0.66),
        (0.92, 0.78), (0.88, 0.80), (0.82, 0.72), (0.80, 0.92),
        (0.74, 0.92), (0.72, 0.78), (0.46, 0.78), (0.42, 0.92),
        (0.36, 0.92), (0.34, 0.78), (0.22, 0.78), (0.20, 0.92),
        (0.14, 0.92), (0.12, 0.80),
    ]
    pts = " ".join(f"{p[0]*w:.2f},{p[1]*h:.2f}" for p in pts)
    return f'<polygon points="{pts}" fill="#000" />'


def _heart(w: float, h: float) -> str:
    """Classic heart silhouette via two cubic curves."""
    return (
        f'<path d="M {w/2:.2f} {0.92*h:.2f} '
        f'C {0.05*w:.2f} {0.55*h:.2f}, {0.10*w:.2f} {0.10*h:.2f}, '
        f'{w/2:.2f} {0.30*h:.2f} '
        f'C {0.90*w:.2f} {0.10*h:.2f}, {0.95*w:.2f} {0.55*h:.2f}, '
        f'{w/2:.2f} {0.92*h:.2f} Z" fill="#000" />'
    )


def _star(w: float, h: float) -> str:
    """5-point star centered."""
    import math
    cx, cy = w / 2, h / 2
    R = min(w, h) * 0.48
    r = R * 0.40
    pts = []
    for i in range(10):
        angle = -math.pi / 2 + i * math.pi / 5
        radius = R if i % 2 == 0 else r
        pts.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return ('<polygon points="'
            + " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
            + '" fill="#000" />')


def _flag(w: float, h: float) -> str:
    """Stylised American flag — stripes + 50-star canton block."""
    # 7 black stripes (alternating with cut-out whites in real metal,
    # but visually black on white here so it reads as a flag silhouette).
    stripes = []
    for i in range(0, 13, 2):  # every other stripe is black
        y = (i / 13) * h
        sh = h / 13
        stripes.append(
            f'<rect x="0" y="{y:.2f}" width="{w:.2f}" height="{sh:.2f}" fill="#000" />'
        )
    # Canton — solid black rectangle over the top-left quarter to differentiate.
    canton_w, canton_h = w * 0.4, h * (7 / 13)
    stripes.append(f'<rect x="0" y="0" width="{canton_w:.2f}" height="{canton_h:.2f}" fill="#000" />')
    return "".join(stripes)


def _cross(w: float, h: float) -> str:
    """Traditional cross silhouette."""
    arm_w = w * 0.22
    cx = w / 2
    vert = f'<rect x="{cx - arm_w/2:.2f}" y="0" width="{arm_w:.2f}" height="{h:.2f}" fill="#000" />'
    cross_y = h * 0.28
    horz = f'<rect x="{w * 0.18:.2f}" y="{cross_y:.2f}" width="{w * 0.64:.2f}" height="{arm_w:.2f}" fill="#000" />'
    return vert + horz


def _sun_rays(w: float, h: float) -> str:
    """Radiating sun — solid disc + 12 spokes."""
    import math
    cx, cy = w / 2, h * 0.55
    inner = min(w, h) * 0.18
    outer = min(w, h) * 0.42
    disc = f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{inner:.2f}" fill="#000" />'
    rays = []
    for i in range(12):
        a = i * math.pi / 6
        x1 = cx + (inner + 4) * math.cos(a)
        y1 = cy + (inner + 4) * math.sin(a)
        x2 = cx + outer * math.cos(a)
        y2 = cy + outer * math.sin(a)
        rays.append(
            f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" '
            f'stroke="#000" stroke-width="{max(2, min(w, h) * 0.02):.2f}" stroke-linecap="round" />'
        )
    return disc + "".join(rays)


PRIMITIVES: dict[str, Callable[[float, float], str]] = {
    "mountains":   _mountains,
    "pine_trees":  _pine_trees,
    "deer":        _deer,
    "heart":       _heart,
    "star":        _star,
    "flag":        _flag,
    "cross":       _cross,
    "sun_rays":    _sun_rays,
}

# Font stack mapping the 4 AI-selectable styles to a real CSS family.
FONTS: dict[str, str] = {
    "bold_serif": "'Anton', 'Bebas Neue', Impact, sans-serif",
    "script":    "'Dancing Script', 'Brush Script MT', cursive",
    "western":   "'Rye', 'Smokum', serif",
    "sans":      "'Inter', 'Helvetica Neue', Arial, sans-serif",
}

# Border style → SVG <rect> attribute additions.
BORDER_STYLES = {
    "none":     None,
    "rectangle": {"rx": 0, "ry": 0},
    "rounded":   {"rx": 0.04, "ry": 0.04},  # relative to width
    "circle":    "circle",
    "oval":      "ellipse",
}


# ─────────────────────────────────────────────────────────────────────────────
# DESIGN JSON SCHEMA
# {
#   "width":  12,          # inches
#   "height": 6,           # inches
#   "border": "rounded",   # one of BORDER_STYLES keys
#   "border_thickness": 0.25,  # inches
#   "operations": [
#     { "kind": "shape", "primitive": "mountains",
#       "x": 0.5, "y": 0.5, "w": 0.6, "h": 0.4 },   # fractions of canvas
#     { "kind": "text", "content": "Lake House",
#       "font": "bold_serif", "size": 0.30, "y": 0.78 },   # size as fraction of canvas height
#   ],
#   "holes": { "count": 2, "diameter": 0.25, "placement": "top_corners" },
# }
# ─────────────────────────────────────────────────────────────────────────────


# Output canvas (pixels). 100px = 1 inch keeps math simple end-to-end.
PX_PER_INCH = 100


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def render_svg(design: dict[str, Any]) -> str:
    """Convert a design-intent JSON into a clean black-on-white SVG string."""
    width_in  = float(design.get("width",  12))
    height_in = float(design.get("height", 6))
    W = width_in * PX_PER_INCH
    H = height_in * PX_PER_INCH

    border = design.get("border", "none")
    border_thick = float(design.get("border_thickness", 0.25)) * PX_PER_INCH

    body_parts: list[str] = []

    # ── Border ──────────────────────────────────────────────────────────────
    if border in ("rectangle", "rounded"):
        rx_factor = BORDER_STYLES[border].get("rx", 0)
        rx = W * rx_factor if rx_factor else 0
        body_parts.append(
            f'<rect x="{border_thick/2:.2f}" y="{border_thick/2:.2f}" '
            f'width="{W - border_thick:.2f}" height="{H - border_thick:.2f}" '
            f'rx="{rx:.2f}" ry="{rx:.2f}" '
            f'fill="none" stroke="#000" stroke-width="{border_thick:.2f}" />'
        )
    elif border == "circle":
        r = min(W, H) / 2 - border_thick / 2
        body_parts.append(
            f'<circle cx="{W/2:.2f}" cy="{H/2:.2f}" r="{r:.2f}" '
            f'fill="none" stroke="#000" stroke-width="{border_thick:.2f}" />'
        )
    elif border == "oval":
        body_parts.append(
            f'<ellipse cx="{W/2:.2f}" cy="{H/2:.2f}" '
            f'rx="{W/2 - border_thick/2:.2f}" ry="{H/2 - border_thick/2:.2f}" '
            f'fill="none" stroke="#000" stroke-width="{border_thick:.2f}" />'
        )

    # ── Operations (shapes + text) ──────────────────────────────────────────
    for op in design.get("operations", []) or []:
        kind = op.get("kind")
        if kind == "shape":
            slug = op.get("primitive")
            if slug not in PRIMITIVES:
                continue
            sx = _clamp(float(op.get("x", 0.5)), 0, 1) * W
            sy = _clamp(float(op.get("y", 0.5)), 0, 1) * H
            sw = _clamp(float(op.get("w", 0.6)), 0.05, 1) * W
            sh = _clamp(float(op.get("h", 0.4)), 0.05, 1) * H
            frag = PRIMITIVES[slug](sw, sh)
            body_parts.append(
                f'<g transform="translate({sx - sw/2:.2f},{sy - sh/2:.2f})">{frag}</g>'
            )

        elif kind == "text":
            content = str(op.get("content", "")).strip()[:80]
            if not content:
                continue
            font = FONTS.get(op.get("font", "bold_serif"), FONTS["bold_serif"])
            size = _clamp(float(op.get("size", 0.18)), 0.05, 0.5) * H
            x_frac = _clamp(float(op.get("x", 0.5)), 0, 1)
            y_frac = _clamp(float(op.get("y", 0.5)), 0, 1)
            anchor = "middle"
            tx = x_frac * W
            ty = y_frac * H + size * 0.32  # nudge to optical center
            body_parts.append(
                f'<text x="{tx:.2f}" y="{ty:.2f}" '
                f'font-family="{font}" font-size="{size:.2f}" '
                f'font-weight="900" '
                f'text-anchor="{anchor}" fill="#000">'
                f'{_escape(content)}</text>'
            )

    # ── Mounting holes ──────────────────────────────────────────────────────
    holes = design.get("holes") or {}
    h_count = int(holes.get("count", 0))
    if h_count > 0:
        diameter = _clamp(float(holes.get("diameter", 0.25)), 0.0625, 1.0) * PX_PER_INCH
        placement = holes.get("placement", "top_corners")
        margin = max(diameter * 1.2, border_thick * 0.8)
        coords: list[tuple[float, float]] = []
        if placement == "top_corners":
            coords = [(margin, margin), (W - margin, margin)]
        elif placement == "bottom_corners":
            coords = [(margin, H - margin), (W - margin, H - margin)]
        elif placement == "four_corners":
            coords = [(margin, margin), (W - margin, margin),
                      (margin, H - margin), (W - margin, H - margin)]
        elif placement == "top_center":
            coords = [(W / 2, margin)]
        # Honor the requested hole count
        coords = coords[:h_count] if coords else []
        for cx, cy in coords:
            body_parts.append(
                f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{diameter/2:.2f}" fill="#fff" stroke="#000" stroke-width="2" />'
            )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {W:.2f} {H:.2f}" width="{W:.2f}" height="{H:.2f}" '
        f'shape-rendering="geometricPrecision" '
        f'data-units="inches" data-design-w="{width_in}" data-design-h="{height_in}">'
        f'<rect x="0" y="0" width="{W:.2f}" height="{H:.2f}" fill="#fff" />'
        + "".join(body_parts) +
        '</svg>'
    )
    return svg


def _escape(s: str) -> str:
    return (
        s.replace("&", "&amp;").replace("<", "&lt;")
         .replace(">", "&gt;").replace('"', "&quot;")
    )


def design_summary(design: dict[str, Any]) -> dict[str, Any]:
    """Compact dict for analytics + filenames."""
    text_ops = [op for op in design.get("operations", []) or [] if op.get("kind") == "text"]
    shape_ops = [op for op in design.get("operations", []) or [] if op.get("kind") == "shape"]
    title = (text_ops[0].get("content") if text_ops else "design").strip()
    return {
        "title": title or "design",
        "size": f"{design.get('width', 12)}x{design.get('height', 6)}",
        "shapes": [op.get("primitive") for op in shape_ops if op.get("primitive")],
        "text_count": len(text_ops),
        "border": design.get("border", "none"),
        "holes": int((design.get("holes") or {}).get("count", 0)),
    }
