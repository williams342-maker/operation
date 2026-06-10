import React from "react";
import { Link } from "react-router-dom";
import { Wrench, ArrowRight } from "lucide-react";

/**
 * Reusable "Need something different? Commission custom work" CTA.
 * Lives at the bottom of product pages, maker pages, search-result
 * empty states, and anywhere the buyer might be thinking "this is
 * close but not quite right".
 *
 * Props:
 *   • makerSlug — preselects the maker on the custom-order form so the
 *                 brief is routed to them directly. Optional.
 *   • headline — override the default copy for context-specific spots.
 *   • subhead  — override the default subline.
 *   • compact  — render as a single-row banner instead of a 2-col card.
 */
export default function CustomOrderCTA({
  makerSlug,
  headline,
  subhead,
  compact = false,
  testId = "custom-order-cta",
}) {
  const href = makerSlug
    ? `/custom-order?maker=${encodeURIComponent(makerSlug)}`
    : "/custom-order";

  const defaultHeadline = makerSlug
    ? "Want something different? Commission this maker directly."
    : "Need something personalized?";
  const defaultSubhead = makerSlug
    ? "Send a brief with your size, material, and message — most makers reply within 24 hours."
    : "Connect directly with American makers to commission one-of-a-kind custom pieces. Built to your spec, never warehoused.";

  if (compact) {
    return (
      <Link
        to={href}
        className="block w-full border border-brand/40 bg-brand/5 hover:bg-brand/10 px-4 py-3 transition group"
        data-testid={testId}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Wrench size={14} className="text-brand shrink-0" />
            <span className="font-mono text-xs text-ink truncate">
              {headline || defaultHeadline}
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand inline-flex items-center gap-1 shrink-0">
            Start brief <ArrowRight size={12} />
          </span>
        </div>
      </Link>
    );
  }

  return (
    <section
      className="border-l-2 border-brand bg-gradient-to-r from-[#ff4500]/8 via-[#0d0d0d] to-[#0a0a0a] p-6 md:p-8"
      data-testid={testId}
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand inline-flex items-center gap-1.5 mb-2">
            <Wrench size={12} /> Custom Orders
          </div>
          <h3 className="font-display text-xl md:text-2xl text-ink leading-tight">
            {headline || defaultHeadline}
          </h3>
          <p className="font-mono text-xs text-ink-muted mt-2 max-w-xl leading-relaxed">
            {subhead || defaultSubhead}
          </p>
        </div>
        <Link
          to={href}
          className="btn-industrial btn-primary inline-flex items-center justify-center gap-2 text-xs shrink-0 self-start md:self-auto"
          data-testid={`${testId}-cta`}
        >
          Start a custom order <ArrowRight size={14} />
        </Link>
      </div>
    </section>
  );
}
