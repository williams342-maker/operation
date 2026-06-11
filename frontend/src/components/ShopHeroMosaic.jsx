/**
 * iter357 — Shop hero "rotating discovery mosaic".
 *
 * Fills the dead space to the right of "THE MARKETPLACE." headline with
 * a 4×3 (lg) / 3×3 (md) grid of product tiles. Each tile crossfades to
 * a different random listing every ~3.5 s, staggered so the grid never
 * flips in unison. Hover pauses + reveals the title overlay; click
 * navigates to the PDP. Honors `prefers-reduced-motion` (no rotation).
 *
 * The mosaic is purely decorative — it does not replace the main grid
 * below the filters. It's a "look how alive this market is" surface.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

const ROTATE_MS = 3500;
const TILE_COUNT_LG = 12; // 4 cols × 3 rows
const TILE_COUNT_MD = 9;  // 3 cols × 3 rows

function pickEligible(products) {
  if (!Array.isArray(products)) return [];
  return products.filter(
    (p) => p && p.slug && Array.isArray(p.images) && p.images[0],
  );
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function ShopHeroMosaic({ products, testId = "shop-hero-mosaic" }) {
  const eligible = useMemo(() => pickEligible(products), [products]);
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Initial tile selection — shuffled slice. Re-derives only when the
  // eligible list shape changes (length swap).
  const initialTiles = useMemo(
    () => shuffle(eligible).slice(0, TILE_COUNT_LG),
    [eligible.length],
  );
  const [tiles, setTiles] = useState(initialTiles);
  useEffect(() => { setTiles(initialTiles); }, [initialTiles]);

  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const timersRef = useRef([]);

  // Staggered rotation — each tile picks its own slot, swapping its
  // product for a different eligible one. Pauses globally when the
  // user is hovering any tile so the click target doesn't move.
  useEffect(() => {
    if (reducedMotion || eligible.length <= TILE_COUNT_LG) return;
    const cancel = () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current = [];
    };
    cancel();
    const scheduleOne = (idx) => {
      const jitter = 500 + Math.random() * 1500;
      const t = setTimeout(function tick() {
        // Skip the swap while user is interacting with the grid.
        if (hoveredIdx === -1) {
          setTiles((prev) => {
            const used = new Set(prev.map((p) => p?.slug));
            const candidates = eligible.filter((p) => !used.has(p.slug));
            if (!candidates.length) return prev;
            const next = [...prev];
            next[idx] = candidates[Math.floor(Math.random() * candidates.length)];
            return next;
          });
        }
        timersRef.current[idx] = setTimeout(tick, ROTATE_MS + (Math.random() * 600 - 300));
      }, ROTATE_MS + jitter);
      timersRef.current[idx] = t;
    };
    for (let i = 0; i < TILE_COUNT_LG; i++) scheduleOne(i);
    return cancel;
  }, [eligible, reducedMotion, hoveredIdx]);

  // Loading skeleton — 12 pulsing squares.
  if (!Array.isArray(products)) {
    return (
      <div
        className="hidden md:grid grid-cols-3 lg:grid-cols-4 gap-1.5"
        data-testid={`${testId}-skeleton`}
        aria-hidden="true"
      >
        {Array.from({ length: TILE_COUNT_LG }).map((_, i) => (
          <div
            key={i}
            className={`aspect-square bg-surface-2 animate-pulse ${i >= TILE_COUNT_MD ? "hidden lg:block" : ""}`}
          />
        ))}
      </div>
    );
  }

  if (eligible.length === 0) return null;

  return (
    <div
      className="hidden md:grid grid-cols-3 lg:grid-cols-4 gap-1.5 select-none"
      data-testid={testId}
      onMouseLeave={() => setHoveredIdx(-1)}
      aria-label="Featured listings preview mosaic"
    >
      {tiles.slice(0, TILE_COUNT_LG).map((p, idx) => (
        <MosaicTile
          key={idx}
          product={p}
          hidden={idx >= TILE_COUNT_MD}
          hovered={hoveredIdx === idx}
          onHover={() => setHoveredIdx(idx)}
          testId={`${testId}-tile-${idx}`}
        />
      ))}
    </div>
  );
}

function MosaicTile({ product, hidden, hovered, onHover, testId }) {
  // Two-layer crossfade. We hold the visible image in `currentSlug`
  // and the outgoing one in `previousSlug`. Whenever `product.slug`
  // changes we promote the new product to `current` and the old
  // visible one becomes `previous`, fading out over 700 ms.
  const [currentProduct, setCurrentProduct] = useState(product);
  const [previousProduct, setPreviousProduct] = useState(null);
  const dropTimerRef = useRef(null);

  useEffect(() => {
    if (!product) return undefined;
    setCurrentProduct((prev) => {
      if (prev && prev.slug === product.slug) return prev;
      setPreviousProduct(prev || null);
      if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
      dropTimerRef.current = setTimeout(() => setPreviousProduct(null), 700);
      return product;
    });
    return () => {
      if (dropTimerRef.current) clearTimeout(dropTimerRef.current);
    };
  }, [product]);

  const current = currentProduct;
  const previous = previousProduct;
  if (!current) return null;
  return (
    <Link
      to={`/p/${current.slug}`}
      className={`group relative aspect-square overflow-hidden bg-surface-2 ${hidden ? "hidden lg:block" : "block"}`}
      onMouseEnter={onHover}
      onFocus={onHover}
      data-testid={testId}
      data-slug={current.slug}
    >
      {previous && (
        <img
          src={previous.images?.[0]}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-700"
        />
      )}
      <img
        src={current.images?.[0]}
        alt={current.title || "Listing"}
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
      />
      {/* Hover gradient + title — only renders for the actively hovered
          tile so the surrounding grid stays clean. */}
      <div
        className={`absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-transparent transition-opacity duration-300 ${hovered ? "opacity-100" : "opacity-0"}`}
      />
      <div
        className={`absolute inset-x-0 bottom-0 p-2 transition-all duration-300 ${hovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/90 truncate">
          {current.title}
        </div>
        {current.price != null && (
          <div className="font-mono text-[11px] text-brand">
            ${Number(current.price).toFixed(2)}
          </div>
        )}
      </div>
    </Link>
  );
}
