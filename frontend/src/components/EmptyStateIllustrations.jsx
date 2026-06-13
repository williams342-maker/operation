/**
 * iter413j — Brand-aligned empty-state illustrations.
 *
 * All illustrations use `fill="none" stroke="currentColor"` so they
 * inherit text color from the parent — drop them inside any
 * `text-ink-muted`, `text-brand`, etc. wrapper and they'll tint
 * correctly across light + dark themes.
 *
 * Why hand-drawn SVG over an illustration library?
 * The brand voice is industrial / workshop / Aged Canvas — generic
 * "isometric guy holding a box" stock illustrations clash. These are
 * deliberately simple line-art motifs (receipt, star row, crate,
 * workshop nail + envelope) that match the existing brand language.
 */
import React from "react";

const SVG_PROPS = {
  width: 96,
  height: 96,
  viewBox: "0 0 96 96",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

/** A receipt / invoice — empty paid-orders state. */
export function OrdersIllustration() {
  return (
    <svg {...SVG_PROPS}>
      {/* Receipt body */}
      <path d="M28 14 H68 V78 L60 74 L52 78 L44 74 L36 78 L28 74 Z" />
      {/* Title bar */}
      <line x1="34" y1="24" x2="62" y2="24" />
      {/* Line items */}
      <line x1="34" y1="34" x2="58" y2="34" />
      <line x1="34" y1="42" x2="54" y2="42" />
      <line x1="34" y1="50" x2="60" y2="50" />
      {/* Divider */}
      <line x1="34" y1="58" x2="62" y2="58" strokeDasharray="2 2" />
      {/* Total row */}
      <line x1="34" y1="66" x2="50" y2="66" />
      <line x1="56" y1="66" x2="62" y2="66" />
    </svg>
  );
}

/** A row of 5 stars, one filled — empty reviews state. */
export function ReviewsIllustration() {
  // Star path centered at (cx, cy) with outer radius r.
  const star = (cx, cy, filled = false) => {
    const r = 7, ri = 3;
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const rad = i % 2 === 0 ? r : ri;
      pts.push(`${(cx + rad * Math.cos(angle)).toFixed(2)},${(cy + rad * Math.sin(angle)).toFixed(2)}`);
    }
    return (
      <polygon
        key={`${cx},${cy}`}
        points={pts.join(" ")}
        fill={filled ? "currentColor" : "none"}
      />
    );
  };
  return (
    <svg {...SVG_PROPS}>
      {/* Card outline */}
      <rect x="16" y="22" width="64" height="52" rx="0" />
      {/* 5 stars centered horizontally on y=42 */}
      {[24, 36, 48, 60, 72].map((cx, i) => star(cx, 42, i === 0))}
      {/* Quote / handle lines below */}
      <line x1="24" y1="58" x2="60" y2="58" />
      <line x1="24" y1="64" x2="48" y2="64" />
    </svg>
  );
}

/** A wooden crate (workshop motif) — empty products / listings state. */
export function ProductsIllustration() {
  return (
    <svg {...SVG_PROPS}>
      {/* Crate body */}
      <path d="M18 28 H78 V76 H18 Z" />
      {/* Top lid line */}
      <line x1="18" y1="28" x2="78" y2="28" />
      {/* Vertical slats */}
      <line x1="34" y1="28" x2="34" y2="76" />
      <line x1="48" y1="28" x2="48" y2="76" />
      <line x1="62" y1="28" x2="62" y2="76" />
      {/* Stamp / brand mark */}
      <circle cx="48" cy="52" r="8" />
      <line x1="44" y1="52" x2="52" y2="52" />
      {/* Floor shadow */}
      <line x1="14" y1="80" x2="82" y2="80" strokeDasharray="2 3" />
    </svg>
  );
}

/** A workshop hook with a single envelope — empty messages state. */
export function MessagesIllustration() {
  return (
    <svg {...SVG_PROPS}>
      {/* Wall line */}
      <line x1="14" y1="22" x2="82" y2="22" />
      {/* Hook */}
      <path d="M48 22 V32 a4 4 0 0 0 4 4" />
      {/* String */}
      <line x1="52" y1="36" x2="52" y2="44" />
      {/* Envelope */}
      <rect x="30" y="44" width="44" height="28" />
      <polyline points="30,44 52,62 74,44" />
      {/* Stamp corner */}
      <rect x="64" y="48" width="6" height="6" />
    </svg>
  );
}

/** Magnifying glass over crosshatch paper — no results state. */
export function NoResultsIllustration() {
  return (
    <svg {...SVG_PROPS}>
      {/* Paper */}
      <path d="M18 22 H66 L78 34 V80 H18 Z" />
      {/* Folded corner */}
      <polyline points="66,22 66,34 78,34" />
      {/* Crosshatched lines */}
      <line x1="26" y1="46" x2="54" y2="46" strokeDasharray="2 3" />
      <line x1="26" y1="54" x2="60" y2="54" strokeDasharray="2 3" />
      <line x1="26" y1="62" x2="50" y2="62" strokeDasharray="2 3" />
      {/* Magnifying glass overlay */}
      <circle cx="58" cy="58" r="11" />
      <line x1="66" y1="66" x2="76" y2="76" strokeWidth="2.4" />
    </svg>
  );
}

/** A package box with shipping tape — empty backorders / shipments state. */
export function PackageIllustration() {
  return (
    <svg {...SVG_PROPS}>
      {/* Box top diamond */}
      <polygon points="48,14 80,28 48,42 16,28" />
      {/* Left face */}
      <polyline points="16,28 16,68 48,82 48,42" />
      {/* Right face */}
      <polyline points="80,28 80,68 48,82" />
      {/* Tape strip */}
      <line x1="32" y1="20" x2="64" y2="36" strokeWidth="2" />
    </svg>
  );
}

// Convenience map so callers can pass a string key instead of importing
// each component. Useful for empty states that swap based on filter
// state (e.g. `<EmptyState illustration={empty ? "products" : "no-results"} />`).
export const ILLUSTRATIONS = {
  orders: OrdersIllustration,
  reviews: ReviewsIllustration,
  products: ProductsIllustration,
  messages: MessagesIllustration,
  "no-results": NoResultsIllustration,
  package: PackageIllustration,
};
