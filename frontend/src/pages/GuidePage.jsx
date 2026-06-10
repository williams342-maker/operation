import React from "react";
import { Link } from "react-router-dom";
import { useStructuredData } from "../lib/seo";
import Breadcrumbs from "../components/Breadcrumbs";

const SITE_URL = "https://craftersmarket.org";

/**
 * GuidePage (iter301 / Phase 4 Bundle A)
 * --------------------------------------
 * Reusable long-form content-hub page. Used for educational guides
 * that target informational-intent SEO queries:
 *   • /guides/plasma-vs-laser-vs-router
 *   • /guides/outdoor-mounting-guide
 *   • /guides/metal-gauge-finish-guide
 *
 * Each guide ships:
 *   • Visible Breadcrumbs (Home › Guides › <title>)
 *   • Long-form body (~700-1200 words across 5+ H2 sections)
 *   • FAQ accordion with FAQPage JSON-LD
 *   • Related-links grid back to landing pages + custom-order form
 *   • Article + BreadcrumbList + FAQPage JSON-LD in @graph
 *
 * Config schema (one entry per guide in `guideConfig.js`):
 *   {
 *     slug, title, eyebrow, h1, intro,
 *     publishedAt, updatedAt,
 *     sections: [{ heading, paragraphs[], list?[] }],
 *     faqs: [{ q, a }],
 *     relatedLinks: [{ to, label, blurb? }],
 *     image: optional hero override (defaults to the CNC garage hero),
 *   }
 */
export default function GuidePage({ config }) {
  const {
    slug, title, eyebrow, h1, intro, publishedAt, updatedAt,
    sections = [], faqs = [], relatedLinks = [],
    image = `${SITE_URL}/downloads/cnc-garage-builders.png`,
  } = config;

  const canonical = `${SITE_URL}/guides/${slug}`;

  useStructuredData({
    title: `${title} · Crafters Market`,
    description: intro,
    url: canonical,
    image,
    imageAlt: title,
    ogType: "article",
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Article",
          "@id": `${canonical}#article`,
          headline: title,
          description: intro,
          image,
          url: canonical,
          datePublished: publishedAt,
          dateModified: updatedAt || publishedAt,
          author: { "@type": "Organization", name: "Crafters Market" },
          publisher: {
            "@type": "Organization",
            name: "Crafters Market",
            logo: { "@type": "ImageObject", url: `${SITE_URL}/cm-logo-512.png` },
          },
          mainEntityOfPage: canonical,
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
            { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guides` },
            { "@type": "ListItem", position: 3, name: title, item: canonical },
          ],
        },
        ...(faqs.length ? [{
          "@type": "FAQPage",
          "@id": `${canonical}#faq`,
          mainEntity: faqs.map(({ q, a }) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        }] : []),
      ],
    },
  });

  return (
    <div className="pb-24 grain min-h-screen" data-testid={`guide-page-${slug}`}>
      <div className="w-full max-w-[1400px] mx-auto px-4 md:px-8 pt-16 md:pt-24">
        <Breadcrumbs
          items={[
            { name: "Home", to: "/" },
            { name: "Guides" },
            { name: title },
          ]}
          testId={`guide-breadcrumbs-${slug}`}
        />
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
          ◆ {eyebrow}
        </div>
        <h1
          className="font-display text-[40px] sm:text-[56px] md:text-[80px] lg:text-[96px] leading-[0.95] mb-8"
          data-testid={`guide-h1-${slug}`}
        >
          {h1}
        </h1>
        <p className="font-mono text-base text-ink max-w-3xl leading-relaxed mb-6">
          {intro}
        </p>
        {publishedAt && (
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-12">
            ◆ Published {new Date(publishedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            {updatedAt && updatedAt !== publishedAt && (
              <> · Updated {new Date(updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</>
            )}
          </p>
        )}

        {/* Body sections */}
        {sections.length > 0 && (
          <div className="border-t border-line pt-12 space-y-14">
            {sections.map((section, idx) => (
              <section
                key={idx}
                className="max-w-3xl"
                data-testid={`guide-section-${slug}-${idx}`}
              >
                <h2 className="font-display text-2xl md:text-4xl uppercase mb-5 leading-tight">
                  {section.heading}
                </h2>
                {section.paragraphs.map((p, pi) => (
                  <p
                    key={pi}
                    className="font-mono text-sm md:text-base text-ink-muted leading-relaxed mb-4"
                  >
                    {p}
                  </p>
                ))}
                {Array.isArray(section.list) && section.list.length > 0 && (
                  <ul className="mt-4 space-y-2 max-w-2xl">
                    {section.list.map((li, li_idx) => (
                      <li
                        key={li_idx}
                        className="font-mono text-sm text-ink pl-5 relative leading-relaxed"
                      >
                        <span className="absolute left-0 top-2 w-2 h-2 bg-brand" />
                        {li}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}

        {/* FAQ */}
        {faqs.length > 0 && (
          <div className="border-t border-line mt-20 pt-12" data-testid={`guide-faq-${slug}`}>
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
                  data-testid={`guide-faq-item-${slug}-${idx}`}
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

        {/* CTAs */}
        <div className="border-t border-line mt-20 pt-12">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ Ready to commission?
          </div>
          <h2 className="font-display text-3xl md:text-5xl uppercase mb-6 max-w-3xl leading-tight">
            Take what you learned. Build something real.
          </h2>
          <div className="flex flex-wrap gap-3">
            <Link to="/custom-order" className="btn-industrial btn-primary" data-testid={`guide-cta-${slug}`}>
              Start a custom order →
            </Link>
            <Link to="/shop" className="btn-industrial btn-secondary">
              Browse the catalog →
            </Link>
            <Link to="/makers" className="btn-industrial btn-secondary">
              Meet the makers →
            </Link>
          </div>
        </div>

        {/* Related links */}
        {relatedLinks.length > 0 && (
          <div className="border-t border-line mt-20 pt-12" data-testid={`guide-related-${slug}`}>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
              ◆ Related categories &amp; guides
            </div>
            <h2 className="font-display text-3xl md:text-5xl uppercase mb-8">
              Keep reading
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {relatedLinks.map(({ to, label, blurb }, idx) => (
                <Link
                  key={idx}
                  to={to}
                  className="group border border-line hover:border-brand p-5 transition block"
                  data-testid={`guide-related-link-${slug}-${idx}`}
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
