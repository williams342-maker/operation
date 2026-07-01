import React from "react";
import { Link } from "react-router-dom";
import { FileText, Truck, RotateCcw, ShieldCheck, Lock, Ban, Users, Copyright, Cookie, Handshake, Sparkles, Receipt } from "lucide-react";
import {
  CORE_POLICIES,
  OPERATIONAL_POLICIES,
  TRUST_DOCUMENTS,
} from "../data/policies/manifest";
import { GLOSSARY } from "../data/policies/glossary";
import { POLICY_HIERARCHY } from "../data/policies/hierarchy";
import { PolicyHierarchyBlock } from "../components/policy/PolicyDocument";
import { useStructuredData } from "../lib/seo";

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
  "fee-pricing": Receipt,
  "marketplace-promise": Sparkles,
  "privacy-at-a-glance": Lock,
};

function PolicyRow({ p }) {
  const Icon = ICON_BY_SLUG[p.slug] || FileText;
  return (
    <Link
      to={`/policies/${p.slug}`}
      className="block border border-line hover:border-brand/60 transition-colors p-5 md:p-6 group"
      data-testid={`policy-row-${p.slug}`}
    >
      <div className="flex items-start gap-4">
        <span className="w-10 h-10 flex items-center justify-center bg-surface text-brand border border-line flex-shrink-0 group-hover:bg-brand group-hover:text-[#0a0a0a] transition-colors">
          <Icon size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
            <h3 className="font-display text-lg md:text-xl tracking-[-0.005em] text-ink group-hover:text-brand transition-colors">
              {p.title}
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              v{p.version} · {p.last_updated}
            </span>
          </div>
          <p className="font-mono text-sm text-ink-muted leading-relaxed">
            {p.description}
          </p>
        </div>
        <span
          className="font-mono text-xs text-ink-muted group-hover:text-brand transition-colors flex-shrink-0 mt-2"
          aria-hidden="true"
        >
          →
        </span>
      </div>
    </Link>
  );
}

function Section({ title, subtitle, policies, testId }) {
  return (
    <section className="mb-12" data-testid={testId}>
      <div className="flex items-center gap-3 mb-4">
        <span className="h-px w-6 bg-brand" />
        <h2 className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
          {title}
        </h2>
      </div>
      {subtitle && (
        <p className="font-mono text-sm text-ink-muted mb-5 max-w-2xl">
          {subtitle}
        </p>
      )}
      <div className="space-y-3">
        {policies.map((p) => (
          <PolicyRow key={p.slug} p={p} />
        ))}
      </div>
    </section>
  );
}

export default function PoliciesIndexPage() {
  useStructuredData({
    title: "Legal Policy Library · Crafters Market",
    description:
      "The full Crafters Market policy suite: Terms of Service, Privacy, Cookies, Maker Agreement, Buyer Protection, Returns, Shipping, Prohibited Items, Community Guidelines, IP & DMCA.",
    url: "https://craftersmarket.org/policies",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Crafters Market Legal Policy Library",
      url: "https://craftersmarket.org/policies",
    },
  });

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="policies-index-page">
      <div className="w-full max-w-[1100px] mx-auto px-4 md:px-8">
        {/* Header */}
        <header className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <span className="h-px w-8 bg-brand" />
            <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
              Legal Library · Authoritative Text
            </span>
          </div>
          <h1
            className="font-heading uppercase text-5xl sm:text-7xl lg:text-8xl leading-[0.92] tracking-tight text-ink mb-6"
            data-testid="policies-h1"
          >
            All <span className="text-brand">policies</span><span className="text-ink">.</span>
          </h1>
          <p className="font-body text-base sm:text-lg text-ink-muted max-w-2xl leading-relaxed">
            The complete Crafters Market policy suite. Each document has a
            version, effective date, revision history, and cross-references.
            For a friendlier walkthrough, start at the{" "}
            <Link to="/trust" className="text-brand hover:underline">
              Trust Center
            </Link>
            .
          </p>
          <div className="inline-flex items-center gap-2 mt-5 px-3 py-1.5 border border-amber-700/40 bg-amber-500/5">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand">
              ◆ Founding Access v1
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              · Pending legal review
            </span>
          </div>
        </header>

        <Section
          title="Core Marketplace Policies"
          subtitle="The foundational agreements that govern every transaction on Crafters Market."
          policies={CORE_POLICIES}
          testId="section-core"
        />

        <Section
          title="Operational Policies"
          subtitle="Topic-specific policies covering IP enforcement, fees, and appeals."
          policies={OPERATIONAL_POLICIES}
          testId="section-operational"
        />

        <Section
          title="Trust Center Documents"
          subtitle="Plain-English values and summary documents. The full policies above control if there's a conflict."
          policies={TRUST_DOCUMENTS}
          testId="section-trust"
        />

        <PolicyHierarchyBlock hierarchy={POLICY_HIERARCHY} />

        {/* Glossary */}
        <section
          className="border border-line p-5 md:p-6 mt-8"
          data-testid="section-glossary"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-3">
            ◆ Shared Terminology Glossary
          </div>
          <p className="font-mono text-sm text-ink-muted mb-4">
            Every Crafters Market policy uses these terms consistently.
          </p>
          <ul className="space-y-3 font-mono text-sm">
            {GLOSSARY.map((g) => (
              <li key={g.term} className="flex gap-3">
                <span className="text-brand mt-1">▪</span>
                <span>
                  <b className="text-ink">{g.term}</b>{" "}
                  <span className="text-ink-muted">— {g.definition}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
