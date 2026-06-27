// iter413cu — Compass · final brand mark.
//
// Direction: rotated rounded square + directional inner mark (small
// upward-pointing triangle in lieu of a plain dot — reads as a
// navigation marker without becoming literally a compass).
//
// Refinement notes from the iter413ct preview round:
//   • Stroke trimmed from 2.0 → 1.75 for crisper rendering at 16px.
//   • Inner dot replaced with a small upward triangle whose apex
//     sits slightly above optical centre — gives subtle "pointing"
//     direction so the mark is unmistakably "Compass" not generic.
//   • Triangle is filled (not stroked) so it stays a solid visual
//     anchor at every size without thin lines clogging at 16px.
//   • Corner radius tuned to 4 — softens the corners while preserving
//     the diamond silhouette at small sizes.
//
// Keep the alternate concepts available for documentation / future
// experimentation — they don't ship anywhere by default.
import React from "react";

// ── Final brand mark ─────────────────────────────────────────────────
export const CompassIcon = ({ size = 24, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    data-testid="compass-icon"
    aria-hidden="true"
  >
    {/* Rotated rounded square — diamond silhouette */}
    <rect x="5" y="5" width="14" height="14" rx="4" transform="rotate(45 12 12)" />
    {/* Directional inner mark — small filled upward triangle. Apex
        sits at y=8.5 (slightly above optical centre) so the mark
        feels like it's pointing somewhere. Base at y=11.5. */}
    <path d="M12 8.5 L13.7 11.5 L10.3 11.5 Z" fill="currentColor" stroke="none" />
  </svg>
);

// ── Brand lockup ─────────────────────────────────────────────────────
// Per user direction (year 1 brand-building): default to showing
// `◈ Compass` (icon + wordmark) wherever possible so users learn the
// pairing before relying on the icon standalone.
//
// Props:
//   size — icon px (default 20, sized to match adjacent text weight)
//   subtitle — when truthy, renders the muted "Your Marketplace
//              Assistant" line under the wordmark
//   align — "row" (inline) or "stack" (icon-left + wordmark stacked)
export const CompassLockup = ({
  size = 20,
  subtitle = false,
  align = "row",
  className = "",
}) => {
  if (align === "stack") {
    return (
      <div className={`flex items-center gap-2 ${className}`} data-testid="compass-lockup">
        <CompassIcon size={size} className="text-[var(--brand)] shrink-0" />
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--brand)] leading-tight">
            Compass
          </div>
          {subtitle && (
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-muted)] leading-tight">
              Your Marketplace Assistant
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} data-testid="compass-lockup">
      <CompassIcon size={size} className="text-[var(--brand)]" />
      <span className="font-mono text-sm text-[var(--ink)] tracking-tight">
        Compass
        {subtitle && (
          <span className="text-[var(--ink-muted)] font-normal ml-1">
            · Your Marketplace Assistant
          </span>
        )}
      </span>
    </span>
  );
};

// ── Alternate concepts (kept for the /admin/compass-preview gallery
// and any future experimentation; NOT used in production) ───────────
export const CompassNeedle = ({ size = 24, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} data-testid="compass-icon-needle">
    <path d="M12 2L15.5 12L12 22L8.5 12L12 2Z" />
    <line x1="12" y1="2" x2="12" y2="22" />
  </svg>
);

export const CompassStar = ({ size = 24, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} data-testid="compass-icon-star">
    <path d="M12 2C12 2 13 10 22 12C13 14 12 22 12 22C12 22 11 14 2 12C11 10 12 2 12 2Z" />
  </svg>
);

export const CompassPin = ({ size = 24, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} data-testid="compass-icon-pin">
    <path d="M12 2C8.134 2 5 5.134 5 9C5 14 12 22 12 22C12 22 19 14 19 9C19 5.134 15.866 2 12 2Z" />
    <path d="M12 6L14.5 9.5L12 13L9.5 9.5L12 6Z" />
  </svg>
);

export const CompassCraft = ({ size = 24, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} data-testid="compass-icon-craft">
    <path d="M12 3L18 12L12 21L6 12L12 3Z" />
    <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="3 3" />
    <line x1="6" y1="12" x2="18" y2="12" strokeDasharray="3 3" />
  </svg>
);

// Designer-pick alias kept so the preview gallery doesn't break.
// CompassAbstract = the LATEST production mark.
export const CompassAbstract = CompassIcon;

export default CompassIcon;
