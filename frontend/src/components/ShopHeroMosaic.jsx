/**
 * iter357/iter358 — Shop hero "rotating discovery mosaic".
 *
 * Fills the dead space to the right of the page H1 with a 4×3 (lg) /
 * 3×3 (md) grid of product tiles. Each tile crossfades to a different
 * random listing every ~3.5 s, staggered so the grid never flips in
 * unison. Hover pauses + reveals the title overlay; click navigates
 * to the destination + fires an impression beacon. Honors
 * `prefers-reduced-motion` (no rotation).
 *
 * Reusable across the Shop hero and the Makers hero — pass
 * `linkBuilder` to control where each tile points. By default tiles
 * link to the PDP at `/p/{slug}`; the Makers page passes a builder
 * that points to `/makers/{maker_slug}` instead.
 *
 * iter358 — Plus subscribers + actively-promoted listings get a
 * weighted boost in tile selection (Plus = 2×, promoted = 4×). The
 * server already sorts the same way; the mosaic surface reinforces it
 * by giving paid makers more rotations in the discovery surface.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

const ROTATE_MS = 3500;
const TILE_COUNT_LG = 12; // 4 cols × 3 rows
const TILE_COUNT_MD = 9;  // 3 cols × 3 rows

const API = process.env.REACT_APP_BACKEND_URL;

function pickEligible(products) {
  if (!Array.isArray(products)) return [];
  return products.filter(
    (p) => p && p.slug && Array.isArray(p.images) && p.images[0],
  );
}

function tileWeight(p) {
  // iter358 — Promoted listings dominate (paid surface), Plus shops
  // next, free shops baseline. We don't zero out free listings — the
  // mosaic must still feel like a representative cross-section of the
  // marketplace, just one that favors makers who invested in growth.
  const promoActive =
    p.promoted_until && new Date(p.promoted_until).getTime() > Date.now();
  if (promoActive) return 4;
  if (p.maker_is_plus) return 2;
  return 1;
}

function weightedShuffle(arr, count) {
  // Efraimidis-Spirakis weighted reservoir sampling.
  // Each item gets a key = random ** (1/weight); top `count` keys win.
  // Cheap, branchless, stable for our ~85-row catalog.
  const keyed = arr.map((p) => {
    const w = tileWeight(p);
    const r = Math.random() || Number.MIN_VALUE;
    return { p, key: Math.pow(r, 1 / w) };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, count).map((x) => x.p);
}

function fireImpression(slug) {
  if (!slug || !API) return;
  const url = `${API}/api/products/${encodeURIComponent(slug)}/impression`;
  try {
    // sendBeacon doesn't block navigation — the click handler returns
    // immediately and the request fires in the background.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([], { type: "text/plain" }));
      return;
    }
  } catch {
    // fall through to fetch
  }
  // Fallback for browsers without sendBeacon (very rare in 2026).
  fetch(url, { method: "POST", keepalive: true }).catch(() => {});
}

export default function ShopHeroMosaic({
  products,
  testId = "shop-hero-mosaic",
  linkBuilder,            // (product) => string  — defaults to /p/{slug}
  impressionSource = "shop_mosaic",
}) {
  const eligible = useMemo(() => pickEligible(products), [products]);
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Initial tile selection — weighted reservoir sample favors Plus /
  // promoted. Re-derives only when the eligible list shape changes.
  const initialTiles = useMemo(
    () => weightedShuffle(eligible, TILE_COUNT_LG),
    [eligible.length],
  );
  const [tiles, setTiles] = useState(initialTiles);
  useEffect(() => { setTiles(initialTiles); }, [initialTiles]);

  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const timersRef = useRef([]);

  // Staggered rotation — each tile picks its own slot, swapping its
  // product for a different eligible one (weighted toward Plus /
  // promoted). Pauses globally when the user is hovering any tile so
  // the click target doesn't move out from under their cursor.
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
        if (hoveredIdx === -1) {
          setTiles((prev) => {
            const used = new Set(prev.map((p) => p?.slug));
            const candidates = eligible.filter((p) => !used.has(p.slug));
            if (!candidates.length) return prev;
            // Weighted pick from the remaining candidates so Plus +
            // promoted shops keep their boost in the rotation too.
            const next = [...prev];
            const [picked] = weightedShuffle(candidates, 1);
            next[idx] = picked;
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
          linkBuilder={linkBuilder}
          impressionSource={impressionSource}
          testId={`${testId}-tile-${idx}`}
        />
      ))}
    </div>
  );
}

function MosaicTile({ product, hidden, hovered, onHover, linkBuilder, impressionSource, testId }) {
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
  const href = linkBuilder ? linkBuilder(current) : `/p/${current.slug}`;
  return (
    <Link
      to={href}
      className={`group relative aspect-square overflow-hidden bg-surface-2 ${hidden ? "hidden lg:block" : "block"}`}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={() => fireImpression(current.slug)}
      onAuxClick={() => fireImpression(current.slug)}
      data-testid={testId}
      data-slug={current.slug}
      data-impression-source={impressionSource}
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
