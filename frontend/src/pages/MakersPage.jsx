import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { fetchMakers } from "../lib/api";
import { useStructuredData } from "../lib/seo";
import { CardSkeleton } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";

export default function MakersPage() {
  const [makers, setMakers] = useState(null);
  useEffect(() => { fetchMakers().then(setMakers).catch(() => setMakers([])); }, []);

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
        <h1 className="font-display text-[64px] md:text-[120px] leading-[0.88] mb-16">
          The <span className="text-outline-orange">Workshop</span><br />Roster
        </h1>
        <div className="grid md:grid-cols-2 gap-8">
          {makers === null ? (
            <div className="md:col-span-2"><CardSkeleton count={4} /></div>
          ) : makers.length === 0 ? (
            <div className="md:col-span-2">
              <EmptyState
                icon={Users}
                eyebrow="◆ Workshop Roster"
                title="The roster is filling up."
                body="No approved makers yet — check back soon, or apply if you're an independent CNC artist."
                cta={{ label: "Apply to Sell", href: "/apply", testId: "makers-empty-cta" }}
                testId="makers-empty"
              />
            </div>
          ) : (
            makers.map((m) => (
            <Link key={m.id} to={`/makers/${m.slug}`} data-testid={`maker-card-${m.slug}`}
              className="group bg-[#121212] border border-[#262626] hover:border-[#ff4500] transition overflow-hidden">
              <div className="aspect-[4/3] overflow-hidden relative">
                <img src={m.cover} alt={m.name} className="w-full h-full object-cover media-img group-hover:scale-105 transition duration-700" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
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
