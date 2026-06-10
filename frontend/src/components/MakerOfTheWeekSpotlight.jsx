/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Eye, ArrowRight, Sparkles } from "lucide-react";
import { fetchMakerOfTheWeek } from "../lib/api";
import VeteranBadge from "./VeteranBadge";

/**
 * "Maker of the Week" homepage spotlight — automatically picks the
 * maker whose showcase pieces accumulated the most views in the rolling
 * 7-day window. When the week is too quiet, falls back to the all-time
 * most-viewed maker (so the spotlight is never empty during early
 * launch).
 *
 * Self-hides when the backend reports `maker: null` (no qualifying
 * makers at all). Always pairs the maker's portrait + name + technique
 * tags with their 3 best contributing pieces so viewers see exactly
 * why this maker earned the spotlight.
 *
 * Mounted on `/` between `<TopShowcaseStrip>` and `<RecentShowcaseStrip>`.
 */
export default function MakerOfTheWeekSpotlight({ testId = "maker-of-week" }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchMakerOfTheWeek()
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData({ maker: null }); });
    return () => { cancelled = true; };
  }, []);

  // Skeleton during first paint — same width as the loaded version so
  // the homepage doesn't jump.
  if (data === null) {
    return (
      <section
        className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-14"
        data-testid={`${testId}-loading`}
      >
        <div className="border border-line bg-surface p-6 md:p-8">
          <div className="grid md:grid-cols-[1fr_1.4fr] gap-8 items-start">
            <div className="space-y-3">
              <div className="h-4 w-32 bg-surface animate-pulse" />
              <div className="h-10 w-3/4 bg-surface animate-pulse" />
              <div className="h-3 w-full bg-surface animate-pulse" />
              <div className="h-3 w-5/6 bg-surface animate-pulse" />
              <div className="h-9 w-40 bg-surface animate-pulse mt-4" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="aspect-square bg-surface animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!data.maker) return null;

  const { maker, top_posts: topPosts, weekly_views: weeklyViews, mode } = data;
  // Visit the maker via their vanity URL when set (Plus perk) — falls
  // back to canonical slug.
  const profileUrl = `/makers/${maker.custom_url || maker.slug}`;
  const isTrending = mode === "trending";

  return (
    <section
      className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-14"
      data-testid={testId}
    >
      <header className="mb-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-brand inline-flex items-center gap-1.5">
          <Sparkles size={12} /> Maker of the week
        </p>
      </header>

      <div className="border-l-2 border-brand bg-gradient-to-r from-[#ff4500]/8 via-[#0d0d0d] to-[#0a0a0a] p-6 md:p-8">
        <div className="grid md:grid-cols-[1fr_1.4fr] gap-6 md:gap-10 items-start">
          {/* Maker introduction */}
          <div className="min-w-0">
            <Link
              to={profileUrl}
              className="inline-flex items-center gap-3 group"
              data-testid={`${testId}-maker-link`}
            >
              {maker.portrait ? (
                <img
                  src={maker.portrait}
                  alt={maker.name}
                  loading="lazy"
                  className="w-14 h-14 object-cover border border-line group-hover:border-brand transition"
                />
              ) : (
                <div className="w-14 h-14 grid place-items-center border border-line font-display text-xl text-ink-muted group-hover:border-brand transition">
                  {maker.initials || maker.name?.[0] || "M"}
                </div>
              )}
              <div className="min-w-0">
                <h3 className="font-display text-2xl md:text-3xl text-ink leading-tight group-hover:text-brand transition truncate">
                  {maker.name}
                </h3>
                {maker.location && (
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-0.5">
                    {maker.location}
                  </p>
                )}
              </div>
            </Link>

            {/* Badge row — veteran + Plus + technique tags */}
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              {maker.is_veteran_owned && (
                <VeteranBadge size="compact" testId={`${testId}-veteran`} />
              )}
              {maker.subscription_status === "active" && (
                <span className="tag text-brand border-brand text-[9px]">
                  ◆ PLUS
                </span>
              )}
              {(maker.techniques || []).slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="tag text-[10px] text-ink-muted border-line"
                >
                  {t}
                </span>
              ))}
            </div>

            {maker.bio && (
              <p className="font-mono text-xs text-ink-muted mt-4 leading-relaxed line-clamp-4">
                {maker.bio}
              </p>
            )}

            {isTrending && weeklyViews > 0 && (
              <p
                className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand mt-4 inline-flex items-center gap-1.5"
                data-testid={`${testId}-weekly-views`}
              >
                <Flame size={12} /> {weeklyViews.toLocaleString()} views this week
              </p>
            )}

            <Link
              to={profileUrl}
              className="btn-industrial btn-primary mt-5 inline-flex items-center gap-2 text-xs"
              data-testid={`${testId}-cta`}
            >
              Visit shop <ArrowRight size={14} />
            </Link>
          </div>

          {/* Top 3 contributing pieces */}
          <div className="grid grid-cols-3 gap-2 md:gap-3 min-w-0">
            {topPosts.length === 0 ? (
              <div className="col-span-3 font-mono text-xs text-ink-muted italic">
                No public pieces yet from this maker.
              </div>
            ) : (
              topPosts.map((p) => {
                const cover = (p.image_urls && p.image_urls[0]) || p.image_url;
                return (
                  <Link
                    key={p.id}
                    to={`/community#showcase-${p.id}`}
                    className="group relative aspect-square bg-surface border border-line hover:border-brand overflow-hidden transition"
                    data-testid={`${testId}-post-${p.id}`}
                    title={p.title}
                  >
                    {cover ? (
                      <img
                        src={cover}
                        alt={p.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                      />
                    ) : (
                      <div className="w-full h-full grid place-items-center font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
                        No image
                      </div>
                    )}
                    {/* Lifetime view chip — always shown so the homepage
                        visitor sees concrete "popularity" evidence. */}
                    <span className="absolute bottom-1.5 left-1.5 bg-paper/85 border border-line text-ink-muted font-mono text-[9px] px-1.5 py-0.5 flex items-center gap-1 pointer-events-none">
                      <Eye size={9} /> {p.views || 0}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
