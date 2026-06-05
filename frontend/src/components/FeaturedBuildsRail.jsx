/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { fetchProducts } from "../lib/api";
import { formatPriceDisplay } from "../lib/variantPricing";

/**
 * Homepage "Featured Builds" hero strip.
 *
 * Sits directly under <Hero /> so the very first thing visitors see below
 * the fold is a curated, high-craftsmanship product rail — turns the
 * gorgeous Nano Banana seed imagery into a conversion engine instead of
 * letting it sit buried in category pages.
 *
 * Differs from <ProductRail> in three meaningful ways:
 *   1. Amber treatment + ✦ icon to match the same "Featured Example /
 *      Founding Maker" transparency theming used on cards + maker pages.
 *   2. Single inline transparency disclosure ("Curated examples while
 *      makers grow our catalog") so we don't need to badge each card
 *      twice — the eyebrow + footer line cover it.
 *   3. Built-in curation: only `featured_example=true` rows are fetched,
 *      then ordered by an internal CURATED_SLUGS allow-list so the 6
 *      strongest builds always lead (river table, fire pit, shadow box,
 *      Edison lamp, butcher block, weather vane).
 *
 * Self-hides when fewer than 3 results — production with no seeded
 * content (or a post-purge state) should never render an empty strip.
 */

// Curated order — strongest visual + clearest craftsmanship story first.
// Slugs not in this list still appear, ordered after the curated ones by
// the API's existing recency sort. We hard-code the leaders so the rail
// looks the same on every load (no flicker, no surprise weak photos).
const CURATED_SLUGS = [
  "fe-walnut-epoxy-river-table",
  "fe-cor-ten-fire-pit",
  "fe-steel-veterans-shadow-box",
  "fe-edison-bulb-pipe-lamp",
  "fe-end-grain-butcher-block",
  "fe-copper-weather-vane",
];

export default function FeaturedBuildsRail({ testId = "home-featured-builds" }) {
  const [items, setItems] = useState([]);
  const ref = useRef(null);

  useEffect(() => {
    fetchProducts({ featured_example: true })
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch(() => setItems([]));
  }, []);

  // Surface curated slugs first, then anything else. Cap at 8 so the rail
  // never gets unwieldy — visitors who want more click "View all examples".
  const ordered = useMemo(() => {
    if (!items.length) return [];
    const bySlug = new Map(items.map((p) => [p.slug, p]));
    const head = CURATED_SLUGS.map((s) => bySlug.get(s)).filter(Boolean);
    const headSet = new Set(head.map((p) => p.slug));
    const tail = items.filter((p) => !headSet.has(p.slug));
    return [...head, ...tail].slice(0, 8);
  }, [items]);

  const scroll = (dir) => {
    const el = ref.current; if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  if (ordered.length < 3) return null;
  return (
    <section
      className="relative w-full py-16 md:py-20 overflow-hidden bg-[#0a0705] border-b border-amber-900/30"
      data-testid={testId}
    >
      {/* Ambient stage lighting — one warm orb top-right, one cool amber bottom-left */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-[15%] right-[5%] w-[600px] h-[600px] copper-glow opacity-50" />
        <div className="absolute bottom-[10%] left-[8%] w-[400px] h-[400px] copper-glow copper-glow-warm opacity-30" />
      </div>
      <div className="absolute inset-0 blueprint-grid opacity-40 pointer-events-none" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="flex items-end justify-between mb-3 gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.32em] text-amber-400 mb-3 inline-flex items-center gap-2">
              <span className="inline-block w-6 h-px bg-amber-400" />
              <Sparkles size={12} className="text-amber-400" />
              Featured Builds · Platform Showcase
            </div>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl tracking-tighter">
              Built to set the bar.
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => scroll(-1)} aria-label="Scroll left"
              data-testid={`${testId}-scroll-left`}
              className="hidden md:inline-flex w-10 h-10 border border-amber-700/60 hover:border-amber-400 hover:text-amber-300 hover:bg-amber-500/10 items-center justify-center transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => scroll(1)} aria-label="Scroll right"
              data-testid={`${testId}-scroll-right`}
              className="hidden md:inline-flex w-10 h-10 border border-amber-700/60 hover:border-amber-400 hover:text-amber-300 hover:bg-amber-500/10 items-center justify-center transition-colors"
            >
              <ChevronRight size={18} />
            </button>
            <Link
              to="/shop?featured=examples"
              data-testid={`${testId}-view-all`}
              className="industrial-link font-mono text-[11px] uppercase tracking-[0.22em] text-amber-300 hover:text-amber-100 whitespace-nowrap"
            >
              View all examples →
            </Link>
          </div>
        </div>

        <p className="font-mono text-[11px] text-zinc-400 mb-8 max-w-2xl leading-relaxed">
          ✦ Curated examples while our maker catalog grows. Every build here
          is staged by the Crafters Market workshop team — not for sale yet,
          just to show what's possible. Listings from real makers fill the
          rest of the shop.
        </p>

        <div
          ref={ref}
          className="flex gap-5 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0"
        >
          {ordered.map((p, i) => (
            <motion.article
              key={p.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.1 }}
              transition={{ delay: (i % 4) * 0.08, duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
              className="cinematic-frame snap-start flex-shrink-0 w-[280px] md:w-[340px] group"
              data-testid={`featured-build-${p.slug}`}
            >
              <Link to={`/shop/${p.slug}`} className="block">
                <div className="relative aspect-[4/5] overflow-hidden">
                  <img
                    src={p.images?.[0]}
                    alt={p.title}
                    className="absolute inset-0 w-full h-full object-cover workshop-tone group-hover:scale-[1.06] group-hover:filter-none transition-all duration-[900ms] ease-out"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                  <div className="absolute inset-0 cinematic-vignette pointer-events-none opacity-60" />
                  <span className="absolute top-3 left-3 px-2 py-1 bg-amber-500 text-black font-mono text-[9px] uppercase tracking-[0.28em] font-bold">
                    ✦ Example
                  </span>
                  <span className="absolute top-3 right-3 px-2 py-1 bg-black/70 backdrop-blur-sm border border-[#ff4500]/60 text-[#ff4500] font-mono text-[9px] uppercase tracking-[0.22em]">
                    {p.technique}
                  </span>
                  <div className="absolute bottom-3 right-3 w-10 h-10 border border-amber-300/60 bg-black/40 backdrop-blur-sm group-hover:bg-amber-500 group-hover:border-amber-500 transition-colors flex items-center justify-center">
                    <ArrowUpRight size={16} className="text-white" />
                  </div>
                </div>
                <div className="relative z-10 p-5">
                  <div className="font-display text-xl md:text-2xl mb-1 line-clamp-2 min-h-[3rem] tracking-tight">{p.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500 mb-3 line-clamp-1">
                    {p.category}
                  </div>
                  <div className="flex items-end justify-between">
                    <div className="font-display text-2xl text-amber-300 tracking-tight">{formatPriceDisplay(p)}</div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
                      reference price
                    </div>
                  </div>
                </div>
              </Link>
              {/* Lead-gen CTA — turns the visual example into a commission funnel. */}
              <Link
                to={`/custom-order?ref=${encodeURIComponent(p.slug)}`}
                onClick={(e) => e.stopPropagation()}
                className="relative z-10 block border-t border-amber-900/50 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300 hover:bg-amber-500/15 hover:text-amber-100 transition-colors inline-flex items-center justify-between w-full"
                data-testid={`featured-build-commission-${p.slug}`}
              >
                <span>◆ Inspired? Commission a real maker</span>
                <ArrowUpRight size={12} />
              </Link>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
