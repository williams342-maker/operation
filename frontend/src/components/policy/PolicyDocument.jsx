import React from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";

// ============================================================
//  Callout — shared with PolicyPage.jsx. Kept here so
//  <PolicyDocument> can render standalone without the legacy
//  page shell.
// ============================================================
function Callout({ data }) {
  if (!data) return null;
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
          className="flex-shrink-0 mt-0.5 text-brand"
        />
      )}
      <div className="font-mono text-xs leading-relaxed text-ink">
        {data.text}
      </div>
    </div>
  );
}

// ============================================================
//  Renders a single policy body (blocks, intro, callout, outro)
//  from the SECTIONS shape used across the Trust & Policy Center.
// ============================================================
export function PolicyBody({ section }) {
  if (!section) return null;
  return (
    <div className="space-y-5">
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
  );
}

// ============================================================
//  Auto-generated Table of Contents from a section's blocks[]
// ============================================================
export function PolicyTOC({ section, policy }) {
  if (!section?.blocks?.length) return null;
  const headings = section.blocks
    .map((b, i) => ({ heading: b.heading, i }))
    .filter((b) => !!b.heading);
  if (!headings.length) return null;

  return (
    <nav
      className="border border-line bg-paper p-5 mb-6"
      aria-label={`Table of contents for ${policy?.title || section.title}`}
      data-testid="policy-toc"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-3">
        ◆ Table of Contents
      </div>
      <ol className="space-y-1.5 font-mono text-sm text-ink">
        {headings.map(({ heading, i }) => {
          const anchor = `toc-${i}`;
          return (
            <li key={i} className="flex gap-3">
              <span className="text-ink-muted w-6 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <a
                href={`#${anchor}`}
                className="text-ink hover:text-brand transition-colors"
              >
                {heading}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ============================================================
//  Metadata header (version, effective, last updated + Founding v1)
// ============================================================
export function PolicyMetaHeader({ policy }) {
  if (!policy) return null;
  return (
    <div
      className="border border-line bg-paper p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-3 md:gap-6 mb-6"
      data-testid="policy-meta-header"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand">
        ◆ {policy.category === "core" ? "Core Policy" : policy.category === "operational" ? "Operational" : "Trust Center"}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs text-ink-muted">
        <span>
          <span className="text-ink-muted">Version:</span>{" "}
          <b className="text-ink">{policy.version}</b>
        </span>
        <span>
          <span className="text-ink-muted">Effective:</span>{" "}
          <b className="text-ink">{policy.effective_date}</b>
        </span>
        <span>
          <span className="text-ink-muted">Last updated:</span>{" "}
          <b className="text-ink">{policy.last_updated}</b>
        </span>
      </div>
    </div>
  );
}

// ============================================================
//  Related Policies block
// ============================================================
export function RelatedPolicies({ policy, allPolicies, LinkComponent = "a" }) {
  if (!policy?.related?.length) return null;
  const items = policy.related
    .map((slug) => allPolicies.find((p) => p.slug === slug))
    .filter(Boolean);
  if (!items.length) return null;

  return (
    <section className="border border-line p-5 md:p-6 mt-8" data-testid="related-policies">
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-3">
        ◆ Related Policies
      </div>
      <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2 font-mono text-sm">
        {items.map((r) => {
          const href = `/policies/${r.slug}`;
          const linkProps = LinkComponent === "a" ? { href } : { to: href };
          return (
            <li key={r.slug}>
              <LinkComponent
                {...linkProps}
                className="text-ink hover:text-brand transition-colors"
                data-testid={`related-${r.slug}`}
              >
                → {r.title}
              </LinkComponent>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ============================================================
//  Policy Hierarchy block (reusable, same on every doc)
// ============================================================
export function PolicyHierarchyBlock({ hierarchy }) {
  return (
    <section className="border border-line p-5 md:p-6 mt-6 bg-paper" data-testid="policy-hierarchy">
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-3">
        ◆ Policy Hierarchy · Order of Precedence
      </div>
      <ol className="space-y-2 font-mono text-sm text-ink">
        {hierarchy.map((h) => (
          <li key={h.level} className="flex gap-3">
            <span className="text-brand tabular-nums w-6">{h.level}.</span>
            <span>
              <b className="text-ink">{h.label}</b>{" "}
              <span className="text-ink-muted">— {h.note}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ============================================================
//  Revision History table
// ============================================================
export function RevisionHistory({ policy }) {
  if (!policy?.revision_history?.length) return null;
  return (
    <section className="border border-line p-5 md:p-6 mt-6" data-testid="revision-history">
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-3">
        ◆ Revision History
      </div>
      <ul className="space-y-3 font-mono text-sm">
        {policy.revision_history.map((r, i) => (
          <li key={i} className="flex gap-3">
            <span className="text-brand tabular-nums">v{r.version}</span>
            <span className="text-ink-muted">·</span>
            <span className="text-ink-muted tabular-nums">{r.date}</span>
            <span className="text-ink-muted">·</span>
            <span className="text-ink">{r.summary}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ============================================================
//  Attorney Review appendices (internal — remove before publication)
// ============================================================
export function AttorneyReviewAppendices({ policy }) {
  if (!policy) return null;
  const has =
    (policy.attorney_notes?.length || 0) +
      (policy.implementation_notes?.length || 0) +
      (policy.cross_ref_checklist?.length || 0) >
    0;
  if (!has) return null;

  return (
    <section
      className="border border-amber-700/40 bg-amber-500/5 p-5 md:p-6 mt-8"
      data-testid="attorney-review-appendices"
    >
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle size={14} className="text-brand" />
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand">
          Internal · Remove Before Publication
        </span>
      </div>

      {policy.attorney_notes?.length > 0 && (
        <div className="mb-6">
          <h4 className="font-display text-base uppercase tracking-[0.02em] text-ink mb-2">
            Appendix A — Attorney Review Notes
          </h4>
          <ul className="space-y-2 font-mono text-xs text-ink">
            {policy.attorney_notes.map((n, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-brand mt-1">▪</span>
                <span>
                  <b className="text-ink">{n.section}</b>{" "}
                  <span className="text-ink-muted">— {n.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {policy.implementation_notes?.length > 0 && (
        <div className="mb-6">
          <h4 className="font-display text-base uppercase tracking-[0.02em] text-ink mb-2">
            Appendix B — Implementation Notes
          </h4>
          <ul className="space-y-2 font-mono text-xs text-ink">
            {policy.implementation_notes.map((n, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-brand mt-1">▪</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {policy.cross_ref_checklist?.length > 0 && (
        <div>
          <h4 className="font-display text-base uppercase tracking-[0.02em] text-ink mb-2">
            Appendix C — Cross-Reference Checklist
          </h4>
          <ul className="space-y-1 font-mono text-xs text-ink">
            {policy.cross_ref_checklist.map((c, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-brand mt-1">✓</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
