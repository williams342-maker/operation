/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Wrench, ArrowRight } from "lucide-react";
import { fetchRecentShowcase } from "../../lib/api";

/**
 * "Built in Real Workshops" homepage section — the antidote to
 * polished-but-fake product photography on big marketplaces. Pulls 4
 * maker-authored showcase posts (process shots: welding sparks, plasma
 * cuts, lathe turnings, work-in-progress photos) and arranges them as
 * a wide mosaic with the marketing message overlaid.
 *
 * Server-side filter (`only_makers=true`) returns just maker-authored
 * posts so we don't accidentally surface buyer photos here — those
 * belong in the "Recent from the community" rail.
 *
 * Self-hides when fewer than 2 maker posts qualify so we never render
 * a half-empty section. Skeleton during first paint.
 */
export default function BuiltInRealWorkshops({ testId = "real-workshops" }) {
  const [posts, setPosts] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchRecentShowcase({ limit: 4, only_makers: true })
      .then((r) => { if (!cancelled) setPosts(r?.items || []); })
      .catch(() => { if (!cancelled) setPosts([]); });
    return () => { cancelled = true; };
  }, []);

  if (posts === null) {
    return (
      <section
        className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-14"
        data-testid={`${testId}-loading`}
      >
        <div className="grid md:grid-cols-[1fr_1.6fr] gap-8 items-stretch">
          <div className="space-y-3">
            <div className="h-4 w-40 bg-[#1a1a1a] animate-pulse" />
            <div className="h-12 w-3/4 bg-[#1a1a1a] animate-pulse" />
            <div className="h-3 w-full bg-[#1a1a1a] animate-pulse" />
            <div className="h-3 w-5/6 bg-[#1a1a1a] animate-pulse" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="aspect-[4/3] bg-[#1a1a1a] animate-pulse" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (posts.length < 2) return null;

  return (
    <section
      className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-14 md:py-20"
      data-testid={testId}
    >
      <div className="grid md:grid-cols-[1fr_1.6fr] gap-8 md:gap-14 items-stretch">
        {/* Copy column */}
        <div className="flex flex-col justify-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#ff4500] inline-flex items-center gap-1.5">
            <Wrench size={12} /> Behind the build
          </p>
          <h2 className="font-display text-4xl md:text-5xl text-[#e5e5e5] mt-3 leading-[0.95]">
            Built in <span className="text-[#ff4500]">real workshops.</span>
          </h2>
          <p className="font-mono text-xs md:text-sm text-[#a3a3a3] mt-5 leading-relaxed max-w-md">
            Sparks flying off plasma cuts. Wood shavings on the bench. Welding
            spatter on the floor. These aren't staged product shots — they're
            the actual workshops where your order will be made.
          </p>
          <p className="font-mono text-xs md:text-sm text-[#a3a3a3] mt-4 leading-relaxed max-w-md">
            From raw steel to finished art, every piece on Crafters Market
            passes through one of these benches.
          </p>
          <Link
            to="/community"
            className="mt-7 inline-flex items-center gap-2 self-start btn-industrial btn-primary text-xs"
            data-testid={`${testId}-cta`}
          >
            See every workshop <ArrowRight size={14} />
          </Link>
        </div>

        {/* Mosaic */}
        <div className="grid grid-cols-2 gap-2 md:gap-3 min-w-0">
          {posts.slice(0, 4).map((p) => {
            const cover = (p.image_urls && p.image_urls[0]) || p.image_url;
            // iter280 — Backend may supplement maker showcase posts with
            // product-catalog covers (rows where `source === "product_fallback"`,
            // id prefixed with "prod:"). Deep-link those tiles to the
            // actual product page so the click goes somewhere meaningful
            // — not a broken `/community#showcase-prod:slug` anchor.
            const isProductFallback = p.source === "product_fallback" || (p.id || "").startsWith("prod:");
            const href = isProductFallback
              ? `/shop/${p.product_slug || (p.id || "").replace(/^prod:/, "")}`
              : `/community#showcase-${p.id}`;
            return (
              <Link
                key={p.id}
                to={href}
                className="group relative aspect-[4/3] bg-[#121212] border border-[#262626] hover:border-[#ff4500] overflow-hidden transition"
                data-testid={`${testId}-tile-${p.id}`}
                title={p.title}
              >
                {cover ? (
                  <img
                    src={cover}
                    alt={p.title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-700"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center font-mono text-[10px] text-[#525252]">
                    No image
                  </div>
                )}
                {/* Maker attribution chip on hover */}
                {(p.user_name || p.maker_slug) && (
                  <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-[#0a0a0a]/95 via-[#0a0a0a]/40 to-transparent opacity-0 group-hover:opacity-100 transition">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#ff4500]">
                      {p.user_name || p.maker_slug}
                    </p>
                    <p className="font-mono text-xs text-[#e5e5e5] mt-0.5 line-clamp-1">
                      {p.title}
                    </p>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
