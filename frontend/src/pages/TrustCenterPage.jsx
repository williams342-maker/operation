import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, ShieldCheck, Handshake, ScrollText, Cookie, FileText, Truck, RotateCcw, Ban, Users, Copyright, Sparkles, Lock } from "lucide-react";
import {
  POLICIES,
  CORE_POLICIES,
  OPERATIONAL_POLICIES,
  TRUST_DOCUMENTS,
} from "../data/policies/manifest";
import { SECTIONS } from "./PolicyPage";
import { useStructuredData } from "../lib/seo";

// ============================================================
//  Trust Center — /trust
//  Public, friendly hub. Answers "am I protected?" in plain
//  English and jumps into the authoritative legal library
//  at /policies for the full text.
//
//  Includes a cross-policy search box that indexes titles,
//  headings, and search_keywords across the manifest, then
//  jumps directly to the matching /policies/:slug#anchor.
// ============================================================

const ICON_BY_SLUG = {
  terms: FileText,
  privacy: Lock,
  cookies: Cookie,
  "maker-agreement": Handshake,
  "buyer-protection": ShieldCheck,
  returns: RotateCcw,
  shipping: Truck,
  "prohibited-items": Ban,
  "community-guidelines": Users,
  "ip-dmca": Copyright,
  "marketplace-promise": Sparkles,
  "privacy-at-a-glance": Lock,
};

// Build a flat search index from the manifest + section headings
function buildSearchIndex() {
  const idx = [];
  POLICIES.forEach((p) => {
    const section = SECTIONS.find((s) => s.id === p.section_id);
    // Top-level policy entry
    idx.push({
      slug: p.slug,
      title: p.title,
      subtitle: p.description,
      href: `/policies/${p.slug}`,
      haystack: [
        p.title,
        p.short_title,
        p.description,
        ...(p.keywords || []),
      ]
        .join(" ")
        .toLowerCase(),
      kind: "policy",
    });
    // Each block heading becomes a jump-target
    section?.blocks?.forEach((b, i) => {
      if (!b.heading) return;
      idx.push({
        slug: p.slug,
        title: b.heading,
        subtitle: p.title,
        href: `/policies/${p.slug}#toc-${i}`,
        haystack: [b.heading, p.title].join(" ").toLowerCase(),
        kind: "section",
      });
    });
  });
  return idx;
}

function PolicySearch({ policies }) {
  const [q, setQ] = useState("");
  const index = useMemo(() => buildSearchIndex(), []);
  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const scored = index
      .map((r) => {
        const hit = r.haystack.includes(query);
        return hit ? r : null;
      })
      .filter(Boolean)
      .slice(0, 20);
    // Group by policy slug
    const groups = {};
    scored.forEach((r) => {
      if (!groups[r.slug]) groups[r.slug] = { slug: r.slug, items: [] };
      groups[r.slug].items.push(r);
    });
    return Object.values(groups);
  }, [q, index]);

  return (
    <div className="w-full max-w-2xl mx-auto" data-testid="trust-search">
      <div className="relative border border-line bg-paper">
        <Search
          size={18}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-brand pointer-events-none"
        />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about our policies — returns, buyer protection, digital downloads, AI, copyright…"
          className="w-full pl-12 pr-4 py-4 bg-transparent font-mono text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-brand"
          data-testid="trust-search-input"
          aria-label="Search Trust Center"
        />
      </div>

      {!q && (
        <div className="mt-3 font-mono text-[11px] text-ink-muted">
          Try: <span className="text-ink">returns</span> · <span className="text-ink">buyer protection</span> · <span className="text-ink">digital downloads</span> · <span className="text-ink">AI</span> · <span className="text-ink">copyright</span> · <span className="text-ink">shipping</span> · <span className="text-ink">verified makers</span>
        </div>
      )}

      {q && results.length === 0 && (
        <div
          className="mt-4 border border-line p-4 font-mono text-sm text-ink-muted"
          data-testid="trust-search-empty"
        >
          No matches for &ldquo;{q}&rdquo;. Try a broader term, or browse the{" "}
          <Link to="/policies" className="text-brand hover:underline">
            full policy library
          </Link>
          .
        </div>
      )}

      {q && results.length > 0 && (
        <div className="mt-4 border border-line divide-y divide-line" data-testid="trust-search-results">
          {results.map((g) => {
            const policy = policies.find((p) => p.slug === g.slug);
            const Icon = ICON_BY_SLUG[g.slug] || FileText;
            return (
              <div key={g.slug} className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={14} className="text-brand" />
                  <Link
                    to={`/policies/${g.slug}`}
                    className="font-display text-base text-ink hover:text-brand transition-colors"
                    data-testid={`trust-search-policy-${g.slug}`}
                  >
                    {policy?.title || g.slug}
                  </Link>
                </div>
                <ul className="space-y-1 font-mono text-xs pl-6">
                  {g.items.slice(0, 5).map((r, i) => (
                    <li key={i}>
                      <Link
                        to={r.href}
                        className="text-ink-muted hover:text-brand transition-colors"
                      >
                        → {r.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PillarCard({ icon: Icon, title, blurb, link, linkLabel, testId }) {
  return (
    <div className="border border-line p-6 md:p-7 bg-paper h-full flex flex-col" data-testid={testId}>
      <div className="w-10 h-10 flex items-center justify-center bg-surface text-brand border border-line mb-4">
        <Icon size={18} />
      </div>
      <h3 className="font-display text-xl tracking-[-0.005em] mb-2 text-ink">{title}</h3>
      <p className="font-mono text-sm text-ink-muted leading-relaxed flex-1">{blurb}</p>
      {link && (
        <Link
          to={link}
          className="mt-4 inline-flex items-center gap-1 font-mono text-xs uppercase tracking-[0.18em] text-brand hover:text-ink transition-colors"
        >
          {linkLabel || "Read more"} <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  );
}

export default function TrustCenterPage() {
  useStructuredData({
    title: "Trust Center · Crafters Market",
    description:
      "How Crafters Market protects Buyers, supports Makers, and maintains marketplace integrity. Buyer Protection, Verified Makers, Secure Payments, and the full policy library.",
    url: "https://craftersmarket.org/trust",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Crafters Market Trust Center",
      url: "https://craftersmarket.org/trust",
      isPartOf: { "@type": "WebSite", "@id": "https://craftersmarket.org/#website" },
    },
  });

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="trust-center-page">
      <div className="w-full max-w-[1200px] mx-auto px-4 md:px-8">
        {/* Header */}
        <header className="mb-12 md:mb-16">
          <div className="flex items-center gap-3 mb-4">
            <span className="h-px w-8 bg-brand" />
            <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
              Trust Center · The Marketplace Promise
            </span>
          </div>
          <h1
            className="font-heading uppercase text-5xl sm:text-7xl lg:text-8xl leading-[0.92] tracking-tight text-ink mb-6"
            data-testid="trust-h1"
          >
            Buy with <span className="text-brand">confidence</span>.<br />
            Sell with <span className="text-brand">confidence</span>.
          </h1>
          <p className="font-body text-base sm:text-lg text-ink-muted max-w-2xl leading-relaxed">
            Crafters Market is a curated home for independent Makers and the
            people who love their work. This page is the human-friendly answer
            to &ldquo;How does this marketplace protect me?&rdquo; The{" "}
            <Link to="/policies" className="text-brand hover:underline">
              full legal library
            </Link>{" "}
            lives at /policies.
          </p>
        </header>

        {/* Search */}
        <section className="mb-16" data-testid="trust-search-section">
          <PolicySearch policies={POLICIES} />
        </section>

        {/* Buy with Confidence */}
        <section className="mb-16" data-testid="trust-buy-section">
          <div className="flex items-center gap-3 mb-6">
            <span className="h-px w-6 bg-brand" />
            <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
              For Buyers
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4 md:gap-6">
            <PillarCard
              icon={ShieldCheck}
              title="Buyer Protection"
              blurb="If your Order doesn't arrive, arrives significantly not as described, or the Maker becomes unresponsive, we step in. Marketplace-funded refunds where appropriate."
              link="/policies/buyer-protection"
              linkLabel="Read Buyer Protection"
              testId="pillar-buyer-protection"
            />
            <PillarCard
              icon={Users}
              title="Verified Makers"
              blurb="Every Maker completes identity verification and Stripe onboarding before payouts. You're buying from real independent Makers, not resellers."
              link="/policies/maker-agreement"
              linkLabel="How Makers are verified"
              testId="pillar-verified-makers"
            />
            <PillarCard
              icon={Lock}
              title="Secure Payments"
              blurb="Every checkout runs through Stripe. Card details never touch our servers. Standard card-network protections apply."
              link="/policies/privacy"
              linkLabel="How your data is handled"
              testId="pillar-secure-payments"
            />
            <PillarCard
              icon={ScrollText}
              title="Transparent Shop Policies"
              blurb="Every Maker publishes their own returns, processing time, and shipping policies on their Shop page — no surprises after checkout."
              link="/policies/returns"
              linkLabel="Returns & Refunds"
              testId="pillar-shop-policies"
            />
            <PillarCard
              icon={RotateCcw}
              title="Fair Returns"
              blurb="Marketplace-level floors for damaged items and 'not as described' cases. Digital-download and custom-order exceptions are stated up front."
              link="/policies/returns"
              linkLabel="Returns Policy"
              testId="pillar-fair-returns"
            />
            <PillarCard
              icon={Truck}
              title="Ships From the Maker"
              blurb="Makers ship their own Orders. Processing times, carriers, and international customs are disclosed on every Listing."
              link="/policies/shipping"
              linkLabel="Shipping Policy"
              testId="pillar-shipping"
            />
          </div>
        </section>

        {/* Sell with Confidence */}
        <section className="mb-16" data-testid="trust-sell-section">
          <div className="flex items-center gap-3 mb-6">
            <span className="h-px w-6 bg-brand" />
            <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
              For Makers
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4 md:gap-6">
            <PillarCard
              icon={Handshake}
              title="A Fair Marketplace"
              blurb="Clear rules, transparent fees, and a curated audience of Buyers who value handmade work. No hidden deductions, no surprise policy changes without notice."
              link="/policies/maker-agreement"
              testId="pillar-fair-marketplace"
            />
            <PillarCard
              icon={Copyright}
              title="Your IP Stays Yours"
              blurb="You retain ownership of your photos, descriptions, and designs. You grant us the license we need to promote your work across Google, Meta, Pinterest, and TikTok — nothing more."
              link="/policies/maker-agreement"
              testId="pillar-ip"
            />
            <PillarCard
              icon={Sparkles}
              title="Founding Seller Program"
              blurb="Version 1 participants get early-adopter benefits, direct-line support, and a seat at the table as the marketplace grows."
              link="/policies/marketplace-promise"
              testId="pillar-founding"
            />
          </div>

          {/* iter413ee — AI Promise badge. Creator-Owned AI Policy is a
              trust signal that differentiates Crafters Market from larger
              platforms. Rendered as its own row for visibility. */}
          <div className="grid md:grid-cols-1 gap-4 md:gap-6 mt-4 md:mt-6">
            <div
              className="border border-brand/50 bg-brand/5 p-6 md:p-8"
              data-testid="pillar-ai-promise"
            >
              <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                <div className="flex-shrink-0">
                  <div className="w-14 h-14 flex items-center justify-center bg-brand text-[#0a0a0a] border border-brand">
                    <Sparkles size={22} />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2">
                    ◆ AI Promise · Creator-Owned AI Policy
                  </div>
                  <h3 className="font-display text-2xl md:text-3xl tracking-[-0.005em] text-ink mb-3">
                    Your creativity belongs to you.
                  </h3>
                  <p className="font-body text-base text-ink-muted leading-relaxed max-w-2xl">
                    Crafters Market uses AI to <b className="text-ink">operate and
                    promote</b> the marketplace &mdash; search, recommendations,
                    ads across Google/Meta/Pinterest/TikTok, SEO, translations,
                    listing optimization. We <b className="text-ink">do not</b>{" "}
                    use your work to train AI models, and we do not license your
                    content to third parties for AI training. If we ever launch
                    an AI training program, it will be opt-in only &mdash; and
                    declining will never reduce your visibility, ranking, or
                    payouts.
                  </p>
                  <Link
                    to="/policies/maker-agreement#toc-9"
                    className="inline-flex items-center gap-1 mt-4 font-mono text-xs uppercase tracking-[0.18em] text-brand hover:text-ink transition-colors"
                    data-testid="pillar-ai-promise-link"
                  >
                    Read the full policy <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Standards */}
        <section className="mb-16" data-testid="trust-standards-section">
          <div className="flex items-center gap-3 mb-6">
            <span className="h-px w-6 bg-brand" />
            <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
              Marketplace Standards
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4 md:gap-6">
            <PillarCard
              icon={Users}
              title="Community Guidelines"
              blurb="Conduct standards for messaging, reviews, and community spaces. Harassment, discrimination, and review manipulation are not tolerated."
              link="/policies/community-guidelines"
              testId="pillar-community"
            />
            <PillarCard
              icon={Ban}
              title="Prohibited Items"
              blurb="What may not be sold on Crafters Market. Original policy — not adapted from another marketplace. Covers counterfeits, drop-shipping, regulated goods, and AI-only listings."
              link="/policies/prohibited-items"
              testId="pillar-prohibited"
            />
          </div>
        </section>

        {/* Legal Library CTA */}
        <section
          className="border border-line p-6 md:p-10 bg-paper mb-16"
          data-testid="trust-library-cta"
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2">
                ◆ Legal Library
              </div>
              <h3 className="font-display text-2xl md:text-3xl tracking-[-0.005em] text-ink mb-2">
                The full policy suite lives at /policies
              </h3>
              <p className="font-mono text-sm text-ink-muted max-w-xl">
                Every policy has a version, effective date, revision history,
                related-policies index, and internal attorney-review notes.
                Structured so it scales as the marketplace grows.
              </p>
            </div>
            <Link
              to="/policies"
              className="btn-industrial btn-primary self-start md:self-auto"
              data-testid="trust-view-policies-cta"
            >
              View All Policies →
            </Link>
          </div>
        </section>

        {/* Contact */}
        <section className="border border-line p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-5 md:gap-8" data-testid="trust-contact">
          <div className="flex-1">
            <div className="font-display text-xl md:text-2xl tracking-[-0.005em] mb-1">
              Still have a question?
            </div>
            <p className="font-mono text-xs text-ink-muted leading-relaxed">
              Email us at{" "}
              <a
                href="mailto:team@craftersmarket.org"
                className="text-brand hover:underline"
              >
                team@craftersmarket.org
              </a>{" "}
              and we&rsquo;ll respond within 1 business day. Include your Order
              ID for anything transaction-related.
            </p>
          </div>
          <a
            href="mailto:team@craftersmarket.org"
            className="btn-industrial btn-primary"
            data-testid="trust-contact-cta"
          >
            Contact Support
          </a>
        </section>
      </div>
    </div>
  );
}
