import React, { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchProducts } from "../lib/api";
import ProductCard from "../components/ProductCard";
import EmptyState from "../components/EmptyState";
import { CardSkeleton } from "../components/Skeleton";
import { Search, Wrench } from "lucide-react";
import { useStructuredData } from "../lib/seo";
import { CATEGORIES } from "./MakerListingEditor/constants";
import SupportVeteransStrip from "../components/SupportVeteransStrip";

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

  useEffect(() => { fetchProducts().then(setProducts).catch(() => setProducts([])); }, []);
  useEffect(() => {
    const urlQ = params.get("q"); const urlC = params.get("category");
    if (urlQ !== null) setQ(urlQ);
    if (urlC) setCat(urlC);
  }, [params]);

  useStructuredData({
    title: cat !== "All"
      ? `${cat} · Shop · Crafters Market`
      : "Shop · Precision CNC Art & Handcrafted Goods · Crafters Market",
    description: `Browse hand-built CNC metal & wood art, custom signs, and made-to-order pieces from approved independent makers.${cat !== "All" ? ` Filtered by ${cat}.` : ""}`,
    url: `https://craftersmarket.org/shop${cat !== "All" ? `?category=${encodeURIComponent(cat)}` : ""}`,
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    imageAlt: cat !== "All" ? `${cat} on Crafters Market` : "Crafters Market shop",
    ogType: "website",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: cat !== "All" ? `${cat} · Crafters Market` : "Crafters Market Shop",
      url: "https://craftersmarket.org/shop",
      isPartOf: { "@type": "WebSite", "@id": "https://craftersmarket.org/#website" },
    },
  });

  const filtered = useMemo(() => (products || []).filter((p) => {
    if (cat !== "All" && p.category !== cat) return false;
    if (tech !== "All" && p.technique !== tech) return false;
    if (q && !(p.title.toLowerCase().includes(q.toLowerCase()) || p.description.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  }), [products, cat, tech, q]);

  return (
    <div className="pb-24 grain min-h-screen" data-testid="shop-page">
      <SupportVeteransStrip />
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 pt-12 md:pt-16">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ SHOP</div>
        <h1 className="font-display text-[64px] md:text-[140px] leading-[0.88] mb-12">
          The <span className="text-outline">Marketplace</span>
        </h1>

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

        <div className="font-mono text-xs uppercase tracking-[0.22em] text-[#a3a3a3] mb-6">
          {products === null ? "Loading…" : `${filtered.length} piece${filtered.length === 1 ? "" : "s"}`}
        </div>

        {products === null ? (
          <CardSkeleton count={8} />
        ) : (
          <>
            {filtered.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filtered.map((p, i) => <ProductCard key={p.id} p={p} i={i} />)}
              </div>
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
