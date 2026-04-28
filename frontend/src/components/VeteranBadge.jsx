import React from "react";

/**
 * "Veteran-Owned" pill badge — US flag + label.
 *
 * Rendered on:
 *   - ProductCard (compact size, top-right corner over the image)
 *   - MakerDetail hero (medium size, alongside "Approved Maker" / "Plus")
 *   - ProductDetail maker block (medium size, under the maker name)
 *
 * The flag is a tiny inline SVG so it renders crisply on every device and
 * stays branded even on dark backgrounds. No external icon dependency.
 */
const FLAG_SVG = (
  <svg viewBox="0 0 19 10" aria-hidden="true" className="block w-full h-full">
    {/* 13 stripes (7 red + 6 white). 10 high → ~0.77 per stripe. */}
    {Array.from({ length: 13 }).map((_, i) => (
      <rect
        key={i}
        x="0"
        y={(i * 10) / 13}
        width="19"
        height={10 / 13}
        fill={i % 2 === 0 ? "#b22234" : "#ffffff"}
      />
    ))}
    {/* Canton — 7 stripes tall, 0.4 of the width */}
    <rect x="0" y="0" width="7.6" height={(7 * 10) / 13} fill="#3c3b6e" />
  </svg>
);

export default function VeteranBadge({ size = "sm", testId = "veteran-badge", className = "" }) {
  if (size === "compact") {
    // Tiny corner badge for product cards — flag-only, no text.
    return (
      <span
        className={`inline-flex items-center justify-center w-7 h-4 border border-white/60 shadow-md ${className}`}
        title="Veteran-Owned business"
        data-testid={testId}
      >
        {FLAG_SVG}
      </span>
    );
  }

  // Default: pill with flag + text label.
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 border border-[#b22234]/60 bg-[#b22234]/5 font-mono text-[10px] uppercase tracking-[0.22em] text-[#e5e5e5] ${className}`}
      title="Veteran-Owned business — supporting US veterans who make"
      data-testid={testId}
    >
      <span className="inline-block w-3.5 h-2 shrink-0">{FLAG_SVG}</span>
      Veteran-Owned
    </span>
  );
}
