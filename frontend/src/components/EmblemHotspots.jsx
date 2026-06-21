// iter413bs — Interactive Garage Builders emblem with SVG hotspot overlay.
// Used on /community/emblem only (the home-page rendering stays static
// per the launch scope).
//
// Spec recap:
//   • Hover (desktop) → highlight segment + label
//   • Tap (mobile) → reveal CTA, second tap navigates
//   • Click → /shop?segment=<slug>
//   • SVG only, no drawers, no product previews, no animation beyond
//     a subtle highlight.

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

// Approx polygon positions for each of the 9 maker segments in the
// emblem image (square, viewBox 100×100). Coordinates were sampled
// against the master 2048×2048 PNG so they line up with the visible
// label plates regardless of how the image is scaled at render time.
const SEGMENTS = [
  { id: "woodworking",  label: "Woodworking",       slug: "woodworking",
    poly: "35,15  60,15  60,35  35,35" },
  { id: "metalworking", label: "Metalworking",      slug: "metalworking",
    poly: "60,15  85,15  85,35  60,35" },
  { id: "leather",      label: "Leather Craft",     slug: "leather",
    poly: "10,32  32,32  32,52  10,52" },
  { id: "electronics",  label: "Electronics",       slug: "electronics",
    poly: "68,32  90,32  90,52  68,52" },
  { id: "3d-printing",  label: "3D Printing",       slug: "3d-printing",
    poly: "8,52  32,52  32,72  8,72" },
  { id: "laser",        label: "Laser Craft",       slug: "laser",
    poly: "68,52  92,52  92,72  68,72" },
  { id: "textiles",     label: "Textiles & Fiber",  slug: "textiles",
    poly: "15,72  38,72  38,90  15,90" },
  { id: "pottery",      label: "Pottery & Ceramics", slug: "pottery",
    poly: "38,72  62,72  62,90  38,90" },
  { id: "arts-crafts",  label: "Arts & Crafts",     slug: "arts-crafts",
    poly: "62,72  85,72  85,90  62,90" },
];

// Centroid for label positioning.
const centroid = (poly) => {
  const pts = poly.trim().split(/\s+/).map((p) => p.split(",").map(Number));
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return [cx, cy];
};

export default function EmblemHotspots() {
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState(null);
  // Mobile two-tap state: first tap arms the CTA, second tap on the
  // same hotspot navigates. We treat keyboard focus the same as a
  // first tap so this also works for accessibility / screen readers.
  const [armed, setArmed] = useState(null);

  const onSelect = (seg) => {
    if (armed === seg.id) {
      // Second activation — navigate.
      navigate(`/shop?segment=${seg.slug}`);
      setArmed(null);
      setActiveId(null);
      return;
    }
    setArmed(seg.id);
    setActiveId(seg.id);
  };

  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-label="Garage Builders maker segments — interactive"
      data-testid="emblem-hotspots-svg"
    >
      {SEGMENTS.map((seg) => {
        const isActive = activeId === seg.id;
        const isArmed = armed === seg.id;
        const [cx, cy] = centroid(seg.poly);
        return (
          <g key={seg.id} data-testid={`emblem-hotspot-${seg.id}`}>
            <polygon
              points={seg.poly}
              fill={isActive ? "rgba(255,69,0,0.18)" : "rgba(255,255,255,0)"}
              stroke={isActive ? "rgb(255,69,0)" : "transparent"}
              strokeWidth={isActive ? 0.4 : 0}
              role="link"
              aria-label={`${seg.label} — ${isArmed ? "tap again to open" : "open shop filter"}`}
              tabIndex={0}
              onMouseEnter={() => setActiveId(seg.id)}
              onMouseLeave={() => { if (armed !== seg.id) setActiveId(null); }}
              onFocus={() => setActiveId(seg.id)}
              onBlur={() => { if (armed !== seg.id) setActiveId(null); }}
              onClick={() => onSelect(seg)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(seg);
                }
              }}
              style={{ pointerEvents: "auto", cursor: "pointer", transition: "fill 120ms, stroke 120ms" }}
            />
            {/* Label chip appears only on hover/focus/arm. SVG <text>
                is crisp at any badge scale, no extra DOM nodes. */}
            {isActive && (
              <g style={{ pointerEvents: "none" }} data-testid={`emblem-hotspot-label-${seg.id}`}>
                <rect
                  x={cx - 11} y={cy - 3.5}
                  width={22} height={6.5}
                  fill="rgb(255,69,0)"
                  stroke="rgb(10,10,10)" strokeWidth={0.3}
                />
                <text
                  x={cx} y={cy + 1.2}
                  fontSize={2.4} fontFamily="ui-monospace, monospace"
                  fontWeight="600" letterSpacing="0.18em"
                  textAnchor="middle" fill="rgb(10,10,10)"
                >
                  {seg.label.toUpperCase()}
                </text>
                {isArmed && (
                  <text
                    x={cx} y={cy + 4.2}
                    fontSize={1.6} fontFamily="ui-monospace, monospace"
                    letterSpacing="0.18em"
                    textAnchor="middle" fill="rgb(10,10,10)"
                  >
                    TAP AGAIN →
                  </text>
                )}
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export { SEGMENTS };
