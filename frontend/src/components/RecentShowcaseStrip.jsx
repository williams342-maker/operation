/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchRecentShowcase, recordShowcaseView, recordShowcaseClick,
} from "../lib/api";

// iter116 — "Recently shared" strip.
//
// A discovery surface for Community Showcase posts that lives OUTSIDE
// the /community tab. Two consumers:
//   1. Homepage — generic feed, latest 4 posts site-wide.
//   2. Product detail page — feed scoped to that product's slug, with
//      a graceful fall-back to maker-tagged posts and finally site-wide
//      so a brand-new product without showcase posts never renders an
//      empty strip.
//
// Self-hides when the API returns 0 items so we never render a hollow
// section header on a quiet page.

export default function RecentShowcaseStrip({
  productSlug,
  makerSlug,
  limit = 4,
  title = "Recently shared by buyers",
  eyebrow = "◆ Community",
  testId = "recent-showcase-strip",
  source,  // iter117 — surface tag passed through to analytics events
  strict = false,  // when true, never fall back to global newest-first
}) {
  const [items, setItems] = useState(null); // null = loading
  // iter117 — per-session view dedup (defense in depth on top of the
  // backend's IP+UA dedup window). Keeps a refresh from showing as
  // double-views in the dashboard.
  const viewedRef = useRef(new Set());

  // Resolve a sensible default `source` tag from the props so callers
  // who forgot to pass one still get attribution data.
  const resolvedSource = source || (productSlug ? "product" : (makerSlug ? "maker" : "home"));

  useEffect(() => {
    let cancelled = false;
    fetchRecentShowcase({ product_slug: productSlug, maker_slug: makerSlug, limit, strict })
      .then((r) => {
        if (!cancelled) setItems(r.items || []);
      })
      .catch(() => {
        if (!cancelled) setItems([]); // fail silent — don't break the host page
      });
    return () => { cancelled = true; };
  }, [productSlug, makerSlug, limit, strict]);

  // iter117 — Once items land, fire one view event per post (per-session
  // dedupe). We use IntersectionObserver where available so views only
  // log when the strip actually scrolls into view (a homepage hero
  // dominates above-the-fold; tracking unseen views inflates the data).
  useEffect(() => {
    if (!items || !items.length || typeof window === "undefined") return;

    const fireView = (postId) => {
      const key = `${postId}:${resolvedSource}`;
      if (viewedRef.current.has(key)) return;
      viewedRef.current.add(key);
      recordShowcaseView(postId, resolvedSource);
    };

    if (typeof IntersectionObserver === "undefined") {
      // Older browser — just count all loaded posts as viewed.
      items.forEach((p) => fireView(p.id));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && e.target.dataset.postId) {
            fireView(e.target.dataset.postId);
          }
        });
      },
      { threshold: 0.5 },  // half the tile in view = "really seen"
    );
    document
      .querySelectorAll(`[data-strip-id="${testId}"] [data-post-id]`)
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items, testId, resolvedSource]);

  // Skeleton on first load — prevents the page from "jumping" once items land.
  if (items === null) {
    return (
      <section className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-14" data-testid={`${testId}-loading`}>
        <header className="mb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#525252]">{eyebrow}</p>
          <h2 className="font-display text-3xl text-[#262626]">{title}</h2>
        </header>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(limit)].map((_, i) => (
            <div key={i} className="aspect-square bg-[#121212] border border-[#1a1a1a]" />
          ))}
        </div>
      </section>
    );
  }

  if (!items.length) return null;

  return (
    <section
      className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-14"
      data-testid={testId}
      data-strip-id={testId}
    >
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#ff4500]">{eyebrow}</p>
          <h2 className="font-display text-3xl text-[#e5e5e5]">{title}</h2>
          <p className="font-mono text-xs text-[#a3a3a3] mt-1.5 max-w-xl">
            Real installs from real buyers. No staged photos, no marketing — just where the pieces ended up.
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map((post) => {
          const cover = (post.image_urls && post.image_urls[0]) || post.image_url;
          const extra = Math.max(0, ((post.image_urls || []).length) - 1);
          return (
            <Link
              key={post.id}
              to={`/community#post-${post.id}`}
              onClick={() => recordShowcaseClick(post.id, resolvedSource)}
              data-post-id={post.id}
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

              {/* Bottom gradient + meta — appears on hover so the cards
                  read as a clean tile on first paint and reveal context
                  on intent. */}
              <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-[#0a0a0a]/95 via-[#0a0a0a]/55 to-transparent opacity-0 group-hover:opacity-100 transition duration-300">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#ff4500] mb-0.5 truncate">
                  {post.user_name || "buyer"}
                </p>
                <p className="font-display text-base text-[#e5e5e5] leading-tight line-clamp-2">
                  {post.title}
                </p>
              </div>

              {post.video_url && (
                <span
                  className="absolute top-2 left-2 bg-[#ff4500] text-[#0a0a0a] font-mono text-[8px] uppercase tracking-[0.18em] px-1.5 py-0.5 font-bold"
                  data-testid={`${testId}-video-${post.id}`}
                >
                  ◆ Video
                </span>
              )}
              {/* iter237 — AI provenance badge on Maker-Studio designs.
                  Cyan to match the /studio nav accent. */}
              {post.source === "maker_studio_ai" && (
                <span
                  className="absolute top-2 left-2 bg-[#00ffff] text-[#0a0a0a] font-mono text-[8px] uppercase tracking-[0.18em] px-1.5 py-0.5 font-bold"
                  data-testid={`${testId}-ai-${post.id}`}
                >
                  ◆ AI · Studio
                </span>
              )}
              {extra > 0 && (
                <span className="absolute top-2 right-2 bg-[#0a0a0a]/85 border border-[#262626] text-[#e5e5e5] font-mono text-[9px] uppercase tracking-[0.18em] px-1.5 py-0.5">
                  +{extra}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
