import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchProducts, fetchMakers } from "../lib/api";
import ProductCard from "../components/ProductCard";
import { CardSkeleton } from "../components/Skeleton";
import { useStructuredData } from "../lib/seo";
import SupportVeteransStrip from "../components/SupportVeteransStrip";

/**
 * SEOLandingPage
 * --------------
 * Keyword-targeted landing page for high-intent search queries. Each
 * page has:
 *   • H1 that exactly matches the target search phrase (single biggest
 *     ranking factor after `<title>`).
 *   • Long-form body copy with the keyword + 2–3 related variants
 *     (Google rewards topical depth, not just keyword stuffing).
 *   • A live product or maker grid filtered by `match` so the page
 *     never looks empty.
 *   • Per-page CollectionPage JSON-LD with the page's name + URL +
 *     an ItemList of up to 12 results (eligible for rich-result
 *     "Top results" carousels in SERP).
 *   • Internal links back to /shop, /makers, /custom-order so search
 *     engines see strong site structure from these landing pages.
 *
 * Driven by `config` props passed in from `App.js` route definitions.
 * One component, six pages, zero duplication.
 */
export default function SEOLandingPage({ config }) {
  const {
    slug, keyword, h1, eyebrow, intro, paragraphs,
    match, mode = "products", ctaLabel = "Browse the marketplace",
    ctaHref = "/shop",
  } = config;

  const [items, setItems] = useState(null);

  useEffect(() => {
    const loader = mode === "makers" ? fetchMakers : fetchProducts;
    loader()
      .then((all) => setItems((all || []).filter(match || (() => true))))
      .catch(() => setItems([]));
  }, [mode, match]);

  const grid = useMemo(() => (items || []).slice(0, 24), [items]);

  // Build a CollectionPage + ItemList schema with the current results.
  // Item URLs use the canonical shop/maker route so link-equity flows
  // back to the primary pages even when this landing page ranks.
  const itemListUrls = grid.slice(0, 12).map((it) => (
    mode === "makers"
      ? `https://craftersmarket.org/makers/${it.slug}`
      : `https://craftersmarket.org/shop/${it.slug}`
  ));

  useStructuredData({
    title: `${keyword} · Crafters Market`,
    description: intro,
    url: `https://craftersmarket.org/${slug}`,
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    imageAlt: `${keyword} on Crafters Market`,
    ogType: "website",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${keyword} · Crafters Market`,
      description: intro,
      url: `https://craftersmarket.org/${slug}`,
      isPartOf: { "@type": "WebSite", "@id": "https://craftersmarket.org/#website" },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://craftersmarket.org/" },
          { "@type": "ListItem", position: 2, name: keyword, item: `https://craftersmarket.org/${slug}` },
        ],
      },
      mainEntity: itemListUrls.length ? {
        "@type": "ItemList",
        numberOfItems: itemListUrls.length,
        itemListElement: itemListUrls.map((url, i) => ({
          "@type": "ListItem", position: i + 1, url,
        })),
      } : undefined,
    },
  });

  return (
    <div className="pb-24 grain min-h-screen" data-testid={`seo-page-${slug}`}>
      <SupportVeteransStrip />
      <div className="w-full max-w-[1400px] mx-auto px-4 md:px-8 pt-16 md:pt-24">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
          ◆ {eyebrow}
        </div>
        {/* H1 exact-match with the target keyword phrase. */}
        <h1
          className="font-display text-[44px] sm:text-[64px] md:text-[88px] lg:text-[112px] leading-[0.92] mb-8"
          data-testid={`seo-h1-${slug}`}
        >
          {h1}
        </h1>

        <p className="font-mono text-base text-[#e5e5e5] max-w-3xl leading-relaxed mb-6">
          {intro}
        </p>

        {paragraphs?.map((p, i) => (
          <p
            key={i}
            className="font-mono text-sm text-[#a3a3a3] max-w-3xl leading-relaxed mb-4"
            data-testid={`seo-paragraph-${slug}-${i}`}
          >
            {p}
          </p>
        ))}

        <div className="flex flex-wrap gap-3 mt-8 mb-16">
          <Link
            to={ctaHref}
            className="btn-industrial btn-primary"
            data-testid={`seo-cta-${slug}`}
          >
            {ctaLabel} →
          </Link>
          <Link to="/custom-order" className="btn-industrial btn-secondary">
            Commission custom →
          </Link>
          <Link to="/makers" className="btn-industrial btn-secondary">
            Meet the makers →
          </Link>
        </div>

        {/* Live grid — products or makers depending on mode. */}
        <div className="border-t border-[#262626] pt-12">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ {mode === "makers" ? "Featured shops" : "Live listings"}
          </div>
          <h2 className="font-display text-3xl md:text-5xl uppercase mb-8">
            {mode === "makers" ? "Shops in this category" : `Browse ${keyword}`}
          </h2>

          {items === null ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : grid.length === 0 ? (
            <div className="border border-dashed border-[#262626] p-8 text-center" data-testid={`seo-empty-${slug}`}>
              <p className="font-mono text-sm text-[#a3a3a3]">
                Nothing live in this category yet. Browse the full marketplace or commission a custom piece below.
              </p>
            </div>
          ) : mode === "makers" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {grid.map((m) => (
                <Link
                  key={m.slug}
                  to={`/makers/${m.slug}`}
                  className="group border border-[#262626] hover:border-[#ff4500] transition overflow-hidden"
                  data-testid={`seo-${slug}-maker-${m.slug}`}
                >
                  {m.cover || m.banner_image_url ? (
                    <img
                      src={m.banner_image_url || m.cover}
                      alt={m.name}
                      className="aspect-[4/3] w-full object-cover group-hover:scale-105 transition duration-700"
                      loading="lazy"
                    />
                  ) : (
                    <div className="aspect-[4/3] w-full bg-[#121212] grid place-items-center font-display text-3xl text-[#525252]">
                      {(m.name || "?").slice(0, 1)}
                    </div>
                  )}
                  <div className="p-4">
                    <div className="font-display text-xl mb-1 group-hover:text-[#ff4500] transition">
                      {m.name}
                    </div>
                    {m.location && (
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
                        {m.location}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {grid.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
