/**
 * PricingPage — /pricing
 * ----------------------
 * iter345c — Dedicated comparison landing page so people searching
 * "crafters market vs etsy" / "crafters market fees" land on a page
 * built for that exact intent (vs being trapped on /apply which is
 * conversion-funnel-shaped, not SEO-shaped).
 *
 * Sections (top-to-bottom):
 *   1. Hero — direct answer to "what does it cost?" in plain English
 *   2. PricingComparisonTable — the 6-column / 9-row breakdown
 *   3. MakerFeeTable — exact-dollar founder pricing
 *   4. FAQ — 6 questions Google snippets love
 *   5. CTA — Apply now / Browse the marketplace
 *
 * SEO scaffolding:
 *   - Direct `document.title` + meta description set on mount (no
 *     Helmet in this codebase — see PressPage for the same pattern)
 *   - JSON-LD FAQPage schema embedded for rich-result eligibility
 *   - h1 + h2 hierarchy with keyword-aware phrasing
 *   - Internal links to /apply, /shop, /founders so the page passes
 *     authority back into the rest of the site
 */
import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import PricingComparisonTable from "../components/PricingComparisonTable";
import MakerFeeTable from "../components/MakerFeeTable";

const FAQ = [
  {
    q: "What does it cost to sell on Crafters Market?",
    a: "During beta, opening a shop is free. Approved makers in the founder cohort lock in a 3% transaction fee for life. Stripe processing applies on top (standard 2.9% + $0.30). No monthly fees, no listing fees, no hidden cuts.",
  },
  {
    q: "How does Crafters Market compare to Etsy fees?",
    a: "Etsy charges $0.20 per listing plus a 6.5% transaction fee on every sale, plus ~3% + $0.25 payment processing. Crafters Market charges no listing fees and 3% transaction (founder pricing for life). On a $50 sale you'd save roughly $1.95 per order vs Etsy — about $195 on 100 sales.",
  },
  {
    q: "How does Crafters Market compare to Amazon Handmade?",
    a: "Amazon Handmade charges a 15% referral fee on every sale (includes payment processing). Crafters Market is 3% + Stripe processing (~5.9% effective total) — roughly a 60% reduction in platform take versus Handmade for the same $50 sale.",
  },
  {
    q: "Is there a monthly subscription?",
    a: "No. Crafters Market is free to open a shop during beta. Compare to Shopify Basic at $39/month (or $29/month annually), which has no built-in marketplace traffic at all.",
  },
  {
    q: "Do I need to run ads to make sales here?",
    a: "Ads are optional. Crafters Market includes a built-in promotion engine that helps you allocate budget across Meta, Google, and Microsoft when you're ready to scale — but unlike platforms where visibility shrinks without paid placement, organic discovery is built into the marketplace.",
  },
  {
    q: "How is Crafters Market different from a Shopify store?",
    a: "Shopify gives you a storefront but no traffic — you bring 100% of buyers yourself. Crafters Market is a shared marketplace with curated maker discovery, a community clip feed, monthly leaderboards, and built-in SEO infrastructure (auto-tagging, sitemaps, structured data). Lower upfront marketing cost to first sale.",
  },
];

export default function PricingPage() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Crafters Market Pricing — How We Compare to Etsy, Shopify & Amazon Handmade";
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute("content");
    if (meta) {
      meta.setAttribute(
        "content",
        "Side-by-side fee comparison of Crafters Market vs Etsy, Shopify, Amazon Handmade, and Faire. No listing fees, 3% founder transaction pricing for life, and a curated maker marketplace.",
      );
    }
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc) meta.setAttribute("content", prevDesc);
    };
  }, []);

  // JSON-LD FAQ schema — Google may surface these as rich results
  // ("People also ask" snippets) for relevant queries.
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="bg-[#0a0a0a] text-[#f5f5f5] min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-16 md:py-24">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
          ◆ Pricing
        </div>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.05] mb-6">
          What it actually costs to sell here.
        </h1>
        <p className="font-mono text-base md:text-lg text-[#a3a3a3] max-w-3xl leading-relaxed mb-3">
          No monthly fees. No per-listing fees. <span className="text-[#ff4500]">3% transaction
          for life</span> if you join the founder cohort. Below: a line-for-line breakdown vs
          Etsy, Shopify, Amazon Handmade, and Faire — with citations.
        </p>
        <p className="font-mono text-xs text-[#737373] max-w-3xl leading-relaxed">
          Updated {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}.
        </p>
      </section>

      {/* Founder pricing detail */}
      <section className="max-w-5xl mx-auto px-6 pb-12">
        <h2 className="font-display text-3xl md:text-4xl mb-4">Founder pricing — locked for life</h2>
        <MakerFeeTable title="Your full fee breakdown if approved" />
      </section>

      {/* Comparison table */}
      <section className="max-w-5xl mx-auto px-6 pb-12">
        <h2 className="font-display text-3xl md:text-4xl mb-4">Side-by-side comparison</h2>
        <PricingComparisonTable />
      </section>

      {/* FAQ */}
      <section className="max-w-5xl mx-auto px-6 pb-12">
        <h2 className="font-display text-3xl md:text-4xl mb-6">Frequently asked</h2>
        <div className="space-y-3">
          {FAQ.map((f, i) => (
            <details
              key={f.q}
              className="border border-[#262626] p-4 md:p-5 group"
              data-testid={`pricing-faq-${i}`}
            >
              <summary className="font-display text-lg md:text-xl cursor-pointer list-none flex items-start justify-between gap-4">
                <span>{f.q}</span>
                <span className="font-mono text-[#525252] group-open:rotate-45 transition-transform text-2xl leading-none shrink-0">
                  +
                </span>
              </summary>
              <p className="font-mono text-sm text-[#a3a3a3] mt-3 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="border border-[#ff4500] p-6 md:p-10 bg-gradient-to-br from-[#ff4500]/5 to-transparent">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ Ready to apply?
          </div>
          <h2 className="font-display text-3xl md:text-4xl mb-3">Lock in founder pricing.</h2>
          <p className="font-mono text-sm text-[#a3a3a3] max-w-2xl mb-6 leading-relaxed">
            Apply once. We review applications by hand within 48 hours. Approved makers join the
            founder cohort with 3% transaction pricing for life and dedicated onboarding.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/apply"
              className="inline-flex items-center px-5 py-3 bg-[#ff4500] text-[#0a0a0a] font-mono text-[11px] uppercase tracking-[0.22em] hover:bg-orange-400 transition"
              data-testid="pricing-cta-apply"
            >
              Apply now →
            </Link>
            <Link
              to="/shop"
              className="inline-flex items-center px-5 py-3 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] transition"
              data-testid="pricing-cta-shop"
            >
              Browse the marketplace
            </Link>
            <Link
              to="/founders"
              className="inline-flex items-center px-5 py-3 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] transition"
              data-testid="pricing-cta-founders"
            >
              See founder slots remaining
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
