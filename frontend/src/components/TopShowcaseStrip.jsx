/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Eye } from "lucide-react";
import { fetchTopWeekShowcase, recordShowcaseClick } from "../lib/api";
import AuthorLabel from "./AuthorLabel";

/**
 * "Trending in the community" homepage strip — the 6 most-viewed
 * showcase pieces in the rolling 7-day window. Mirrors the look of
 * `RecentShowcaseStrip` (so the homepage feels cohesive) but adds:
 *   - 🔥 trending eyebrow + per-tile "👁 N this week" overlay
 *   - Self-hides when fewer than 2 posts qualify (quiet weeks shouldn't
 *     render a half-empty section)
 *   - Deep-links every tile to `/community#showcase-<id>` so the target
 *     card scrolls into view + pulses on landing
 *
 * Skeleton renders during the first paint so the homepage doesn't jump
 * once data arrives.
 */
const MIN_VISIBLE = 2;
const TILE_LIMIT = 6;

export default function TopShowcaseStrip({ testId = "top-showcase-strip" }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchTopWeekShowcase(TILE_LIMIT)
      .then((r) => {
        if (!cancelled) setItems(r.items || []);
      })
      .catch(() => {
        if (!cancelled) setItems([]); // silent fallback — never break homepage
      });
    return () => { cancelled = true; };
  }, []);

  // Skeleton (first paint)
  if (items === null) {
    return (
      <section
        className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-14"
        data-testid={`${testId}-loading`}
      >
        <header className="mb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#525252]">
            ◆ Trending this week
          </p>
          <h2 className="font-display text-3xl text-[#262626]">Most-viewed in the community.</h2>
        </header>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[...Array(TILE_LIMIT)].map((_, i) => (
            <div
              key={i}
              className="aspect-square bg-[#121212] border border-[#1a1a1a] animate-pulse"
            />
          ))}
        </div>
      </section>
    );
  }

  if (items.length < MIN_VISIBLE) return null;

  return (
    <section
      className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-14"
      data-testid={testId}
    >
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#ff4500] inline-flex items-center gap-1.5">
            <Flame size={12} /> Trending this week
          </p>
          <h2 className="font-display text-3xl text-[#e5e5e5]">Most-viewed in the community.</h2>
          <p className="font-mono text-xs text-[#a3a3a3] mt-1.5 max-w-xl">
            What buyers and makers actually clicked into over the last 7 days. Updated continuously.
          </p>
        </div>
        <Link
          to="/community"
          className="hidden md:inline-flex shrink-0 px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] transition"
          data-testid={`${testId}-view-all`}
        >
          View all →
        </Link>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {items.map((post, idx) => {
          const cover = (post.image_urls && post.image_urls[0]) || post.image_url;
          return (
            <Link
              key={post.id}
              to={`/community#showcase-${post.id}`}
              onClick={() => recordShowcaseClick(post.id, "home-trending")}
              className="group relative aspect-square bg-[#121212] border border-[#262626] hover:border-[#ff4500] overflow-hidden transition"
              data-testid={`${testId}-item-${post.id}`}
              title={post.title}
            >
              {cover ? (
                <img
                  src={cover}
                  alt={post.title}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition duration-700"
                />
              ) : (
                <div className="w-full h-full grid place-items-center font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
                  No image
                </div>
              )}

              {/* Rank chip — top-left, draws the eye to the #1 piece. */}
              <span
                className="absolute top-2 left-2 bg-[#0a0a0a]/85 border border-[#262626] text-[#ff4500] font-mono text-[9px] uppercase tracking-[0.18em] px-1.5 py-0.5 font-bold pointer-events-none"
                data-testid={`${testId}-rank-${post.id}`}
              >
                #{idx + 1}
              </span>

              {/* Weekly-view chip — top-right, justifies the ranking.
                  Hidden when the post is from the lifetime-views fallback
                  (no recent activity) so we don't badge a "0 this week". */}
              {post.views_this_week > 0 && (
                <span
                  className="absolute top-2 right-2 bg-[#ff4500]/90 text-[#0a0a0a] font-mono text-[9px] uppercase tracking-[0.18em] px-1.5 py-0.5 font-bold flex items-center gap-1 pointer-events-none"
                  data-testid={`${testId}-views-${post.id}`}
                >
                  <Eye size={9} /> {post.views_this_week}
                </span>
              )}

              {/* Reveal-on-hover meta */}
              <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-[#0a0a0a]/95 via-[#0a0a0a]/55 to-transparent opacity-0 group-hover:opacity-100 transition duration-300">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#ff4500] mb-0.5 truncate">
                  <AuthorLabel name={post.user_name} email="buyer" />
                </p>
                <p className="font-display text-base text-[#e5e5e5] leading-tight line-clamp-2">
                  {post.title}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
