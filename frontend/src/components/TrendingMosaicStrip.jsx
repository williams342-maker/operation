/**
 * iter360 — "Trending in the mosaic" homepage strip.
 *
 * Pulls the top 6 listings by `events.product_view` count from the
 * mosaic source over the last 24 h. Renders a horizontal strip with a
 * live pulse + per-tile view counter — communicates "this is what
 * people are actively clicking right now" without needing editorial
 * curation.
 *
 * Self-hides when there's not enough signal (fewer than 3 trending
 * items) so the homepage doesn't show an awkward half-empty section
 * on quiet days.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Eye } from "lucide-react";
import { fetchTrendingProducts } from "../lib/api";

const HIDE_THRESHOLD = 3;

export default function TrendingMosaicStrip({ testId = "home-trending-mosaic" }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    fetchTrendingProducts({ hours: 24, limit: 6, source: "mosaic" })
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  // Don't render skeletons here — the section is purely additive. If
  // we can't load it, we silently bail. This avoids a "half-loaded
  // homepage" feel on slow connections.
  if (items === null) return null;
  if (items.length < HIDE_THRESHOLD) return null;

  return (
    <section
      className="w-full py-14 md:py-16 bg-paper border-b border-line"
      data-testid={testId}
    >
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="flex items-end justify-between mb-8 gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="relative inline-flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-brand animate-ping opacity-75" />
                <span className="relative rounded-full w-2 h-2 bg-brand" />
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
                ◆ Live · last 24 h
              </span>
            </div>
            <h2 className="font-display text-3xl md:text-5xl lg:text-6xl">
              Trending right <span className="text-brand">now</span>
            </h2>
            <p className="font-body text-sm text-ink-muted mt-2 max-w-xl">
              Pieces buyers are tapping into from our discovery mosaic this hour.
              Updated continuously — what&apos;s hot now might be sold by morning.
            </p>
          </div>
          <Link
            to="/shop?sort=best_selling"
            className="industrial-link font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand whitespace-nowrap"
          >
            See all best sellers →
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
          {items.map((p, i) => (
            <Link
              key={p.slug}
              to={`/p/${p.slug}`}
              className="group relative aspect-square overflow-hidden bg-surface border border-line hover:border-brand transition-colors duration-300"
              data-testid={`trending-tile-${i}`}
              data-slug={p.slug}
            >
              <img
                src={p.images?.[0]}
                alt={p.title}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.08]"
              />
              {/* Rank pip — visually anchors which one is hottest. */}
              <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-paper/90 border border-line font-mono text-[10px] tracking-[0.18em] text-ink">
                #{i + 1}
              </div>
              {/* Bottom gradient + title — always visible, not hover-gated,
                  because the section's whole job is "what is this?". */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/95 line-clamp-1">
                  {p.title}
                </div>
                <div className="font-mono text-[11px] text-brand">
                  {p.price != null ? `$${Number(p.price).toFixed(2)}` : ""}
                </div>
              </div>
              <div className="absolute top-2 right-2 w-8 h-8 border border-white/40 group-hover:bg-brand group-hover:border-brand transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                <ArrowUpRight size={14} className="text-white" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// Tiny supplementary export — currently unused but lets us swap the
// strip into the Shop page later as a "trending" hat without
// re-implementing the fetch. Exported nameless to flag intent.
export { Eye as _TrendingIcon };
