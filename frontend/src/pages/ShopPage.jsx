import React, { useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchProducts } from "../lib/api";
import ProductCard from "../components/ProductCard";
import EmptyState from "../components/EmptyState";
import { CardSkeleton } from "../components/Skeleton";
import { Search, Wrench } from "lucide-react";
import { useStructuredData } from "../lib/seo";
import { CATEGORIES } from "./MakerListingEditor/constants";
import SupportVeteransStrip from "../components/SupportVeteransStrip";
import AiDiscoverySearch from "../components/AiDiscoverySearch";
import Breadcrumbs from "../components/Breadcrumbs";

// Buyer-facing filter strip. "All" pinned to the front; the rest mirrors
// the CATEGORIES list makers see in the editor so anything they publish
// is filterable by buyers from day one.
const CATS = ["All", ...CATEGORIES];
const TECHS = ["All", "PLASMA", "LASER", "ROUTER", "3D", "CUSTOM"];

export default function ShopPage() {
  const [params] = useSearchParams();
  const [products, setProducts] = useState(null);
  const [cat, setCat] = useState(params.get("category") || "All");
  const [tech, setTech] = useState("All");
  const [q, setQ] = useState(params.get("q") || "");
  // iter284 — Honor `cm_shop_scroll_memory` on first mount so a buyer
  // who clicks into a listing and hits "back" lands exactly where they
  // left. We only consume the entry once; subsequent route entries
  // start fresh. Stored before state inits so the first render uses
  // the restored visibleCount.
  const _memoryRef = useRef((() => {
    try {
      const raw = sessionStorage.getItem("cm_shop_scroll_memory");
      if (!raw) return null;
      const m = JSON.parse(raw);
      // Only honor when search params match (filter hash) AND the
      // memory is < 30 min old — stale entries become noise.
      const fresh = m && (Date.now() - (m.savedAt || 0)) < 30 * 60 * 1000;
      const sameFilter = m && m.search === (window.location.search || "");
      return fresh && sameFilter ? m : null;
    } catch {
      return null;
    }
  })());
  // ?featured=examples — "View all examples" CTA destination from the
  // homepage Featured Builds rail. Filters the grid down to platform-
  // seeded "Featured Example" listings only so visitors who clicked the
  // CTA see exactly what they expected.
  const onlyExamples = params.get("featured") === "examples";

  useEffect(() => { fetchProducts().then(setProducts).catch(() => setProducts([])); }, []);
  useEffect(() => {
    const urlQ = params.get("q"); const urlC = params.get("category");
    if (urlQ !== null) setQ(urlQ);
    if (urlC) setCat(urlC);
  }, [params]);

  // Rich, category-specific schema. Generic `/shop` gets a marketplace
  // shell; `?category=…` and `?technique=…` filtered views each get
  // their own keyword-weighted description + ItemList of the top
  // visible products so each filtered view can rank as its own page.
  const _catLabel = cat !== "All" ? cat : tech !== "All" ? tech : null;
  const _pageDesc = _catLabel
    ? `Shop ${_catLabel} on Crafters Market — handcrafted CNC metal art, laser-cut originals, and custom signs by vetted American artisans. Browse live listings, see real workshop photos, and order direct from the maker.`
    : `Artisan marketplace for CNC metal art, CNC laser art, plasma-cut signs, and custom handmade goods — precision crafting by vetted CNC manufacturing shops across the USA.`;
  const _topItemUrls = (products || [])
    .filter((p) => (cat === "All" || p.category === cat) && (tech === "All" || p.technique === tech))
    .slice(0, 12)
    .map((p) => `https://craftersmarket.org/shop/${p.slug}`);
  useStructuredData({
    title: cat !== "All"
      ? `${cat} · Shop · Crafters Market`
      : "Shop · Artisan Marketplace · Crafters Market",
    description: _pageDesc,
    url: `https://craftersmarket.org/shop${cat !== "All" ? `?category=${encodeURIComponent(cat)}` : ""}`,
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    imageAlt: cat !== "All" ? `${cat} on Crafters Market` : "Crafters Market shop",
    ogType: "website",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: _catLabel ? `${_catLabel} · Crafters Market` : "Crafters Market Shop",
      description: _pageDesc,
      url: `https://craftersmarket.org/shop${cat !== "All" ? `?category=${encodeURIComponent(cat)}` : ""}`,
      isPartOf: { "@type": "WebSite", "@id": "https://craftersmarket.org/#website" },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://craftersmarket.org/" },
          { "@type": "ListItem", position: 2, name: "Shop", item: "https://craftersmarket.org/shop" },
          ...(_catLabel ? [{ "@type": "ListItem", position: 3, name: _catLabel,
              item: `https://craftersmarket.org/shop?category=${encodeURIComponent(_catLabel)}` }] : []),
        ],
      },
      mainEntity: _topItemUrls.length ? {
        "@type": "ItemList",
        numberOfItems: _topItemUrls.length,
        itemListElement: _topItemUrls.map((url, i) => ({
          "@type": "ListItem", position: i + 1, url,
        })),
      } : undefined,
    },
  });

  const filtered = useMemo(() => (products || []).filter((p) => {
    if (cat !== "All" && p.category !== cat) return false;
    if (tech !== "All" && p.technique !== tech) return false;
    if (q && !(p.title.toLowerCase().includes(q.toLowerCase()) || p.description.toLowerCase().includes(q.toLowerCase()))) return false;
    if (onlyExamples && !p.featured_example) return false;
    return true;
  }), [products, cat, tech, q, onlyExamples]);

  // iter283 — Infinite-scroll pagination. The catalog is already
  // client-cached after `fetchProducts()`, so this is purely a render-
  // budget optimization: only mount `PAGE_SIZE` ProductCards at a
  // time, then expand as the user scrolls. Cuts initial DOM cost +
  // framer-motion mount work by ~3x on a typical 87-listing catalog.
  const PAGE_SIZE = 24;
  const [visibleCount, setVisibleCount] = useState(_memoryRef.current?.visibleCount || PAGE_SIZE);
  const sentinelRef = useRef(null);

  // Reset to the first page whenever the filter narrows or widens the
  // result set — otherwise a stale `visibleCount` could show e.g. only
  // the first 24 of the previous filter applied against the new one.
  // iter284 — Skip the reset on the very first render so a restored
  // visibleCount from memory survives. _firstFilterChangeRef flips after
  // the user actually touches a filter (not from URL hydration).
  const _firstFilterChangeRef = useRef(true);
  useEffect(() => {
    if (_firstFilterChangeRef.current) {
      _firstFilterChangeRef.current = false;
      return;
    }
    setVisibleCount(PAGE_SIZE);
    // Filter change invalidates any memory under the previous filter.
    try { sessionStorage.removeItem("cm_shop_scroll_memory"); } catch { /* ignore */ }
  }, [cat, tech, q, onlyExamples]);

  // iter284 — After products + visible cards render, restore the saved
  // scrollY (if any) so the buyer lands back on the same row. One-shot
  // via the ref; cleared so subsequent re-renders don't fight the user.
  useEffect(() => {
    const mem = _memoryRef.current;
    if (!mem || products === null) return;
    // The DOM needs a tick to settle before the scroll target exists.
    const id = window.requestAnimationFrame(() => {
      window.scrollTo({ top: mem.scrollY || 0, behavior: "instant" in window ? "instant" : "auto" });
      _memoryRef.current = null;  // one-shot
    });
    return () => window.cancelAnimationFrame(id);
  }, [products]);

  // iter284 — Continuously persist `{visibleCount, scrollY, search}` so
  // the next mount of this page (after a detail-page round-trip) can
  // restore. Throttled to 300ms — scroll fires ~60×/s otherwise.
  useEffect(() => {
    let t = null;
    const save = () => {
      try {
        sessionStorage.setItem("cm_shop_scroll_memory", JSON.stringify({
          visibleCount,
          scrollY:  window.scrollY,
          search:   window.location.search || "",
          savedAt:  Date.now(),
        }));
      } catch { /* quota or private-mode — silent */ }
    };
    const onScroll = () => {
      if (t) return;
      t = setTimeout(() => { t = null; save(); }, 300);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // Also persist immediately when visibleCount changes (paged load).
    save();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (t) clearTimeout(t);
    };
  }, [visibleCount]);

  // IntersectionObserver-based loader. Fires once when the sentinel
  // enters the viewport (≈600px before the bottom for a smooth feel)
  // and bumps `visibleCount`. Self-disconnects once the full list is
  // rendered so we don't keep firing on every scroll.
  useEffect(() => {
    if (!sentinelRef.current) return;
    if (visibleCount >= filtered.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((n) => Math.min(n + PAGE_SIZE, filtered.length));
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [visibleCount, filtered.length]);

  const visible = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  return (
    <div className="pb-24 grain min-h-screen" data-testid="shop-page">
      <SupportVeteransStrip />
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 pt-12 md:pt-16">
        <Breadcrumbs
          items={[
            { name: "Home", to: "/" },
            { name: "Shop", to: cat !== "All" || tech !== "All" ? "/shop" : undefined },
            ...(cat !== "All" ? [{ name: cat }] : tech !== "All" ? [{ name: tech }] : []),
          ]}
          testId="shop-breadcrumbs"
        />
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ SHOP</div>
        <h1 className="font-display text-[64px] md:text-[140px] leading-[0.88] mb-12">
          The <span className="text-outline">Marketplace</span>
        </h1>

        {onlyExamples && (
          <div
            className="mb-8 border border-amber-900/50 bg-amber-950/15 p-4 md:p-5 max-w-3xl"
            data-testid="shop-featured-examples-banner"
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-amber-300 mb-2">
              ✦ Featured Examples · Platform Showcase
            </div>
            <p className="font-mono text-[12px] text-[#a3a3a3] leading-relaxed">
              These are <span className="text-amber-300">curated reference builds</span> staged by the Crafters
              Market workshop team — not for sale. We use them to show what's possible while our
              maker catalog grows. Real listings from approved makers populate the rest of the marketplace.
            </p>
          </div>
        )}

        {/* Compact AI Discovery surface — sits between the title and
            the category filters so natural-language searchers don't
            have to fiddle with chips. Auto-hides results into its own
            block. */}
        <div className="mb-10 -mx-4 md:-mx-8">
          <AiDiscoverySearch testId="shop-ai-discovery" compact />
        </div>

        {/* Filters — stacked rows to give all 16 category pills + 5
            technique pills proper room. Was previously a 12-col grid
            with each filter cramped into 1/3 of the row, which forced
            the 16 categories to wrap into a 4-col block while the
            technique pills rendered as tall vertical bars (the active
            "ALL" pill had width:auto inside a 1/3-row column). */}
        <FilterStrip
          q={q} setQ={setQ}
          cat={cat} setCat={setCat}
          tech={tech} setTech={setTech}
          activeCount={(cat !== "All" ? 1 : 0) + (tech !== "All" ? 1 : 0) + (q ? 1 : 0)}
          onReset={() => { setCat("All"); setTech("All"); setQ(""); }}
        />

        <div className="font-mono text-xs uppercase tracking-[0.22em] text-[#a3a3a3] mb-6 min-h-[1.25rem]" data-testid="shop-count">
          {products === null ? (
            <span className="inline-block h-3 w-32 bg-[#1a1a1a] animate-pulse" aria-label="Loading count" />
          ) : (
            `${filtered.length} piece${filtered.length === 1 ? "" : "s"}`
          )}
        </div>

        {products === null ? (
          <CardSkeleton count={8} />
        ) : (
          <>
            {filtered.length > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-5">
                  {visible.map((p, i) => <ProductCard key={p.id} p={p} i={i} />)}
                </div>
                {/* iter283 — Infinite-scroll sentinel + status. Hidden
                    once we've shown everything; shows a "loading more"
                    indicator otherwise. */}
                {visibleCount < filtered.length ? (
                  <div
                    ref={sentinelRef}
                    className="flex items-center justify-center py-10 font-mono text-[10px] uppercase tracking-[0.3em] text-[#525252]"
                    data-testid="shop-infinite-loader"
                  >
                    <span className="inline-block w-2 h-2 bg-[#ff4500] mr-3 animate-pulse" aria-hidden="true" />
                    Loading {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
                    <span className="ml-2 text-[#737373]">
                      · {visibleCount}/{filtered.length}
                    </span>
                  </div>
                ) : filtered.length > PAGE_SIZE && (
                  <div
                    className="flex items-center justify-center py-10 font-mono text-[10px] uppercase tracking-[0.3em] text-[#525252]"
                    data-testid="shop-infinite-end"
                  >
                    ◆ End of catalog · {filtered.length} pieces
                  </div>
                )}
              </>
            ) : (
              <EmptyState
                icon={Wrench}
                eyebrow="◆ Empty Workshop"
                title="No pieces match those filters."
                body="Try a different category or technique — or commission something custom and we'll match you with a maker."
                cta={{ label: "Commission a Custom Piece", href: "/custom-order", testId: "shop-empty-cta" }}
                secondary={{ label: "↺ Reset filters", onClick: () => { setCat("All"); setTech("All"); setQ(""); } }}
                testId="shop-empty"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}


// Compact single-row filter strip — search + Category + Technique
// dropdowns + reset. Replaces the previous 4-row stack which felt
// cluttered on the Shop page (16 category pills wrapped onto two rows).
// Native <select> keeps it accessible + mobile-friendly without a
// custom popover.
function FilterStrip({ q, setQ, cat, setCat, tech, setTech, activeCount, onReset }) {
  return (
    <div className="border-y border-[#262626] py-3 md:py-3.5 mb-8" data-testid="shop-filters">
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        {/* Search — flex-grows to fill the row */}
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a3a3a3]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pieces…"
            data-testid="shop-search"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none pl-9 pr-9 h-9 font-mono text-[11px] uppercase tracking-[0.2em] placeholder:text-[#525252]"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#a3a3a3] hover:text-[#ff4500] font-mono text-xs"
              data-testid="shop-search-clear"
            >
              ✕
            </button>
          )}
        </div>

        <FilterSelect
          testid="shop-cat-filter"
          label="Category"
          value={cat}
          options={CATS}
          onChange={setCat}
          accent={cat !== "All"}
        />
        <FilterSelect
          testid="shop-tech-filter"
          label="Technique"
          value={tech}
          options={TECHS}
          onChange={setTech}
          accent={tech !== "All"}
        />

        {activeCount > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition shrink-0"
            data-testid="shop-filters-reset"
          >
            ↺ Reset {activeCount}
          </button>
        )}
      </div>
    </div>
  );
}

function FilterSelect({ testid, label, value, options, onChange, accent }) {
  // The `<select>` has no border-color binding to the active state in
  // CSS, so we wrap it with the active styling and let the native
  // chevron sit above (appearance-none).
  const activeCls = accent
    ? "border-[#ff4500] text-[#ff4500]"
    : "border-[#262626] text-[#a3a3a3] hover:border-[#525252] hover:text-[#e5e5e5]";
  return (
    <label className={`relative inline-flex items-center h-9 border ${activeCls} transition shrink-0`}
      data-testid={testid}>
      <span className="px-3 font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252] border-r border-inherit">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent pl-3 pr-7 h-full font-mono text-[11px] uppercase tracking-[0.18em] outline-none cursor-pointer"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-[#0a0a0a] text-[#e5e5e5]">
            {o}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none font-mono text-[10px]">▾</span>
    </label>
  );
}
