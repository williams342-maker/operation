import React, { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchProducts } from "../lib/api";
import ProductCard from "../components/ProductCard";
import EmptyState from "../components/EmptyState";
import { CardSkeleton } from "../components/Skeleton";
import { Search, Wrench } from "lucide-react";
import { useStructuredData } from "../lib/seo";
import { CATEGORIES } from "./MakerListingEditor/constants";

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
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="shop-page">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ SHOP</div>
        <h1 className="font-display text-[64px] md:text-[140px] leading-[0.88] mb-12">
          The <span className="text-outline">Marketplace</span>
        </h1>

        {/* Filters */}
        <div className="grid md:grid-cols-12 gap-4 mb-10 border-y border-[#262626] py-6">
          <div className="md:col-span-4 relative">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#a3a3a3]" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search pieces…"
              data-testid="shop-search"
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none pl-10 pr-4 py-3 font-mono text-xs uppercase tracking-[0.2em] placeholder:text-[#525252]"
            />
          </div>
          <div className="md:col-span-4 flex flex-wrap gap-2" data-testid="shop-cat-filter">
            {CATS.map((c) => (
              <button key={c} onClick={() => setCat(c)}
                className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] border transition ${
                  cat === c ? "bg-[#ff4500] border-[#ff4500] text-white" : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500]"
                }`}>{c}</button>
            ))}
          </div>
          <div className="md:col-span-4 flex flex-wrap gap-2" data-testid="shop-tech-filter">
            {TECHS.map((t) => (
              <button key={t} onClick={() => setTech(t)}
                className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] border transition ${
                  tech === t ? "bg-[#e5e5e5] border-[#e5e5e5] text-black" : "border-[#262626] text-[#a3a3a3] hover:border-[#e5e5e5]"
                }`}>{t}</button>
            ))}
          </div>
        </div>

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
