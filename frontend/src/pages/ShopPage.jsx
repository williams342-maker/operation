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


// Stacked filter strip — search up top, category row, technique row.
// Each row has a small label so the buyer always knows what they're
// scoping. All pills share a single `Pill` component with consistent
// height and same hover/active treatment so nothing renders as a
// stretched vertical bar (which is what was happening before when an
// "active" pill landed alone in a narrow flex column).
function FilterStrip({ q, setQ, cat, setCat, tech, setTech, activeCount, onReset }) {
  return (
    <div className="border-y border-[#262626] py-6 mb-10 space-y-5" data-testid="shop-filters">
      {/* Search bar — full width so it never collides with the pill rows */}
      <div className="relative max-w-2xl">
        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#a3a3a3]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search pieces…"
          data-testid="shop-search"
          className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none pl-10 pr-12 py-2.5 font-mono text-xs uppercase tracking-[0.2em] placeholder:text-[#525252]"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a3a3a3] hover:text-[#ff4500] font-mono text-sm"
            data-testid="shop-search-clear"
          >
            ✕
          </button>
        )}
      </div>

      {/* Category row */}
      <FilterRow
        testid="shop-cat-filter"
        label="Category"
        items={CATS}
        active={cat}
        onPick={setCat}
        accent="orange"
      />

      {/* Technique row */}
      <FilterRow
        testid="shop-tech-filter"
        label="Technique"
        items={TECHS}
        active={tech}
        onPick={setTech}
        accent="white"
      />

      {/* Reset link — only renders when at least one filter is active */}
      {activeCount > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onReset}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition"
            data-testid="shop-filters-reset"
          >
            ↺ Reset {activeCount} filter{activeCount > 1 ? "s" : ""}
          </button>
        </div>
      )}
    </div>
  );
}

function FilterRow({ testid, label, items, active, onPick, accent }) {
  // Map accent to active-state classes. Orange for category,
  // white/cream for technique — keeps the two rows visually distinct so
  // buyers can tell at a glance which axis they're scoping.
  const activeCls = accent === "orange"
    ? "bg-[#ff4500] border-[#ff4500] text-black"
    : "bg-[#e5e5e5] border-[#e5e5e5] text-black";
  const idleCls = "border-[#262626] text-[#a3a3a3] hover:border-[#525252] hover:text-[#e5e5e5]";

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testid}>
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mr-2 shrink-0">
        {label}
      </span>
      {items.map((it) => {
        const isActive = active === it;
        return (
          <button
            key={it}
            type="button"
            onClick={() => onPick(it)}
            className={`h-8 px-3 inline-flex items-center font-mono text-[10px] uppercase tracking-[0.2em] border transition whitespace-nowrap ${
              isActive ? activeCls : idleCls
            }`}
            data-testid={`${testid}-${it.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            {it}
          </button>
        );
      })}
    </div>
  );
}
