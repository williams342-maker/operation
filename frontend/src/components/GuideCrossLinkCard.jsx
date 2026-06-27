import React from "react";
import { Link } from "react-router-dom";
import { BookOpen, ArrowRight } from "lucide-react";
import { pickGuideForProduct as _pickFromRegistry } from "../lib/productGuides";

/**
 * GuideCrossLinkCard (iter303 / iter413cp)
 * ----------------------------------------------------------------
 * Surfaces a contextual "Learn:" guide card on the PDP. The matching
 * logic now lives in `lib/productGuides.js` — a configurable registry
 * with category eligibility + exclusion + keyword gates. This was
 * refactored after Loretta's feedback that the Outdoor Mounting Guide
 * was appearing on indoor fiber artwork because the old keyword-only
 * matcher had no category guard.
 *
 * Kept the named export `pickGuideForProduct` for backwards-compat
 * with any tests / surfaces that imported it directly.
 */
export const pickGuideForProduct = _pickFromRegistry;

export default function GuideCrossLinkCard({ product }) {
  const guide = pickGuideForProduct(product);
  if (!guide) return null;
  return (
    <Link
      to={`/guides/${guide.slug}`}
      className="group block border border-line hover:border-brand bg-paper p-5 transition mb-8"
      data-testid={`pdp-guide-cross-link-${guide.slug}`}
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-10 h-10 border border-line grid place-items-center group-hover:border-brand group-hover:bg-brand/5 transition">
          <BookOpen size={16} className="text-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-1">
            ◆ Learn the technique
          </div>
          <div className="font-display text-xl mb-1 group-hover:text-brand transition">
            {guide.title}
          </div>
          <p className="font-mono text-[11px] text-ink-muted leading-relaxed">
            {guide.blurb}
          </p>
        </div>
        <ArrowRight
          size={18}
          className="shrink-0 text-ink-muted group-hover:text-brand group-hover:translate-x-1 transition"
        />
      </div>
    </Link>
  );
}
