/**
 * TrendingJournalRail — homepage editorial discovery surface
 *
 * Pulls the top-clicked journal posts from the last 14 days from
 * `/api/blog-trending`. Rendered above-the-fold-ish on the home page
 * (between the Reviews block and the Recent Showcase Strip) so a
 * first-time visitor instantly sees the human side of the marketplace
 * — not just product cards.
 *
 * Self-hides when the API returns an empty list (fresh deploy with no
 * posts yet, or an error). On a populated site, falls back to recency
 * via the backend so the rail is rarely empty.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, TrendingUp } from "lucide-react";
import { fetchTrendingPosts } from "../lib/api";

export default function TrendingJournalRail() {
  const [posts, setPosts] = useState(null);
  useEffect(() => {
    fetchTrendingPosts(4, 14).then(setPosts).catch(() => setPosts([]));
  }, []);

  // Initial load: don't render the section header to avoid a layout
  // shift then-collapse if the API errors. On confirmed-empty: hide
  // entirely so first-deploy doesn't show a sad empty rail.
  if (posts === null || posts.length === 0) return null;

  return (
    <section
      className="bg-[#0a0a0a] border-t border-b border-[#1a1a1a] py-20 md:py-24"
      data-testid="trending-journal-rail"
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-end justify-between gap-4 mb-10 flex-wrap">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#ff4500] mb-3 flex items-center gap-2">
              <TrendingUp size={12} /> Trending in the journal
            </div>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl uppercase leading-[0.95]">
              What makers<br />are writing.
            </h2>
          </div>
          <Link
            to="/journal"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition"
            data-testid="trending-journal-rail-all"
          >
            All entries <ArrowUpRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {posts.map((p, idx) => (
            <Link
              key={p.slug}
              to={`/journal/${p.slug}`}
              className="group block border border-[#1f1f1f] hover:border-[#ff4500] transition overflow-hidden bg-[#0d0d0d]"
              data-testid={`trending-journal-post-${p.slug}`}
            >
              <div className="aspect-[4/3] overflow-hidden bg-[#0a0a0a] relative">
                {p.cover ? (
                  <img
                    src={p.cover}
                    alt={p.title || "Crafters Market journal post"}
                    className="w-full h-full object-cover group-hover:scale-[1.04] transition duration-700"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-[#262626]">
                    <TrendingUp size={32} />
                  </div>
                )}
                {/* #1 / #2 / etc. badge — gives a "trending right now"
                    feel even when the actual ordering came from the
                    recency fallback. Only shown for the top 3 so it's
                    a genuine signal, not visual clutter. */}
                {idx < 3 && (
                  <div className="absolute top-3 left-3 bg-[#ff4500] text-black font-mono text-[10px] uppercase tracking-[0.22em] font-bold px-2 py-1">
                    #{idx + 1}
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-[#525252] mb-2 truncate">
                  {p.author} · {p.read_min || 4} min read
                </div>
                <h3 className="font-display text-base md:text-lg uppercase leading-tight group-hover:text-[#ff4500] transition mb-2 line-clamp-2">
                  {p.title}
                </h3>
                <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed line-clamp-3">
                  {p.excerpt}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
