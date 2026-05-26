"""Maker Studio DXF export.

Converts the same Maker Studio design-intent JSON into a CNC-ready DXF
(AutoCAD R2018+) file using ezdxf. Layers split into:
  • CUT     — outer-cut borders and shape outlines
  • ENGRAVE — text (TEXT entities so most CAM software can re-vectorize)
  • HOLES   — mounting hole circles

Returns bytes (no on-disk artefact) so the caller can stream to R2 or
serve directly as an HTTP attachment.
"""
from __future__ import annotations

import io
import math
from typing import Any

import ezdxf

from studio_geometry import PRIMITIVES, _clamp


def _shape_polylines(slug: str, w: float, h: float, ox: float, oy: float):
    """Re-derive primitive polygon vertices for DXF without parsing SVG strings.

    For Phase 1 we mirror the polygon math from `studio_geometry` for the 4
    polygon primitives (mountains, pine_trees, deer, star, flag, cross). For
    the curve-based heart and sun_rays we approximate with polylines so the
    DXF stays clean.

    Returns a list of polyline vertex lists (each a closed-or-open path).
    """
    out: list[list[tuple[float, float]]] = []

    def add(pts):
        # translate to outer origin
        out.append([(ox + x, oy + (h - y)) for x, y in pts])  # flip Y for DXF (y-up)

    if slug == "mountains":
        add([
            (0, h), (0.10*w, 0.55*h), (0.22*w, 0.78*h), (0.38*w, 0.20*h),
            (0.55*w, 0.62*h), (0.68*w, 0.32*h), (0.82*w, 0.70*h),
            (w, 0.45*h), (w, h), (0, h),
        ])

    elif slug == "pine_trees":
        for cx, scale_h in [(w*0.22, h*0.78), (w*0.50, h*0.96), (w*0.78, h*0.72)]:
            th = scale_h
            tw = w * 0.18 * (scale_h / h)
            for top_y, bot_y, half_w_ratio in [
                (h - th, h - 0.72*th, 0.45),
                (h - 0.78*th, h - 0.42*th, 0.70),
                (h - 0.48*th, h - 0.08*th, 1.00),
            ]:
                half = tw * half_w_ratio
                add([(cx, top_y), (cx - half, bot_y), (cx + half, bot_y), (cx, top_y)])
            # trunk
            trunk_w_half = tw * 0.08
            ty = h - 0.10*th
            add([
                (cx - trunk_w_half, ty),
                (cx + trunk_w_half, ty),
                (cx + trunk_w_half, ty + 0.10*th),
                (cx - trunk_w_half, ty + 0.10*th),
                (cx - trunk_w_half, ty),
            ])

    elif slug == "deer":
        pts = [
            (0.08, 0.78), (0.08, 0.70), (0.18, 0.62), (0.30, 0.62),
            (0.32, 0.52), (0.36, 0.52), (0.40, 0.42), (0.48, 0.30),
            (0.46, 0.18), (0.44, 0.05), (0.52, 0.10), (0.55, 0.04),
            (0.58, 0.14), (0.64, 0.06), (0.66, 0.18), (0.62, 0.30),
            (0.70, 0.42), (0.72, 0.55), (0.86, 0.60), (0.90, 0.66),
            (0.92, 0.78), (0.88, 0.80), (0.82, 0.72), (0.80, 0.92),
            (0.74, 0.92), (0.72, 0.78), (0.46, 0.78), (0.42, 0.92),
            (0.36, 0.92), (0.34, 0.78), (0.22, 0.78), (0.20, 0.92),
            (0.14, 0.92), (0.12, 0.80), (0.08, 0.78),
        ]
        add([(p[0]*w, p[1]*h) for p in pts])

    elif slug == "star":
        cx, cy = w/2, h/2
        R = min(w, h) * 0.48
        r = R * 0.40
        pts = []
        for i in range(10):
            angle = -math.pi/2 + i * math.pi/5
            radius = R if i % 2 == 0 else r
            pts.append((cx + radius*math.cos(angle), cy + radius*math.sin(angle)))
        pts.append(pts[0])
        add(pts)

    elif slug == "flag":
        # 7 black stripes as filled rectangles + canton
        for i in range(0, 13, 2):
            y = (i/13)*h
            sh = h/13
            add([(0, y), (w, y), (w, y + sh), (0, y + sh), (0, y)])
        canton_w, canton_h = w*0.4, h*(7/13)
        add([(0, 0), (canton_w, 0), (canton_w, canton_h), (0, canton_h), (0, 0)])

    elif slug == "cross":
        arm_w = w * 0.22
        cx = w / 2
        add([
            (cx - arm_w/2, 0), (cx + arm_w/2, 0),
            (cx + arm_w/2, h), (cx - arm_w/2, h),
            (cx - arm_w/2, 0),
        ])
        cross_y = h * 0.28
        add([
            (w*0.18, cross_y), (w*0.82, cross_y),
            (w*0.82, cross_y + arm_w), (w*0.18, cross_y + arm_w),
            (w*0.18, cross_y),
        ])

    elif slug == "heart":
        # Approximate cubic bezier with 60 sampled points
        pts = []
        for i in range(61):
            t = i / 60
            # Two halves: left (0..0.5) and right (0.5..1)
            if t <= 0.5:
                u = t * 2  # 0..1
                # cubic from (w/2, 0.92h) → (0.05w, 0.55h) → (0.10w, 0.10h) → (w/2, 0.30h)
                x = _cubic(u, w/2, 0.05*w, 0.10*w, w/2)
                y = _cubic(u, 0.92*h, 0.55*h, 0.10*h, 0.30*h)
            else:
                u = (t - 0.5) * 2  # 0..1
                x = _cubic(u, w/2, 0.90*w, 0.95*w, w/2)
                y = _cubic(u, 0.30*h, 0.10*h, 0.55*h, 0.92*h)
            pts.append((x, y))
        add(pts)

    elif slug == "sun_rays":
        cx, cy = w / 2, h * 0.55
        inner = min(w, h) * 0.18
        outer = min(w, h) * 0.42
        # Approximate disc as 32-gon
        circle_pts = []
        for i in range(33):
            a = i * 2 * math.pi / 32
            circle_pts.append((cx + inner*math.cos(a), cy + inner*math.sin(a)))
        add(circle_pts)
        # Rays as separate short lines
        for i in range(12):
            a = i * math.pi / 6
            x1 = cx + (inner + 4) * math.cos(a)
            y1 = cy + (inner + 4) * math.sin(a)
            x2 = cx + outer * math.cos(a)
            y2 = cy + outer * math.sin(a)
            add([(x1, y1), (x2, y2)])

    elif slug == "eagle":
        pts = [
            (0.50, 0.05), (0.55, 0.10), (0.60, 0.10), (0.62, 0.18),
            (0.58, 0.22), (0.55, 0.28),
            (0.85, 0.20), (0.95, 0.25), (0.92, 0.32), (0.78, 0.40),
            (0.95, 0.45), (0.86, 0.55), (0.72, 0.50),
            (0.62, 0.55), (0.62, 0.75), (0.70, 0.85), (0.58, 0.80),
            (0.50, 0.95), (0.42, 0.80), (0.30, 0.85), (0.38, 0.75),
            (0.38, 0.55),
            (0.28, 0.50), (0.14, 0.55), (0.05, 0.45),
            (0.22, 0.40), (0.08, 0.32), (0.05, 0.25), (0.15, 0.20),
            (0.42, 0.28), (0.45, 0.22), (0.42, 0.18),
            (0.44, 0.10), (0.49, 0.10), (0.50, 0.05),
        ]
        add([(p[0]*w, p[1]*h) for p in pts])

    elif slug == "antlers":
        for side in (+1, -1):
            cx = w / 2
            path_pts = [
                (cx, h),
                (cx + side * 0.05*w, 0.75*h),
                (cx + side * 0.12*w, 0.55*h),
                (cx + side * 0.20*w, 0.40*h),
                (cx + side * 0.30*w, 0.28*h),
                (cx + side * 0.42*w, 0.20*h),
                (cx + side * 0.38*w, 0.12*h),
                (cx + side * 0.30*w, 0.18*h),
                (cx + side * 0.22*w, 0.10*h),
                (cx + side * 0.15*w, 0.16*h),
                (cx + side * 0.08*w, 0.06*h),
                (cx + side * 0.02*w, 0.20*h),
                (cx, 0.50*h),
                (cx, h),
            ]
            add(path_pts)

    elif slug == "rooster":
        pts = [
            (0.05, 0.55), (0.12, 0.30), (0.18, 0.28), (0.20, 0.18),
            (0.25, 0.22), (0.28, 0.12), (0.32, 0.20), (0.36, 0.30),
            (0.40, 0.25),
            (0.42, 0.34), (0.50, 0.36), (0.50, 0.40), (0.46, 0.44),
            (0.50, 0.46),
            (0.58, 0.50), (0.72, 0.55), (0.80, 0.42),
            (0.92, 0.30), (0.95, 0.20), (0.93, 0.35),
            (0.88, 0.42), (0.95, 0.55), (0.85, 0.60),
            (0.92, 0.72), (0.78, 0.68),
            (0.70, 0.78), (0.60, 0.85), (0.55, 0.82),
            (0.50, 0.92), (0.44, 0.92), (0.48, 0.82),
            (0.42, 0.92), (0.36, 0.92), (0.40, 0.80),
            (0.30, 0.72), (0.18, 0.66), (0.08, 0.60),
            (0.05, 0.55),
        ]
        add([(p[0]*w, p[1]*h) for p in pts])

    elif slug == "anchor":
        # Just emit the outer shank+stock+arms as separate polygons.
        cx = w / 2
        ring_r = min(w, h) * 0.08
        shank_w = min(w, h) * 0.06
        top_y = ring_r * 2.4
        bot_y = h * 0.78
        # Shank rect
        add([
            (cx - shank_w/2, top_y), (cx + shank_w/2, top_y),
            (cx + shank_w/2, bot_y), (cx - shank_w/2, bot_y),
            (cx - shank_w/2, top_y),
        ])
        sb_y = top_y + (bot_y - top_y) * 0.18
        sb_w = w * 0.34
        sb_h = min(w, h) * 0.05
        add([
            (cx - sb_w/2, sb_y), (cx + sb_w/2, sb_y),
            (cx + sb_w/2, sb_y + sb_h), (cx - sb_w/2, sb_y + sb_h),
            (cx - sb_w/2, sb_y),
        ])
        arm_radius = w * 0.30
        arm_left = [
            (cx - shank_w/2, bot_y - sb_h),
            (cx - arm_radius, bot_y),
            (cx - arm_radius * 1.05, bot_y + sb_h * 1.4),
            (cx - arm_radius * 0.55, bot_y + sb_h * 0.4),
            (cx - shank_w/2, bot_y - sb_h * 0.2),
            (cx - shank_w/2, bot_y - sb_h),
        ]
        add(arm_left)
        add([(w - p[0], p[1]) for p in arm_left])

    elif slug == "compass_rose":
        cx, cy = w / 2, h / 2
        long_r = min(w, h) * 0.48
        short_r = min(w, h) * 0.30
        side_r = min(w, h) * 0.08
        for ang in (0, 90, 180, 270):
            a = math.radians(ang - 90)
            tx = cx + long_r * math.cos(a); ty = cy + long_r * math.sin(a)
            bx1 = cx + side_r * math.cos(a + math.pi/2); by1 = cy + side_r * math.sin(a + math.pi/2)
            bx2 = cx + side_r * math.cos(a - math.pi/2); by2 = cy + side_r * math.sin(a - math.pi/2)
            add([(tx, ty), (bx1, by1), (bx2, by2), (tx, ty)])
        for ang in (45, 135, 225, 315):
            a = math.radians(ang - 90)
            tx = cx + short_r * math.cos(a); ty = cy + short_r * math.sin(a)
            bx1 = cx + side_r*0.6 * math.cos(a + math.pi/2); by1 = cy + side_r*0.6 * math.sin(a + math.pi/2)
            bx2 = cx + side_r*0.6 * math.cos(a - math.pi/2); by2 = cy + side_r*0.6 * math.sin(a - math.pi/2)
            add([(tx, ty), (bx1, by1), (bx2, by2), (tx, ty)])

    elif slug == "treble_clef":
        # Sample cubic curve from SVG as ~40 points along the path
        # Coarse approximation built from 4 cubic segments.
        segments = [
            ((0.55, 0.05), (0.20, 0.30), (0.20, 0.60), (0.60, 0.55)),
            ((0.60, 0.55), (0.85, 0.50), (0.85, 0.20), (0.45, 0.30)),
            ((0.45, 0.30), (0.20, 0.40), (0.25, 0.85), (0.60, 0.85)),
            ((0.60, 0.85), (0.85, 0.85), (0.85, 0.65), (0.60, 0.65)),
        ]
        pts = []
        for seg in segments:
            for i in range(20):
                t = i / 19
                px = _cubic(t, seg[0][0]*w, seg[1][0]*w, seg[2][0]*w, seg[3][0]*w)
                py = _cubic(t, seg[0][1]*h, seg[1][1]*h, seg[2][1]*h, seg[3][1]*h)
                pts.append((px, py))
        add(pts)

    return out


def _cubic(t: float, p0: float, p1: float, p2: float, p3: float) -> float:
    mt = 1 - t
    return mt**3 * p0 + 3 * mt**2 * t * p1 + 3 * mt * t**2 * p2 + t**3 * p3


def render_dxf(design: dict[str, Any]) -> bytes:
    """Build a DXF document from the design-intent JSON. Returns bytes."""
    from studio_geometry import PX_PER_INCH

    width_in  = float(design.get("width",  12))
    height_in = float(design.get("height", 6))
    W = width_in * PX_PER_INCH
    H = height_in * PX_PER_INCH

    doc = ezdxf.new("R2018", setup=True)
    doc.layers.add(name="CUT",     color=1)
    doc.layers.add(name="ENGRAVE", color=2)
    doc.layers.add(name="HOLES",   color=3)
    doc.layers.add(name="NOTES",   color=8)
    # iter238 — declared units come from the design intent. INSUNITS:
    # 1=Inches, 4=Millimeters (per AutoCAD spec).
    declared_units = design.get("units", "inches")
    doc.header["$INSUNITS"] = 1 if declared_units == "inches" else 4
    # Material + depth metadata — surfaced both as $TITLE/$SUBJECT header
    # fields AND as a human-readable NOTES-layer TEXT entity at the
    # bottom-right corner so CAM operators can read it at a glance.
    material = (design.get("material") or "wood").lower()
    material_depth = float(design.get("material_depth", 0.25))
    msp = doc.modelspace()

    border = design.get("border", "none")
    border_thick = float(design.get("border_thickness", 0.25)) * PX_PER_INCH
    engrave_only = bool(design.get("engrave_only", False))
    SHAPE_LAYER = "ENGRAVE" if engrave_only else "CUT"

    # ── Border (skipped entirely in engrave-only mode) ──────────────────────
    if not engrave_only:
        if border in ("rectangle", "rounded"):
            msp.add_lwpolyline(
                [(0, 0), (W, 0), (W, H), (0, H)],
                close=True,
                dxfattribs={"layer": "CUT"},
            )
        elif border == "circle":
            r = min(W, H) / 2 - border_thick / 2
            msp.add_circle((W/2, H/2), r, dxfattribs={"layer": "CUT"})
        elif border == "oval":
            rx = W/2 - border_thick/2
            ry = H/2 - border_thick/2
            msp.add_ellipse(
                (W/2, H/2),
                major_axis=(rx, 0),
                ratio=ry/rx if rx else 1,
                dxfattribs={"layer": "CUT"},
            )

    # ── Operations ──────────────────────────────────────────────────────────
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
            # SVG origin = top-left; DXF origin = bottom-left. Compute DXF
            # bottom-left of the bounding box.
            ox = sx - sw / 2
            oy_dxf = H - (sy + sh / 2)
            for poly in _shape_polylines(slug, sw, sh, ox, oy_dxf):
                msp.add_lwpolyline(
                    [(p[0], p[1]) for p in poly],
                    close=(poly[0] == poly[-1]) if len(poly) > 2 else False,
                    dxfattribs={"layer": SHAPE_LAYER},
                )

        elif kind == "text":
            content = str(op.get("content", "")).strip()[:80]
            if not content:
                continue
            size_in = _clamp(float(op.get("size", 0.18)), 0.05, 0.5) * height_in
            x_frac = _clamp(float(op.get("x", 0.5)), 0, 1)
            y_frac = _clamp(float(op.get("y", 0.5)), 0, 1)
            tx_in = x_frac * width_in
            ty_in = height_in - y_frac * height_in
            text_entity = msp.add_text(
                content,
                dxfattribs={
                    "layer": "ENGRAVE",
                    "height": size_in * PX_PER_INCH,
                    "style": "Standard",
                },
            )
            # Center horizontally
            text_entity.set_placement(
                (tx_in * PX_PER_INCH, ty_in * PX_PER_INCH),
                align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER,
            )

    # ── Holes ───────────────────────────────────────────────────────────────
    holes = design.get("holes") or {}
    h_count = int(holes.get("count", 0))
    if h_count > 0:
        diameter = _clamp(float(holes.get("diameter", 0.25)), 0.0625, 1.0) * PX_PER_INCH
        placement = holes.get("placement", "top_corners")
        margin = max(diameter * 1.2, border_thick * 0.8)
        coords: list[tuple[float, float]] = []
        if placement == "top_corners":
            coords = [(margin, H - margin), (W - margin, H - margin)]
        elif placement == "bottom_corners":
            coords = [(margin, margin), (W - margin, margin)]
        elif placement == "four_corners":
            coords = [(margin, margin), (W - margin, margin),
                      (margin, H - margin), (W - margin, H - margin)]
        elif placement == "top_center":
            coords = [(W / 2, H - margin)]
        for cx, cy in coords[:h_count]:
            msp.add_circle((cx, cy), diameter/2, dxfattribs={"layer": "HOLES"})

    # iter238 — Parametric NOTES — surface material + depth + dimensions
    # so the CAM operator sees machine setup intent inside the DXF.
    unit_label = "in" if declared_units == "inches" else "mm"
    note_text = f"MATERIAL: {material.upper()} {material_depth:.3f}{unit_label}  |  SIZE: {width_in:g}x{height_in:g}{unit_label}  |  MODE: {'ENGRAVE' if engrave_only else 'CUT+ENGRAVE'}"
    note = msp.add_text(
        note_text,
        dxfattribs={"layer": "NOTES", "height": min(W, H) * 0.025, "style": "Standard"},
    )
    note.set_placement(
        (W * 0.02, H * 0.02),
        align=ezdxf.enums.TextEntityAlignment.LEFT,
    )

    # Stream DXF to bytes
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")
