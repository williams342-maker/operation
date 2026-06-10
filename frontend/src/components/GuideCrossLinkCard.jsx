import React from "react";
import { Link } from "react-router-dom";
import { BookOpen, ArrowRight } from "lucide-react";

/**
 * GuideCrossLinkCard (iter303 / Phase 4 Bundle C — PDP enhancement)
 * ----------------------------------------------------------------
 * Surfaces a contextual "Learn:" guide card on PDP based on the
 * product's technique + category. Every plasma/laser/router PDP becomes
 * a doorway to the educational guides, which:
 *   1. Compounds internal-link equity to the guide pages.
 *   2. Reduces buyer hesitation by answering "is this the right
 *      technique for my project?" before the brief.
 *   3. Gives Google a strong on-PDP topical signal for technique
 *      keywords ("plasma cutting", "laser engraving", etc.).
 *
 * Mapping priority (most-specific wins):
 *   • Outdoor-tagged + metal       → Metal Gauge & Finish Guide
 *   • Outdoor-tagged               → Outdoor Mounting Guide
 *   • Metal/steel material         → Metal Gauge & Finish Guide
 *   • PLASMA / LASER / ROUTER tech → Plasma vs Laser vs Router
 *   • Fallback                     → null (render nothing)
 */
const _hasAnyKeyword = (haystack, needles) => {
  const h = (haystack || "").toLowerCase();
  return needles.some((n) => h.includes(n));
};

export function pickGuideForProduct(product) {
  if (!product) return null;
  const tech = (product.technique || "").toUpperCase();
  const cat = product.category || "";
  const desc = product.description || "";
  const tags = (product.tags || []).join(" ");
  const haystack = `${cat} ${desc} ${tags}`;

  const isOutdoor = _hasAnyKeyword(haystack, [
    "outdoor", "weatherproof", "garden", "yard", "ranch", "exterior",
  ]);
  const isMetal = _hasAnyKeyword(haystack, [
    "steel", "metal", "aluminum", "copper", "brass", "iron",
  ]) || ["PLASMA", "LASER"].includes(tech);

  if (isOutdoor && isMetal) {
    return {
      slug: "metal-gauge-finish-guide",
      title: "Metal Gauge & Finish Guide",
      blurb: "Pick the right gauge and finish to handle your climate.",
    };
  }
  if (isOutdoor) {
    return {
      slug: "outdoor-mounting-guide",
      title: "Outdoor Mounting Guide",
      blurb: "Anchor, seal, and weatherproof your piece so it lasts.",
    };
  }
  if (isMetal) {
    return {
      slug: "metal-gauge-finish-guide",
      title: "Metal Gauge & Finish Guide",
      blurb: "Powder-coat vs raw patina, gauge sizing, finish systems.",
    };
  }
  if (["PLASMA", "LASER", "ROUTER", "CNC"].includes(tech)) {
    return {
      slug: "plasma-vs-laser-vs-router",
      title: "Plasma vs Laser vs Router",
      blurb: `Why ${tech.toLowerCase()} for this piece — and when each technique wins.`,
    };
  }
  return null;
}

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
