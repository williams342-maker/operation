// iter413ct+ — Compass icon concepts (5 directions delivered by the
// design agent). NOT yet wired into HelpSupportWidget. Once a direction
// is chosen, swap the default export and replace <HelpCircle> in the
// widget — that's the whole rebrand surface.
//
// All 5 icons:
//   - 24×24 viewBox (drop-in replacement for lucide-react)
//   - currentColor stroke — inherit text color from parent
//   - 2px stroke, round caps/joins (matches lucide stroke weight)
//   - data-testid set per concept for the comparison preview
import React from "react";

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

export const CompassAbstract = ({ size = 24, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} data-testid="compass-icon-abstract">
    <rect x="5" y="5" width="14" height="14" rx="4" transform="rotate(45 12 12)" />
    <circle cx="12" cy="10" r="2" fill="currentColor" />
  </svg>
);

// Default = Abstract (design agent's recommendation — best embodies
// "evocative not literal"). Swap on user's final pick.
export const CompassIcon = CompassAbstract;
export default CompassIcon;
