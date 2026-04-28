import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Users } from "lucide-react";
import { fetchMakers } from "../lib/api";
import { useStructuredData } from "../lib/seo";
import { CardSkeleton } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import VeteranBadge from "../components/VeteranBadge";

export default function MakersPage() {
  const [makers, setMakers] = useState(null);
  const [params, setParams] = useSearchParams();
  const veteranOnly = params.get("veteran") === "1";

  useEffect(() => { fetchMakers().then(setMakers).catch(() => setMakers([])); }, []);

  const filtered = useMemo(() => {
    if (!makers) return null;
    return veteranOnly ? makers.filter((m) => m.is_veteran_owned) : makers;
  }, [makers, veteranOnly]);

  useStructuredData({
    title: "Approved Makers · Independent CNC Artists & Signmakers · Crafters Market",
    description: "Meet the workshop roster — independent metal, wood, and CNC artists hand-vetted to sell on Crafters Market. Each shop ships direct to buyers via Stripe-secured checkout.",
    url: "https://craftersmarket.org/makers",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Crafters Market — Approved Makers",
      url: "https://craftersmarket.org/makers",
      isPartOf: { "@type": "WebSite", "@id": "https://craftersmarket.org/#website" },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: (makers || []).length,
        itemListElement: (makers || []).slice(0, 20).map((m, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `https://craftersmarket.org/makers/${m.slug}`,
          name: m.name,
        })),
      },
    },
  });

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="makers-page">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ APPROVED MAKERS</div>
        <h1 className="font-display text-[64px] md:text-[120px] leading-[0.88] mb-8">
          The <span className="text-outline-orange">Workshop</span><br />Roster
        </h1>

        {/* Veteran-owned filter pills */}
        <div className="flex flex-wrap items-center gap-2 mb-12" data-testid="makers-filters">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373] mr-1">Filter:</span>
          <button
            onClick={() => setParams({})}
            className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
              !veteranOnly
                ? "border-[#ff4500] text-[#ff4500] bg-[#ff4500]/5"
                : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
            }`}
            data-testid="makers-filter-all"
          >
            All
          </button>
          <button
            onClick={() => setParams({ veteran: "1" })}
            className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition inline-flex items-center gap-2 ${
              veteranOnly
                ? "border-[#b22234] text-white bg-[#b22234]"
                : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
            }`}
            data-testid="makers-filter-veteran"
          >
            <span className="inline-block w-3.5 h-2 border border-white/40 overflow-hidden">
              <svg viewBox="0 0 19 10" aria-hidden="true" className="block w-full h-full">
                {Array.from({ length: 13 }).map((_, i) => (
                  <rect key={i} x="0" y={(i * 10) / 13} width="19" height={10 / 13} fill={i % 2 === 0 ? "#b22234" : "#ffffff"} />
                ))}
                <rect x="0" y="0" width="7.6" height={(7 * 10) / 13} fill="#3c3b6e" />
              </svg>
            </span>
            Veteran-Owned
          </button>
        </div>
        <div className="grid md:grid-cols-2 gap-8">
          {filtered === null ? (
            <div className="md:col-span-2"><CardSkeleton count={4} /></div>
          ) : filtered.length === 0 ? (
            <div className="md:col-span-2">
              <EmptyState
                icon={Users}
                eyebrow="◆ Workshop Roster"
                title={veteranOnly ? "No veteran-owned shops yet." : "The roster is filling up."}
                body={veteranOnly
                  ? "We're actively recruiting veteran makers. Check back soon, or apply if you served and you make."
                  : "No approved makers yet — check back soon, or apply if you're an independent CNC artist."}
                cta={{ label: "Apply to Sell", href: "/apply", testId: "makers-empty-cta" }}
                testId="makers-empty"
              />
            </div>
          ) : (
            filtered.map((m) => (
            <Link key={m.id} to={`/makers/${m.slug}`} data-testid={`maker-card-${m.slug}`}
              className="group bg-[#121212] border border-[#262626] hover:border-[#ff4500] transition overflow-hidden">
              <div className="aspect-[4/3] overflow-hidden relative">
                <img src={m.cover} alt={m.name} className="w-full h-full object-cover media-img group-hover:scale-105 transition duration-700" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                {m.is_veteran_owned && (
                  <VeteranBadge
                    className="absolute top-4 right-4 bg-black/70"
                    testId={`maker-card-veteran-${m.slug}`}
                  />
                )}
                <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                  <div>
                    <div className="font-display text-3xl text-white">{m.name}</div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-1">{m.location}</div>
                  </div>
                  <div className="tag text-[#ff4500] border-[#ff4500]">{m.listings_count} listings</div>
                </div>
              </div>
              <div className="p-6 border-t border-[#262626]">
                <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mb-4">{m.bio}</p>
                <div className="flex gap-2">{m.techniques.map((t) => <span key={t} className="tag">{t}</span>)}</div>
              </div>
            </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
