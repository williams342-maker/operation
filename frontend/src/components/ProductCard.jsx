import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import VeteranBadge from "./VeteranBadge";
import useCountdown from "../hooks/useCountdown";
import { formatPriceDisplay, trackPricingLabelClick } from "../lib/variantPricing";

// Inline live "★ Featured · ends in Xh Ym" badge — only visible while
// `promoted_until` is in the future. Rendered as a sibling so the parent
// card stays a clean motion container.
function PromotedBadge({ until, slug }) {
  const { label, expired } = useCountdown({ target: until });
  if (expired) return null;
  return (
    <span
      className="tag absolute bottom-4 left-4 text-emerald-300 border-emerald-400 bg-black/70 inline-flex items-center gap-1.5"
      data-testid={`product-card-promoted-${slug}`}
    >
      <span>★ Featured</span>
      <span className="opacity-60">·</span>
      <span className="tabular-nums" data-testid={`product-card-promoted-countdown-${slug}`}>
        {label}
      </span>
    </span>
  );
}

export default function ProductCard({ p, i = 0 }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ delay: (i % 4) * 0.06, duration: 0.7 }}
      className="group relative bg-surface border border-line hover:border-brand transition-colors duration-500 overflow-hidden"
      data-testid={`product-card-${p.slug}`}
    >
      <Link to={`/shop/${p.slug}`} className="block" onClick={() => trackPricingLabelClick(p.slug)}>
        <div className="relative aspect-[4/5] overflow-hidden">
          <motion.img
            src={p.images?.[0]}
            // iter302 — denser alt text. ProductCard renders on every
            // shop / landing / category page, and Google Image Search
            // ranks alt text heavily. "Title — Category by Maker" gives
            // the crawler enough context to rank for compound queries.
            alt={[
              p.title,
              p.category ? `· ${p.category}` : "",
              p.maker_name ? `by ${p.maker_name}` : "",
            ].filter(Boolean).join(" ")}
            loading={i < 4 ? "eager" : "lazy"}
            decoding="async"
            // iter302 — camelCase prop name (React strict-mode warning
            // from iter299 testing). Browsers accept both; this just
            // silences the dev console warning without changing behavior.
            fetchPriority={i === 0 ? "high" : "auto"}
            className="absolute inset-0 w-full h-full object-cover media-img"
            whileHover={{ scale: 1.06 }}
            transition={{ duration: 0.9 }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <span className="tag absolute top-4 left-4 text-brand border-brand">{p.technique}</span>
          <span className="tag absolute top-4 right-4">{p.category}</span>
          {p.maker_is_veteran && (
            <VeteranBadge
              size="compact"
              className="absolute top-12 right-4"
              testId={`product-card-veteran-${p.slug}`}
            />
          )}
          {p.maker_is_plus && (
            <span
              className="tag absolute top-12 left-4 text-brand border-brand bg-black/70 inline-flex items-center gap-1 text-[9px]"
              data-testid={`product-card-plus-${p.slug}`}
              title="Crafters Plus maker"
            >
              ◆ PLUS
            </span>
          )}
          {p.promoted_until && new Date(p.promoted_until) > new Date() && (
            <PromotedBadge until={p.promoted_until} slug={p.slug} />
          )}
          {p.featured_example && (
            <span
              className="tag absolute bottom-4 left-4 text-amber-300 border-amber-400/70 bg-black/80 text-[9px]"
              data-testid={`product-card-featured-example-${p.slug}`}
              title="Platform showcase — example listing curated by Crafters Market"
            >
              ✦ FEATURED EXAMPLE
            </span>
          )}
          <div className="absolute bottom-4 right-4 flex items-end justify-end gap-3">
            <div className="font-display text-3xl text-white drop-shadow-md">{formatPriceDisplay(p)}</div>
            <div className="w-10 h-10 border border-white/40 group-hover:bg-brand group-hover:border-brand transition flex items-center justify-center">
              <ArrowUpRight size={18} className="text-white" />
            </div>
          </div>
        </div>
        <div className="p-4 md:p-5 border-t border-line">
          <h3 className="font-display text-lg md:text-xl lg:text-2xl mb-2 line-clamp-2">{p.title}</h3>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-muted">
            {p.dimensions || "Made to order"}
          </p>
          {/* iter318c — Trust strip: maker location · lead time ·
              customization. Each pill renders only if the underlying
              field is populated so we never show empty placeholders.
              Keeps the card scannable: buyer sees who/where/how-fast
              without opening the detail page. */}
          {(p.maker_location || p.lead_time_days || p.accepts_custom_orders) && (
            <div
              className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 font-mono text-[10px] text-ink-muted"
              data-testid={`product-card-trust-${p.slug}`}
            >
              {p.maker_location && (
                <span
                  className="inline-flex items-center gap-1"
                  data-testid={`product-card-location-${p.slug}`}
                >
                  <span className="text-ink-muted">◆</span>
                  {p.maker_location}
                </span>
              )}
              {p.lead_time_days != null && p.lead_time_days > 0 && (
                <span
                  className="inline-flex items-center gap-1"
                  data-testid={`product-card-lead-${p.slug}`}
                >
                  <span className="text-ink-muted">◆</span>
                  Ships in {p.lead_time_days}d
                </span>
              )}
              {p.accepts_custom_orders && (
                <span
                  className="inline-flex items-center gap-1 text-emerald-400"
                  data-testid={`product-card-custom-${p.slug}`}
                  title="Maker accepts custom-order briefs"
                >
                  <span>◆</span>
                  Custom orders
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
    </motion.article>
  );
}
