import React, { useEffect, useState } from "react";
import { ChevronDown, AlertTriangle, Mail } from "lucide-react";
import { useStructuredData } from "../lib/seo";
import { SECTIONS, SUPPORT_EMAIL } from "../data/policies/sections";

// ============================================================
//  Tone-aware callout box (yellow/amber for warn, neutral for info)
// ============================================================
function Callout({ data }) {
  const Icon = data.icon || (data.tone === "warn" ? AlertTriangle : null);
  const cls =
    data.tone === "warn"
      ? "border-amber-700/40 bg-amber-500/5"
      : "border-line bg-paper";
  return (
    <div className={`border ${cls} p-4 my-5 flex gap-3 items-start`}>
      {Icon && (
        <Icon
          size={16}
          className={`flex-shrink-0 mt-0.5 ${data.tone === "warn" ? "text-brand" : "text-brand"}`}
        />
      )}
      <div className="font-mono text-xs leading-relaxed text-ink">
        {data.text}
      </div>
    </div>
  );
}

// ============================================================
//  Accordion section
// ============================================================
function PolicySection({ section, isOpen, onToggle }) {
  const Icon = section.icon;
  return (
    <div
      // iter318a — anchor target so footer links like `/policy#shipping`
      // scroll the user to the right section. Browsers default to
      // top-of-element on hash-jump, so we keep the wrapper id-bound
      // (the page-level useEffect also force-opens this section).
      id={section.id}
      className={`border ${isOpen ? "border-brand/40" : "border-line"} transition-colors scroll-mt-32`}
      data-testid={`policy-section-${section.id}`}
    >
      {/* iter318a — alias anchors: footer links to /policy#buyer-protection
          and /policy#maker-agreement both land on this same section,
          because they're the two blocks inside the Makers Market policy.
          Empty <span id> tags are inert layout-wise. */}
      {section.aliasIds?.map((aid) => (
        <span key={aid} id={aid} className="block scroll-mt-32" aria-hidden="true" />
      ))}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-4 p-5 md:p-6 text-left hover:bg-paper transition"
        data-testid={`policy-toggle-${section.id}`}
      >
        <span
          className={`w-10 h-10 flex items-center justify-center flex-shrink-0 border ${
            isOpen
              ? "bg-brand text-[#0a0a0a] border-brand"
              : "bg-surface text-brand border-line"
          }`}
        >
          <Icon size={18} />
        </span>
        <span className="flex-1 font-display text-xl md:text-2xl tracking-[-0.005em]">
          {section.title}
        </span>
        <ChevronDown
          size={20}
          className={`flex-shrink-0 text-ink-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="px-5 md:px-6 pb-6 md:pb-8 pt-0 space-y-5">
          {section.intro && (
            <p className="font-mono text-sm text-ink leading-relaxed">
              {section.intro}
            </p>
          )}

          {(section.blocks || []).map((block, i) => (
            <div key={i} className="space-y-3">
              {block.heading && (
                <h4 className="font-display text-base uppercase tracking-[0.02em] text-ink">
                  {block.heading}
                </h4>
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

          {section.callout && <Callout data={section.callout} />}

          {section.outro && (
            <p className="font-mono text-sm text-ink leading-relaxed">
              {section.outro}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  Page shell
// ============================================================
export default function PolicyPage() {
  // Open the first 3 sections by default — the rest are collapsed
  // so the page reads as a structured index rather than a wall of text.
  const [open, setOpen] = useState({ terms: true, shipping: true, returns: true });
  const toggle = (id) => setOpen((s) => ({ ...s, [id]: !s[id] }));

  // iter318a — hash deep-link support. When the user lands on
  // `/policy#shipping` (or any alias like `#buyer-protection`), find
  // the canonical section that owns that id (or claims it via aliasIds)
  // and (a) force it open, (b) scroll it into view. Runs once on mount
  // and again on any in-app hash change.
  useEffect(() => {
    const applyHash = () => {
      const hash = (window.location.hash || "").replace(/^#/, "");
      if (!hash) return;
      const ownerId = (SECTIONS.find(
        (s) => s.id === hash || (s.aliasIds || []).includes(hash),
      ) || {}).id;
      if (!ownerId) return;
      setOpen((s) => ({ ...s, [ownerId]: true }));
      // Defer scroll until after the section opens (next paint).
      setTimeout(() => {
        const el = document.getElementById(hash) || document.getElementById(ownerId);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  useStructuredData({
    title: "Terms of Service & Site Policies · Crafters Market",
    description: "Crafters Market Terms of Service, shipping, returns, custom orders, payments, Makers Market commission, privacy, prohibited items, IP, and seller/buyer conduct.",
    url: "https://craftersmarket.org/policy",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Crafters Market Site Policies",
      url: "https://craftersmarket.org/policy",
      isPartOf: { "@type": "WebSite", "@id": "https://craftersmarket.org/#website" },
    },
  });

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="policy-page">
      <div className="w-full max-w-[1100px] mx-auto px-4 md:px-8">
        <header className="mb-12 md:mb-16">
          <div className="flex items-center gap-3 mb-4">
            <span className="h-px w-8 bg-brand" />
            <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">Policies &middot; The Fine Print</span>
          </div>
          <h1
            className="font-heading uppercase text-5xl sm:text-7xl lg:text-8xl leading-[0.92] tracking-tight text-ink mb-6"
            data-testid="policy-h1"
          >
            Site <span className="text-brand">policies</span><span className="text-ink">.</span>
          </h1>
          <p className="font-body text-base sm:text-lg text-ink-muted max-w-2xl leading-relaxed">
            The full operating manual for buying and selling on Crafters
            Market. Each section opens to its full text &mdash; please read the ones
            relevant to your transaction. By using this site you agree to all
            policies below. Last updated <span className="text-ink font-semibold">April 2026</span>.
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

        <div className="space-y-3" data-testid="policy-sections">
          {SECTIONS.map((s) => (
            <PolicySection
              key={s.id}
              section={s}
              isOpen={!!open[s.id]}
              onToggle={() => toggle(s.id)}
            />
          ))}
        </div>

        {/* Contact footer */}
        <div className="border border-line mt-12 p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-5 md:gap-8">
          <span className="w-12 h-12 flex items-center justify-center bg-surface text-brand border border-line flex-shrink-0">
            <Mail size={20} />
          </span>
          <div className="flex-1">
            <div className="font-display text-2xl tracking-[-0.005em]">
              Question we didn't answer?
            </div>
            <p className="font-mono text-xs text-ink-muted mt-1 leading-relaxed">
              Email us at{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand hover:underline">
                {SUPPORT_EMAIL}
              </a>{" "}
              and we'll respond within 1 business day. For urgent
              transaction issues, include your order ID.
            </p>
          </div>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="btn-industrial btn-primary"
            data-testid="policy-contact-cta"
          >
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}
