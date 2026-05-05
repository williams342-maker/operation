import React from "react";

/**
 * Shared <Section> wrapper used across Marketing tab modules.
 *
 * Matches the Financials/Help section styling so the tab visual
 * language stays consistent. Kept in its own file so each extracted
 * marketing module (AdsSection, DiscountCodes, AICopyTools, etc.)
 * can import without pulling in the parent MarketingTab.jsx.
 */
export default function Section({ title, testId, children }) {
  return (
    <section
      className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 md:p-6"
      data-testid={testId}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-3">
        ◆ {title}
      </div>
      {children}
    </section>
  );
}
