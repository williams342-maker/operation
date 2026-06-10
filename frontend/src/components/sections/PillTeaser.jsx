import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchProducts } from "../../lib/api";
import { formatPriceDisplay, trackPricingLabelClick } from "../../lib/variantPricing";

/**
 * iter334m — Hover-fan teaser for the homepage "Popular →" pill row.
 *
 * On hover (desktop) or tap (mobile), fans out 3-4 listing thumbnails
 * matching the pill's category — small image + truncated title + price.
 * Clicking a thumbnail deep-links to the listing; clicking the pill
 * itself still goes to /shop?q=<pill>.
 *
 * Caching: results live in component state for the session. Re-hover
 * does NOT re-fetch. Aborts pending fetches on un-hover so flicker-hover
 * doesn't pile up requests.
 *
 * Mobile fallback: hover events don't fire on touch, so we ALSO open the
 * teaser on tap of the pill. A second tap navigates to the full /shop
 * search. data-testid hooks added for QA.
 */
const TEASER_CACHE = new Map(); // label → { items: [...] | null, ts: number }
const TEASER_TTL_MS = 5 * 60 * 1000; // 5 min — homepage data refreshes naturally

export default function PillTeaser({ label, query }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(() => {
    const c = TEASER_CACHE.get(label);
    return c && Date.now() - c.ts < TEASER_TTL_MS ? c.items : null;
  });
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);
  const closeTimerRef = useRef(null);

  const ensureLoaded = async () => {
    if (items !== null) return; // already cached
    if (loading) return;
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      // Use ?q= search — works for any label, including non-strict
      // category names. Cap to 4 results for the fan layout.
      const all = await fetchProducts({ q: query });
      // Prefer those with images.
      const withImg = (all || []).filter((p) => p.images?.[0]);
      const trimmed = withImg.slice(0, 4);
      if (!ctrl.signal.aborted) {
        setItems(trimmed);
        TEASER_CACHE.set(label, { items: trimmed, ts: Date.now() });
      }
    } catch {
      if (!ctrl.signal.aborted) setItems([]);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  };

  // Open on mouse enter (desktop) and abort the close timer if user
  // re-hovers within the grace window.
  const onEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
    ensureLoaded();
  };

  // Close on leave with a small grace period so the user can move
  // diagonally from pill → teaser panel without the panel snapping shut.
  const onLeave = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpen(false), 180);
  };

  // Mobile tap → first tap opens teaser, second tap navigates.
  const onClick = () => {
    if (!open) {
      setOpen(true);
      ensureLoaded();
      return;
    }
    nav(`/shop?q=${encodeURIComponent(query)}`);
  };

  // Clean up timer + in-flight abort on unmount.
  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  return (
    <div
      className="relative"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      data-testid={`pill-teaser-wrap-${label}`}
    >
      <button
        onClick={onClick}
        className="px-3 py-1.5 border border-amber-500/20 hover:border-amber-400 hover:text-amber-300 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-300 transition bg-paper/30 backdrop-blur-sm"
        data-testid={`pill-${label}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {label}
      </button>

      {open && (
        <div
          className="absolute z-30 left-1/2 -translate-x-1/2 top-full mt-2 w-[18rem] sm:w-[22rem] bg-paper/95 border border-amber-500/30 backdrop-blur-md shadow-2xl p-3 animate-[fadeIn_120ms_ease-out]"
          data-testid={`pill-teaser-panel-${label}`}
          role="dialog"
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-amber-300">
              ◆ {label}
            </span>
            <button
              onClick={() => nav(`/shop?q=${encodeURIComponent(query)}`)}
              className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-400 hover:text-amber-300"
              data-testid={`pill-teaser-viewall-${label}`}
            >
              View all →
            </button>
          </div>

          {loading && items === null && (
            <div className="grid grid-cols-2 gap-2" data-testid={`pill-teaser-loading-${label}`}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="aspect-square bg-zinc-800/40 animate-pulse" />
              ))}
            </div>
          )}

          {!loading && items?.length === 0 && (
            <p
              className="font-mono text-[10px] text-zinc-500 px-1 py-3"
              data-testid={`pill-teaser-empty-${label}`}
            >
              No listings yet — be the first.
            </p>
          )}

          {items?.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {items.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => { trackPricingLabelClick(p.slug); nav(`/shop/${p.slug}`); }}
                  className="group text-left"
                  data-testid={`pill-teaser-item-${label}-${p.slug}`}
                  title={p.title}
                >
                  <div className="aspect-square overflow-hidden bg-zinc-900 border border-zinc-800 group-hover:border-amber-400/60 transition">
                    <img
                      src={p.images[0]}
                      alt={p.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-[1.04] transition duration-500"
                    />
                  </div>
                  <div className="mt-1.5 font-mono text-[9px] text-zinc-300 truncate group-hover:text-amber-300">
                    {p.title}
                  </div>
                  <div className="font-mono text-[10px] text-brand">
                    {formatPriceDisplay(p)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
