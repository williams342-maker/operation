import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Users } from "lucide-react";
import { fetchMakers, fetchProducts } from "../lib/api";
import { useStructuredData } from "../lib/seo";
import { CardSkeleton } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import VeteranBadge from "../components/VeteranBadge";
import Breadcrumbs from "../components/Breadcrumbs";
import MakerLeaderboard from "../components/MakerLeaderboard";
import ShopHeroMosaic from "../components/ShopHeroMosaic";

const SITE_URL = "https://craftersmarket.org";

export default function MakersPage() {
  const [makers, setMakers] = useState(null);
  const [products, setProducts] = useState(null);
  const [params, setParams] = useSearchParams();
  const veteranOnly = params.get("veteran") === "1";

  useEffect(() => { fetchMakers().then(setMakers).catch(() => setMakers([])); }, []);
  // iter358 — Hero mosaic on /makers reuses the same /api/products
  // feed but routes each tile to the maker's shop page rather than
  // the PDP, so clicks send buyers into the maker's catalog instead
  // of a single listing.
  useEffect(() => { fetchProducts().then(setProducts).catch(() => setProducts([])); }, []);

  const filtered = useMemo(() => {
    if (!makers) return null;
    return veteranOnly ? makers.filter((m) => m.is_veteran_owned) : makers;
  }, [makers, veteranOnly]);

  useStructuredData({
    title: "Meet the Makers · Vetted CNC, Plasma & Laser Artisans · Crafters Market",
    description: "Meet the workshop roster — independent metal, wood, and CNC artists hand-vetted to sell on Crafters Market. Each shop ships direct to buyers via Stripe-secured checkout.",
    url: `${SITE_URL}/makers`,
    image: `${SITE_URL}/downloads/cnc-garage-builders.png`,
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "CollectionPage",
          name: "Crafters Market — Approved Makers",
          url: `${SITE_URL}/makers`,
          isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website` },
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: (makers || []).length,
            itemListElement: (makers || []).slice(0, 20).map((m, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `${SITE_URL}/makers/${m.slug}`,
              name: m.name,
            })),
          },
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
            { "@type": "ListItem", position: 2, name: "Makers", item: `${SITE_URL}/makers` },
          ],
        },
      ],
    },
  });

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="makers-page">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <Breadcrumbs
          items={[
            { name: "Home", to: "/" },
            { name: "Makers" },
          ]}
          testId="makers-breadcrumbs"
        />
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">◆ APPROVED MAKERS</div>
        {/* iter358 — 2-col hero with rotating mosaic on the right
            (lg+). Tiles route to the maker shop page, not the PDP. */}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] gap-8 lg:gap-12 items-start mb-12">
          <h1 className="font-display text-[64px] md:text-[120px] leading-[0.88]">
            The <span className="text-outline-orange">Workshop</span><br />Roster
          </h1>
          <ShopHeroMosaic
            products={products}
            testId="makers-hero-mosaic"
            impressionSource="makers_mosaic"
            linkBuilder={(p) => p.maker_slug ? `/makers/${p.maker_slug}` : `/shop/${p.slug}`}
          />
        </div>

        {/* iter335.15 — Maker Leaderboard widget (self-hides when admin toggles OFF or list is empty) */}
        <MakerLeaderboard />

        {/* Veteran-owned filter pills */}
        <div className="flex flex-wrap items-center gap-2 mb-12" data-testid="makers-filters">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mr-1">Filter:</span>
          <button
            onClick={() => setParams({})}
            className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
              !veteranOnly
                ? "border-brand text-brand bg-brand/5"
                : "border-line text-ink-muted hover:border-line"
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
                : "border-line text-ink-muted hover:border-line"
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
        {/* iter331e — Grid gets a 3-column breakpoint at lg+ so each
            card is ~34% narrower on wide screens (user feedback: cards
            were too big at 2-col on desktop). Mobile and tablet stay
            at 1/2 col for readability. */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-7">
          {filtered === null ? (
            <div className="md:col-span-2 lg:col-span-3"><CardSkeleton count={4} /></div>
          ) : filtered.length === 0 ? (
            <div className="md:col-span-2 lg:col-span-3">
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
              className="group bg-surface border border-line hover:border-brand transition overflow-hidden">
              <div className="aspect-[4/3] overflow-hidden relative">
                <img src={m.cover} alt={m.name} className="w-full h-full object-cover media-img group-hover:scale-105 transition duration-700" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                {m.is_veteran_owned && (
                  <VeteranBadge
                    className="absolute top-4 right-4 bg-black/70"
                    testId={`maker-card-veteran-${m.slug}`}
                  />
                )}
                {m.featured_example && (
                  <span
                    className="tag absolute top-4 left-4 text-amber-300 border-amber-400/70 bg-black/80 text-[9px]"
                    data-testid={`maker-card-featured-example-${m.slug}`}
                    title="Founding maker · curated by Crafters Market to showcase the platform"
                  >
                    ✦ FOUNDING MAKER
                  </span>
                )}
                <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                  <div>
                    <div className="font-display text-3xl text-white">{m.name}</div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted mt-1">{m.location}</div>
                  </div>
                  <div className="tag text-brand border-brand">{m.listings_count} listings</div>
                </div>
              </div>
              <div className="p-6 border-t border-line">
                <p className="font-mono text-xs text-ink-muted leading-relaxed mb-4">{m.bio}</p>
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
