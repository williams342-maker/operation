/**
 * QualityBadge — surfaces a community design file's "Bundle Quality
 * Score" (0-100) computed by the backend. Hover for a breakdown tooltip
 * that explains exactly which dimensions the bundle earned vs missed,
 * with concrete advice for each missed dimension. Designed to nudge
 * uploaders toward more useful bundles without scolding them.
 *
 * Tier styling matches the backend's threshold logic:
 *   ⭐ excellent (80+)  emerald
 *   ✦  good      (60-79) orange (brand)
 *      basic     (40-59) amber
 *   △  incomplete (<40)  red
 */
import React, { useState } from "react";
import { Star } from "lucide-react";

const TIER_META = {
  excellent:   { icon: "⭐", label: "Excellent", cls: "border-emerald-400/60 text-emerald-400 bg-emerald-400/10" },
  good:        { icon: "✦", label: "Good",      cls: "border-[#ff4500]/60 text-[#ff4500] bg-[#ff4500]/10" },
  basic:       { icon: "○", label: "Basic",     cls: "border-amber-400/60 text-amber-400 bg-amber-400/10" },
  incomplete:  { icon: "△", label: "Incomplete", cls: "border-red-500/60 text-red-400 bg-red-500/10" },
};

export default function QualityBadge({ quality, size = "sm", showTier = true }) {
  const [hover, setHover] = useState(false);
  if (!quality || quality.score == null) return null;
  const meta = TIER_META[quality.tier] || TIER_META.basic;
  const padding = size === "lg" ? "px-3 py-1.5" : "px-2 py-0.5";
  const scoreFont = size === "lg" ? "text-sm" : "text-[11px]";
  return (
    <div className="relative inline-flex" data-testid="quality-badge"
         onMouseEnter={() => setHover(true)}
         onMouseLeave={() => setHover(false)}>
      <span className={`inline-flex items-center gap-1.5 border ${padding} ${scoreFont} font-mono uppercase tracking-[0.18em] ${meta.cls}`}>
        <span aria-hidden="true">{meta.icon}</span>
        <span className="font-bold tracking-normal">{quality.score}</span>
        <span className="text-[10px] opacity-80">/100</span>
        {showTier && size === "lg" && <span className="ml-1 opacity-90">· {meta.label}</span>}
      </span>
      {hover && quality.breakdown?.length > 0 && (
        <div
          className="absolute z-30 top-full left-0 mt-1.5 w-72 bg-[#0a0a0a] border border-[#262626] p-3 shadow-2xl"
          data-testid="quality-tooltip"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mb-2">
            ◆ Bundle Quality · {meta.label}
          </div>
          <ul className="space-y-1.5">
            {quality.breakdown.map((b) => (
              <li key={b.label} className="font-mono text-[11px] flex gap-2 items-start">
                <span className={`shrink-0 inline-block w-3 ${b.earned ? "text-emerald-400" : "text-[#525252]"}`}>
                  {b.earned ? "✓" : "○"}
                </span>
                <span className="flex-1">
                  <span className={b.earned ? "text-[#e5e5e5]" : "text-[#a3a3a3]"}>
                    {b.label} <span className="text-[#525252]">+{b.points}</span>
                  </span>
                  {!b.earned && b.hint && (
                    <span className="block text-[10px] text-[#525252] leading-relaxed mt-0.5">
                      {b.hint}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
