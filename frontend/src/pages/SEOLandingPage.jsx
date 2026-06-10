import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchProducts, fetchMakers } from "../lib/api";
import ProductCard from "../components/ProductCard";
import { CardSkeleton } from "../components/Skeleton";
import { useStructuredData } from "../lib/seo";
import SupportVeteransStrip from "../components/SupportVeteransStrip";
import Breadcrumbs from "../components/Breadcrumbs";

const SITE_URL = "https://craftersmarket.org";

/**
 * SEOLandingPage (Phase 3 / iter300)
 * ----------------------------------
 * Keyword-targeted landing page for high-intent search queries. Each
 * page has:
 *   • Visible breadcrumb (Home › <keyword>) — added iter300.
 *   • H1 that exactly matches the target search phrase (biggest ranking
 *     factor after `<title>`).
 *   • Long-form body copy (300–600 words on the rich pages) — Google
 *     rewards topical depth, not just keyword density.
 *   • A live product or maker grid filtered by `match` so the page
 *     never looks empty.
 *   • Per-page `CollectionPage` + `ItemList` + `BreadcrumbList` +
 *     `FAQPage` JSON-LD blocks combined in a `@graph` (eligible for
 *     SERP rich results — "People also ask", "Top results" carousels).
 *   • FAQ accordion at the bottom of the page (iter300) — surfaces the
 *     same answers visible to humans, increases time-on-page.
 *   • Related-landing-page link grid (iter300) — internal-link equity
 *     between sibling keyword pages so SERP discovery cascades.
 *   • Standard CTAs back to /shop, /makers, /custom-order.
 *
 * Config keys consumed:
 *   slug, keyword, h1, eyebrow, intro, paragraphs[], match,
 *   mode ("products" | "makers"), ctaLabel, ctaHref,
 *   faqs[]            — iter300, array of { q, a }
 *   relatedLinks[]    — iter300, array of { to, label, blurb? }
 *   bodyExtras[]      — iter300, array of { heading, paragraphs[] }
 *                       Rendered as additional H2 sections between
 *                       the intro paragraphs and the live grid.
 */
export default function SEOLandingPage({ config }) {
  const {
    slug, keyword, h1, eyebrow, intro, paragraphs,
    match, mode = "products", ctaLabel = "Browse the marketplace",
    ctaHref = "/shop", faqs = [], relatedLinks = [], bodyExtras = [],
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
      ? `${SITE_URL}/makers/${it.slug}`
      : `${SITE_URL}/shop/${it.slug}`
  ));

  // @graph composition — modern Google preference. We combine
  // CollectionPage, BreadcrumbList, optional FAQPage, and the inline
  // ItemList into a single JSON-LD block.
  const graphParts = [
    {
      "@type": "CollectionPage",
      "@id": `${SITE_URL}/${slug}#page`,
      name: `${keyword} · Crafters Market`,
      description: intro,
      url: `${SITE_URL}/${slug}`,
      isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website` },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: keyword, item: `${SITE_URL}/${slug}` },
      ],
    },
  ];
  if (itemListUrls.length) {
    graphParts.push({
      "@type": "ItemList",
      numberOfItems: itemListUrls.length,
      itemListElement: itemListUrls.map((url, i) => ({
        "@type": "ListItem", position: i + 1, url,
      })),
    });
  }
  if (faqs.length) {
    graphParts.push({
      "@type": "FAQPage",
      "@id": `${SITE_URL}/${slug}#faq`,
      mainEntity: faqs.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    });
  }

  useStructuredData({
    title: `${keyword} · Crafters Market`,
    description: intro,
    url: `${SITE_URL}/${slug}`,
    image: `${SITE_URL}/downloads/cnc-garage-builders.png`,
    imageAlt: `${keyword} on Crafters Market`,
    ogType: "website",
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": graphParts,
    },
  });

  return (
    <div className="pb-24 grain min-h-screen" data-testid={`seo-page-${slug}`}>
      <SupportVeteransStrip />
      <div className="w-full max-w-[1400px] mx-auto px-4 md:px-8 pt-16 md:pt-24">
        <Breadcrumbs
          items={[
            { name: "Home", to: "/" },
            { name: keyword },
          ]}
          testId={`seo-breadcrumbs-${slug}`}
        />
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
          ◆ {eyebrow}
        </div>
        <h1
          className="font-display text-[44px] sm:text-[64px] md:text-[88px] lg:text-[112px] leading-[0.92] mb-8"
          data-testid={`seo-h1-${slug}`}
        >
          {h1}
        </h1>

        <p className="font-mono text-base text-ink max-w-3xl leading-relaxed mb-6">
          {intro}
        </p>

        {paragraphs?.map((p, i) => (
          <p
            key={i}
            className="font-mono text-sm text-ink-muted max-w-3xl leading-relaxed mb-4"
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

        {/* Body extras (iter300) — additional H2 sections with deep
            content. Renders only when the config supplies them. */}
        {bodyExtras.length > 0 && (
          <div className="border-t border-line pt-12 mb-16 space-y-12">
            {bodyExtras.map((section, idx) => (
              <section
                key={idx}
                data-testid={`seo-body-extra-${slug}-${idx}`}
                className="max-w-3xl"
              >
                <h2
                  className="font-display text-2xl md:text-4xl uppercase mb-4 leading-tight"
                  data-testid={`seo-body-extra-heading-${slug}-${idx}`}
                >
                  {section.heading}
                </h2>
                {section.paragraphs.map((p, pi) => (
                  <p
                    key={pi}
                    className="font-mono text-sm text-ink-muted leading-relaxed mb-4"
                  >
                    {p}
                  </p>
                ))}
              </section>
            ))}
          </div>
        )}

        {/* Live grid — products or makers depending on mode. */}
        <div className="border-t border-line pt-12">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
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
            <div className="border border-dashed border-line p-8 text-center" data-testid={`seo-empty-${slug}`}>
              <p className="font-mono text-sm text-ink-muted">
                Nothing live in this category yet. Browse the full marketplace or commission a custom piece below.
              </p>
            </div>
          ) : mode === "makers" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {grid.map((m) => (
                <Link
                  key={m.slug}
                  to={`/makers/${m.slug}`}
                  className="group border border-line hover:border-brand transition overflow-hidden"
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
                    <div className="aspect-[4/3] w-full bg-surface grid place-items-center font-display text-3xl text-ink-muted">
                      {(m.name || "?").slice(0, 1)}
                    </div>
                  )}
                  <div className="p-4">
                    <div className="font-display text-xl mb-1 group-hover:text-brand transition">
                      {m.name}
                    </div>
                    {m.location && (
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
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

        {/* FAQ section (iter300) — visible to users + ranked by Google
            via FAQPage schema above. */}
        {faqs.length > 0 && (
          <div className="border-t border-line mt-20 pt-12" data-testid={`seo-faq-${slug}`}>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
              ◆ FAQ
            </div>
            <h2 className="font-display text-3xl md:text-5xl uppercase mb-8">
              Frequently asked questions
            </h2>
            <div className="max-w-3xl space-y-4">
              {faqs.map(({ q, a }, idx) => (
                <details
                  key={idx}
                  className="border border-line bg-paper open:border-brand transition"
                  data-testid={`seo-faq-item-${slug}-${idx}`}
                >
                  <summary className="cursor-pointer list-none p-4 flex items-start justify-between gap-4 font-mono text-sm text-ink hover:text-brand">
                    <span className="flex-1">{q}</span>
                    <span className="font-display text-xl shrink-0">+</span>
                  </summary>
                  <div className="px-4 pb-4 pt-2 border-t border-line font-mono text-sm text-ink-muted leading-relaxed">
                    {a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}

        {/* Related landing pages (iter300) — internal-link grid for
            crawler equity flow between sibling keyword pages. */}
        {relatedLinks.length > 0 && (
          <div className="border-t border-line mt-20 pt-12" data-testid={`seo-related-${slug}`}>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
              ◆ Related categories
            </div>
            <h2 className="font-display text-3xl md:text-5xl uppercase mb-8">
              Keep exploring
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {relatedLinks.map(({ to, label, blurb }, idx) => (
                <Link
                  key={idx}
                  to={to}
                  className="group border border-line hover:border-brand p-5 transition block"
                  data-testid={`seo-related-link-${slug}-${idx}`}
                >
                  <div className="font-display text-xl mb-2 group-hover:text-brand transition">
                    {label} →
                  </div>
                  {blurb && (
                    <p className="font-mono text-[11px] text-ink-muted leading-relaxed">
                      {blurb}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
