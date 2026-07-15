import React, { useEffect } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { Mail, ChevronLeft } from "lucide-react";
import {
  findPolicyBySlug,
  POLICIES,
} from "../data/policies/manifest";
import { POLICY_HIERARCHY } from "../data/policies/hierarchy";
import { SECTIONS } from "../data/policies/sections";
import {
  PolicyTOC,
  PolicyMetaHeader,
  RelatedPolicies,
  PolicyHierarchyBlock,
  RevisionHistory,
  AttorneyReviewAppendices,
} from "../components/policy/PolicyDocument";
import { useStructuredData } from "../lib/seo";

const SUPPORT_EMAIL = "team@craftersmarket.org";

// ============================================================
//  /policies/:slug — individual policy document
//
//  Data model:
//   - Metadata (title, version, dates, related, appendices)
//     comes from src/data/policies/manifest.js
//   - Body content (blocks, bullets, callouts) comes from
//     SECTIONS in PolicyPage.jsx, referenced by section_id
//
//  The block-level anchors (#toc-N) match the Table of Contents
//  and the Trust Center search results.
// ============================================================
export default function PolicyDetailPage() {
  const { slug } = useParams();
  const policy = findPolicyBySlug(slug);
  const section = policy
    ? SECTIONS.find((s) => s.id === policy.section_id)
    : null;

  // Scroll to hash target after mount
  useEffect(() => {
    if (!policy) return;
    const hash = (window.location.hash || "").replace(/^#/, "");
    if (!hash) return;
    setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, [slug, policy]);

  useStructuredData({
    title: policy ? `${policy.title} · Crafters Market` : "Policies · Crafters Market",
    description: policy?.description || "Crafters Market policy library.",
    url: policy
      ? `https://craftersmarket.org/policies/${policy.slug}`
      : "https://craftersmarket.org/policies",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: policy ? `${policy.title} — Crafters Market` : "Crafters Market Policies",
      url: policy
        ? `https://craftersmarket.org/policies/${policy.slug}`
        : "https://craftersmarket.org/policies",
      isPartOf: {
        "@type": "WebSite",
        "@id": "https://craftersmarket.org/#website",
      },
    },
  });

  // Unknown slug → redirect to /policies index (soft 404)
  if (!policy) {
    return <Navigate to="/policies" replace />;
  }

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="policy-detail-page">
      <div className="w-full max-w-[900px] mx-auto px-4 md:px-8">
        {/* Breadcrumb / back */}
        <div className="flex items-center gap-2 mb-6 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted">
          <Link
            to="/policies"
            className="inline-flex items-center gap-1 text-ink-muted hover:text-brand transition-colors"
            data-testid="policy-back-link"
          >
            <ChevronLeft size={14} />
            All Policies
          </Link>
          <span>·</span>
          <Link
            to="/trust"
            className="hover:text-brand transition-colors"
          >
            Trust Center
          </Link>
        </div>

        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="h-px w-8 bg-brand" />
            <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
              {policy.category === "core"
                ? "Core Policy"
                : policy.category === "operational"
                ? "Operational Policy"
                : "Trust Center"}
            </span>
          </div>
          <h1
            className="font-heading uppercase text-4xl sm:text-6xl lg:text-7xl leading-[0.95] tracking-tight text-ink mb-4"
            data-testid="policy-detail-h1"
          >
            {policy.title}<span className="text-brand">.</span>
          </h1>
          <p className="font-body text-base sm:text-lg text-ink-muted max-w-2xl leading-relaxed">
            {policy.description}
          </p>
        </header>

        <PolicyMetaHeader policy={policy} />

        {/* iter413dp — public "not legal advice" notice. Rendered on
            every /policies/:slug page until the policy suite has been
            reviewed by counsel and the appendix arrays in manifest.js
            are cleared. See governance-framework.md for the
            publication workflow. */}
        <div
          className="border border-amber-700/40 bg-amber-500/5 p-4 mb-6 flex gap-3 items-start"
          data-testid="policy-legal-review-notice"
        >
          <span className="text-brand font-mono text-xs mt-0.5">◆</span>
          <div className="font-mono text-xs leading-relaxed text-ink">
            <b>Founding Access v1 · Pending legal review.</b> This document is
            provided for transparency during Crafters Market&rsquo;s Version 1
            marketplace validation phase. It is not legal advice and has not
            been finalized by counsel. If a term is unclear, email{" "}
            <a
              href="mailto:team@craftersmarket.org"
              className="text-brand hover:underline"
            >
              team@craftersmarket.org
            </a>
            .
          </div>
        </div>

        <PolicyTOC section={section} policy={policy} />

        {/* Body with TOC anchor injection */}
        <article className="prose-none" data-testid="policy-detail-body">
          {section?.intro && (
            <div className="font-mono text-sm text-ink leading-relaxed mb-6">
              {section.intro}
            </div>
          )}

          <div className="space-y-8">
            {(section?.blocks || []).map((block, i) => (
              <div
                key={i}
                id={`toc-${i}`}
                className="scroll-mt-32 space-y-3"
                data-testid={`policy-block-${i}`}
              >
                {block.heading && (
                  <h3 className="font-display text-xl md:text-2xl tracking-[-0.005em] text-ink border-b border-line pb-2">
                    <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-brand mr-3 align-middle">
                      §{String(i + 1).padStart(2, "0")}
                    </span>
                    {block.heading}
                  </h3>
                )}
                {block.text && (
                  <p className="font-mono text-sm text-ink leading-relaxed">
                    {block.text}
                  </p>
                )}
                {block.list && (
                  <ul className="space-y-2 font-mono text-sm">
                    {block.list.map(([k, v], j) => (
                      <li key={j} className="flex gap-3 text-ink">
                        <span className="text-brand mt-1">▪</span>
                        <span>
                          <b className="text-ink">{k}</b> {v}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {block.bullets && (
                  <ul className="space-y-2 font-mono text-sm">
                    {block.bullets.map((b, j) => (
                      <li key={j} className="flex gap-3 text-ink">
                        <span className="text-brand mt-1">▪</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {section?.callout && (
            <div className="mt-8 border border-amber-700/40 bg-amber-500/5 p-4 flex gap-3 items-start">
              <span className="text-brand mt-0.5">◆</span>
              <div className="font-mono text-xs leading-relaxed text-ink">
                {section.callout.text}
              </div>
            </div>
          )}

          {section?.outro && (
            <div className="mt-6 font-mono text-sm text-ink leading-relaxed">
              {section.outro}
            </div>
          )}
        </article>

        <PolicyHierarchyBlock hierarchy={POLICY_HIERARCHY} />
        <RevisionHistory policy={policy} />
        <RelatedPolicies
          policy={policy}
          allPolicies={POLICIES}
          LinkComponent={Link}
        />
        <AttorneyReviewAppendices policy={policy} />

        {/* Contact */}
        <div className="border border-line mt-10 p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-5 md:gap-8">
          <span className="w-12 h-12 flex items-center justify-center bg-surface text-brand border border-line flex-shrink-0">
            <Mail size={20} />
          </span>
          <div className="flex-1">
            <div className="font-display text-2xl tracking-[-0.005em]">
              Question about this policy?
            </div>
            <p className="font-mono text-xs text-ink-muted mt-1 leading-relaxed">
              Email us at{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-brand hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>{" "}
              and we&rsquo;ll respond within 1 business day.
            </p>
          </div>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="btn-industrial btn-primary"
            data-testid="policy-detail-contact-cta"
          >
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}
