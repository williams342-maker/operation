import React from "react";
import { Link } from "react-router-dom";
import { useStructuredData } from "../lib/seo";
import Breadcrumbs from "../components/Breadcrumbs";

const SITE_URL = "https://craftersmarket.org";

/**
 * HowCustomOrdersWorkPage (iter300 / Phase 3)
 * -------------------------------------------
 * SEO hub page that explains the end-to-end custom-order flow on
 * Crafters Market. Targets transactional keywords like "how do custom
 * orders work", "custom CNC commission process", "made-to-order
 * marketplace process".
 *
 * Why a dedicated hub:
 *   • `/custom-order` is the *form* — buyers landing there cold can be
 *     intimidated by the brief inputs without context.
 *   • This page sits between top-of-funnel SEO landing pages
 *     (`/custom-metal-signs`, `/wedding-gifts`, etc.) and the form
 *     itself, answering "what am I signing up for?" before commitment.
 *   • Ships FAQPage + HowTo + BreadcrumbList JSON-LD for SERP
 *     rich-result eligibility.
 *
 * Inbound links from every Phase-3 landing page's `relatedLinks` grid.
 * Outbound links to /custom-order (primary CTA) and /shop (secondary).
 */

const STEPS = [
  {
    n: "01",
    title: "Submit a brief",
    body:
      "Tell us what you want made — the piece type, rough dimensions, material preference, finish, and your target timeline. Don't worry about jargon; describe it in plain language. Upload reference photos, sketches, or vector files if you have them. The brief takes 3-5 minutes; nothing is binding yet.",
  },
  {
    n: "02",
    title: "Get matched to a maker",
    body:
      "Our routing system matches your brief to vetted makers with the right tooling (plasma, laser, router, forge, woodshop), the right material on hand, and an honest timeline that fits your deadline. Usually within 24 hours you'll have at least one maker reviewing your brief — often two or three for popular categories.",
  },
  {
    n: "03",
    title: "Review the quote and design proof",
    body:
      "The maker sends you a written quote (materials, machine time, finish, total), a CAD render or hand sketch with the final dimensions, and a confirmed lead time. You can ask for revisions — different size, alternative material, swapped font — at no charge before the design is locked. Nothing is built yet.",
  },
  {
    n: "04",
    title: "Approve, pay, and watch it come together",
    body:
      "Once you approve the proof and confirm the timeline, you pay via Stripe-secured checkout. Funds go into escrow — held by Stripe Connect, NOT released to the maker until the piece ships. Many makers post work-in-progress photos to your messages thread as the build comes together.",
  },
  {
    n: "05",
    title: "Receive and inspect",
    body:
      "The maker packs your piece with hardware (if applicable), mounting diagram, and care instructions. They ship USPS, UPS, FedEx, or freight depending on size and weight. You receive a tracking number; once delivered, you have a brief window to inspect for defects before Stripe releases funds to the maker. Any quality issues are resolved by the maker remaking or refunding — fully Stripe-protected.",
  },
];

const FAQS = [
  {
    q: "How long does the whole custom-order process take?",
    a: "From brief to delivery, expect 3-8 weeks depending on the piece. Small engraved or laser-cut items (cutting boards, small plaques) often ship within 2-3 weeks of brief approval. Medium custom signs and metal art take 3-5 weeks. Large entry signs, multi-piece furniture, or commissioned art take 6-8 weeks. Inside that window, the brief-to-quote phase is usually 1-3 days; design-proof approval is 3-7 days; build and finish is the bulk of the timeline.",
  },
  {
    q: "Do I pay upfront for a custom order?",
    a: "Yes, after you approve the design proof — but the funds go into Stripe Connect escrow, not directly to the maker. The maker doesn't receive payment until your piece actually ships and the carrier confirms delivery. This protects you against non-delivery and protects the maker against custom-piece reneging. If anything goes wrong, Stripe's dispute resolution applies the same way it does on any Stripe payment.",
  },
  {
    q: "What if I don't like the design proof?",
    a: "Tell the maker what to change. Revisions to the design proof are free — different proportions, different font, different finish, different layout. You can iterate as many times as needed before approving. The maker only locks the design and starts building after you write 'approved' in the thread. If after several rounds you and the maker can't agree on a design, you can walk away with no charge; nothing has been built.",
  },
  {
    q: "Can I commission something the maker has never built before?",
    a: "Often yes — most of our makers love novel commissions. They'll be honest in the quote phase if your idea is outside their wheelhouse or requires tooling they don't have. If it's not a fit, our routing team will pivot the brief to a different maker with the right setup. Truly novel one-offs (e.g., a 12-foot custom sculpture in mixed materials) may take longer to source the right maker.",
  },
  {
    q: "What if the piece arrives damaged?",
    a: "Document the damage with photos immediately and message the maker in the order thread. If it's shipping damage, the maker files the carrier claim and either repairs/replaces the piece or refunds. If it's a workmanship defect, the maker remakes the piece at no cost. Stripe holds your funds until delivery is confirmed clean, so you're never out-of-pocket on a defective piece.",
  },
  {
    q: "Can I order multiples or commission a small batch?",
    a: "Yes — many makers offer multi-piece set pricing for batches of 2-10 identical or near-identical pieces (groomsmen gifts, family-name sets, retail-display batches). Tell the maker your count in the brief and they'll quote with the batch discount applied. For larger commercial runs (50+), we can route the brief to makers with production capacity rather than one-off-focused shops.",
  },
  {
    q: "Do you take international orders?",
    a: "Currently, custom orders ship within the United States only — domestic shipping is standardized and predictable. International shipping on custom one-off pieces gets complicated with customs declarations, carrier liability on irreplaceable items, and tariff treatment of handmade goods. We're working on it. Email team@craftersmarket.org if you have a specific international need and we'll see if a maker can accommodate.",
  },
];

const RELATED = [
  { to: "/custom-metal-signs", label: "Custom Metal Signs", blurb: "Plasma-cut and laser-cut steel signs to spec." },
  { to: "/personalized-gifts", label: "Personalized Gifts", blurb: "Engraved, monogrammed, and made-to-order keepsakes." },
  { to: "/wedding-gifts", label: "Wedding & Anniversary Gifts", blurb: "Handmade pieces for ceremonies and milestone gifts." },
  { to: "/business-signs", label: "Custom Business Signs", blurb: "Storefront, restaurant, brewery, and office signage." },
  { to: "/custom-ranch-signs", label: "Custom Ranch Signs", blurb: "Property-scale entry and brand pieces." },
  { to: "/cnc-manufacturing", label: "CNC Manufacturing (Small Batch)", blurb: "Run-of-one and small-batch precision CNC." },
];

export default function HowCustomOrdersWorkPage() {
  useStructuredData({
    title: "How Custom Orders Work · Crafters Market",
    description:
      "The 5-step custom-order flow on Crafters Market — submit a brief, get matched to a vetted American maker, approve the design proof, pay Stripe-secured, and receive your made-to-order piece. Typical timelines, costs, and FAQs.",
    url: `${SITE_URL}/how-custom-orders-work`,
    image: `${SITE_URL}/downloads/cnc-garage-builders.png`,
    imageAlt: "How custom orders work on Crafters Market",
    ogType: "article",
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebPage",
          "@id": `${SITE_URL}/how-custom-orders-work#page`,
          name: "How Custom Orders Work · Crafters Market",
          url: `${SITE_URL}/how-custom-orders-work`,
          description: "The 5-step custom-order flow on Crafters Market.",
          isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website` },
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
            { "@type": "ListItem", position: 2, name: "How Custom Orders Work", item: `${SITE_URL}/how-custom-orders-work` },
          ],
        },
        {
          "@type": "HowTo",
          name: "How to commission a custom piece on Crafters Market",
          description: "Five-step flow from brief to delivery for custom and made-to-order pieces.",
          totalTime: "P21D",
          step: STEPS.map((s, i) => ({
            "@type": "HowToStep",
            position: i + 1,
            name: s.title,
            text: s.body,
          })),
        },
        {
          "@type": "FAQPage",
          "@id": `${SITE_URL}/how-custom-orders-work#faq`,
          mainEntity: FAQS.map(({ q, a }) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        },
      ],
    },
  });

  return (
    <div className="pb-24 grain min-h-screen" data-testid="how-custom-orders-work">
      <div className="w-full max-w-[1400px] mx-auto px-4 md:px-8 pt-16 md:pt-24">
        <Breadcrumbs
          items={[
            { name: "Home", to: "/" },
            { name: "How Custom Orders Work" },
          ]}
          testId="hcow-breadcrumbs"
        />
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
          ◆ Made-to-Order · Step by Step
        </div>
        <h1
          className="font-display text-[44px] sm:text-[64px] md:text-[88px] lg:text-[112px] leading-[0.92] mb-8"
          data-testid="hcow-h1"
        >
          How Custom Orders Work.
        </h1>

        <p className="font-mono text-base text-ink max-w-3xl leading-relaxed mb-6">
          A custom order on Crafters Market is a real conversation with a real American
          maker, not a stamped-and-shipped factory transaction. Here&apos;s exactly what
          happens from the moment you submit a brief to the moment your piece lands on
          your wall, in your kitchen, or over your ranch gate.
        </p>
        <p className="font-mono text-sm text-ink-muted max-w-3xl leading-relaxed mb-12">
          Every step is checkpointed: you approve the design, you approve the materials,
          you approve the timeline. Stripe holds your payment in escrow until the piece
          actually ships. The maker doesn&apos;t get paid until you get your piece.
          That&apos;s the deal.
        </p>

        <div className="flex flex-wrap gap-3 mb-20">
          <Link to="/custom-order" className="btn-industrial btn-primary" data-testid="hcow-cta-primary">
            Start a custom order →
          </Link>
          <Link to="/shop" className="btn-industrial btn-secondary">
            Browse the catalog →
          </Link>
          <Link to="/makers" className="btn-industrial btn-secondary">
            Meet the makers →
          </Link>
        </div>

        {/* 5-step process */}
        <div className="border-t border-line pt-12 mb-20">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ The process
          </div>
          <h2 className="font-display text-3xl md:text-5xl uppercase mb-10">
            Five steps. Zero surprises.
          </h2>
          <div className="space-y-12">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="grid grid-cols-[80px_1fr] md:grid-cols-[120px_1fr] gap-6 md:gap-10"
                data-testid={`hcow-step-${s.n}`}
              >
                <div className="font-display text-5xl md:text-7xl text-brand leading-none">
                  {s.n}
                </div>
                <div>
                  <h3 className="font-display text-2xl md:text-4xl uppercase mb-3">
                    {s.title}
                  </h3>
                  <p className="font-mono text-sm md:text-base text-ink-muted leading-relaxed max-w-2xl">
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cost section */}
        <div className="border-t border-line pt-12 mb-20" data-testid="hcow-cost-section">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ What it costs
          </div>
          <h2 className="font-display text-3xl md:text-5xl uppercase mb-8 leading-tight">
            What you pay reflects the material, the time, and the maker.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl">
            <div className="border border-line p-6 bg-paper">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-2">
                Small pieces · $35–$200
              </div>
              <p className="font-mono text-sm text-ink-muted leading-relaxed">
                Engraved cutting boards, monogrammed plaques, custom address numbers,
                small wall pieces. Most ship in 2-3 weeks.
              </p>
            </div>
            <div className="border border-line p-6 bg-paper">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-2">
                Medium custom · $200–$800
              </div>
              <p className="font-mono text-sm text-ink-muted leading-relaxed">
                Custom metal signs (24-48&quot;), framed engraved pieces, monogrammed
                furniture details, business storefront signage. 3-5 weeks.
              </p>
            </div>
            <div className="border border-line p-6 bg-paper">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-2">
                Large statement · $800–$2,500
              </div>
              <p className="font-mono text-sm text-ink-muted leading-relaxed">
                Ranch entry signs, large-format wall sculptures, custom furniture pieces,
                multi-piece commissioned art. 5-8 weeks.
              </p>
            </div>
            <div className="border border-line p-6 bg-paper">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-2">
                Architectural / installation · $2,500+
              </div>
              <p className="font-mono text-sm text-ink-muted leading-relaxed">
                Multi-section ranch gates, full storefront signage systems, large
                commercial installations. Custom quote, often 8-16 weeks with site
                coordination.
              </p>
            </div>
          </div>
          <p className="font-mono text-xs text-ink-muted mt-6 max-w-2xl">
            Every quote breaks the cost down line-by-line — materials, machine time,
            finish, hardware, shipping. No hidden marketplace fees, no surprise add-ons.
            What you see in the quote is what you pay.
          </p>
        </div>

        {/* FAQ */}
        <div className="border-t border-line pt-12 mb-20" data-testid="hcow-faq">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ FAQ
          </div>
          <h2 className="font-display text-3xl md:text-5xl uppercase mb-8">
            Frequently asked questions
          </h2>
          <div className="max-w-3xl space-y-4">
            {FAQS.map(({ q, a }, idx) => (
              <details
                key={idx}
                className="border border-line bg-paper open:border-brand transition"
                data-testid={`hcow-faq-item-${idx}`}
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

        {/* Cross-links */}
        <div className="border-t border-line pt-12" data-testid="hcow-related">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ Popular categories
          </div>
          <h2 className="font-display text-3xl md:text-5xl uppercase mb-8">
            Start with what you&apos;re shopping for
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {RELATED.map(({ to, label, blurb }, idx) => (
              <Link
                key={idx}
                to={to}
                className="group border border-line hover:border-brand p-5 transition block"
                data-testid={`hcow-related-${idx}`}
              >
                <div className="font-display text-xl mb-2 group-hover:text-brand transition">
                  {label} →
                </div>
                <p className="font-mono text-[11px] text-ink-muted leading-relaxed">
                  {blurb}
                </p>
              </Link>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="border-t border-line mt-20 pt-12 text-center">
          <h2 className="font-display text-3xl md:text-5xl uppercase mb-4">
            Ready to commission?
          </h2>
          <p className="font-mono text-sm text-ink-muted max-w-xl mx-auto mb-8 leading-relaxed">
            Submit your brief — it takes 3-5 minutes. Most makers reply within 24 hours
            with a quote and a design proof. Nothing is binding until you approve.
          </p>
          <Link to="/custom-order" className="btn-industrial btn-primary" data-testid="hcow-cta-bottom">
            Start your custom order →
          </Link>
        </div>
      </div>
    </div>
  );
}
