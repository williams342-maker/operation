import React from "react";

/**
 * FounderBadge / BetaTesterBadge
 * --------------------------------
 * Two related but distinct trust signals that surface on a maker's
 * shop page, product cards, and seller dashboard.
 *
 * - FounderBadge: shown for every maker with `tier === "founder"`.
 *   Adds the ◆ Founding Maker · #042 number when supplied.
 *
 * - BetaTesterBadge: shown ONLY for the original beta cohort (the 5
 *   makers who tested the staging site pre-launch). Stacks with
 *   FounderBadge as a dual-badge combo.
 *
 * Both render as compact monospace pills in the same family as the
 * existing VeteranBadge so they sit cleanly side-by-side on a hero
 * row without competing for attention.
 */

export function FounderBadge({ number, testId = "founder-badge", className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border border-brand/50 bg-brand/10 text-[#ff7a45] px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] font-mono ${className}`}
      data-testid={testId}
      title={
        number
          ? `Founding Maker #${String(number).padStart(3, "0")} · CraftersMarket`
          : "Founding Maker — one of the inaugural makers on CraftersMarket"
      }
    >
      <span aria-hidden="true">◆</span>
      <span>Founding Maker{number ? ` #${String(number).padStart(3, "0")}` : ""}</span>
    </span>
  );
}

export function BetaTesterBadge({ testId = "beta-tester-badge", className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border border-emerald-500/50 bg-emerald-500/10 text-emerald-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] font-mono ${className}`}
      data-testid={testId}
      title="Founding Access Member — helped shape CraftersMarket before launch"
    >
      <span aria-hidden="true">◆</span>
      <span>Founding Access</span>
    </span>
  );
}

export default FounderBadge;
