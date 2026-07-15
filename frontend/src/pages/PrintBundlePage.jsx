import React from "react";
import { useLocation } from "react-router-dom";
import {
  POLICIES,
} from "../data/policies/manifest";
import { POLICY_HIERARCHY } from "../data/policies/hierarchy";
import { GLOSSARY } from "../data/policies/glossary";
import { SECTIONS } from "../data/policies/sections";

// ============================================================
//  /counsel-packet  — INTERNAL counsel packet (full):
//    Cover + all policies + hierarchy + revision history +
//    related policies + Appendix A (attorney notes) +
//    Appendix B (implementation notes) + Appendix C
//    (cross-reference checklist) + Glossary.
//
//  /attorney-packet — EXTERNAL attorney review packet:
//    Same body content, but strips internal engineering
//    surface area:
//      - Appendix B (Implementation Notes) — HIDDEN
//      - Appendix C (Cross-Reference Checklist) — HIDDEN
//      - Cover-sheet "Post-Review Process on Our Side"
//        (mentions manifest.js) — HIDDEN
//      - Appendix A notes that start with "ENGINEERING
//        DEFAULT" — FILTERED
//
//  Both routes render the same PrintBundlePage; the mode is
//  read from the URL. Not linked from the public nav.
// ============================================================

const PACKET_META = {
  bundle_version: "Trust & Policy Center v1",
  prepared_by: "Crafters Market Operations",
  prepared_at: "2026-06-30",
  contact: "team@craftersmarket.org",
};

// A note is "engineering only" if it either says
// ENGINEERING DEFAULT or only reports internal implementation
// status without an outstanding question for counsel.
function isEngineeringOnlyNote(note) {
  const t = (note?.note || "").trim();
  if (!t) return true;
  if (t.startsWith("ENGINEERING DEFAULT")) return true;
  return false;
}

function CoverSheet({ mode }) {
  const attorneyMode = mode === "attorney";
  return (
    <section className="pkt-cover">
      <div className="pkt-eyebrow">
        {attorneyMode
          ? "Attorney Review Packet · Cover Sheet"
          : "Internal Counsel Packet · Cover Sheet"}
      </div>
      <h1 className="pkt-h1">Crafters Market — Trust &amp; Policy Center v1</h1>

      <table className="pkt-meta">
        <tbody>
          <tr>
            <th>Bundle version</th>
            <td>{PACKET_META.bundle_version}</td>
          </tr>
          <tr>
            <th>Prepared by</th>
            <td>{PACKET_META.prepared_by}</td>
          </tr>
          <tr>
            <th>Prepared on</th>
            <td>{PACKET_META.prepared_at}</td>
          </tr>
          <tr>
            <th>Contact</th>
            <td>{PACKET_META.contact}</td>
          </tr>
          <tr>
            <th>Documents included</th>
            <td>{POLICIES.length} policy documents</td>
          </tr>
        </tbody>
      </table>

      <h2 className="pkt-h2">Purpose</h2>
      <p>
        Crafters Market is a curated multi-vendor marketplace connecting
        independent Makers with Buyers. This packet contains{" "}
        <b>{POLICIES.length} policy documents</b> that comprise our Trust &amp;
        Policy Center v1, prepared for a single-pass legal review before
        public launch.
      </p>
      <p>
        We chose to send all documents together (rather than piecemeal) so that
        counsel can catch inconsistencies <em>between</em> documents — for
        example, Terms vs Returns vs Privacy — that would be invisible in a
        document-by-document review.
      </p>
      <p>
        Every document carries an internal <b>Appendix A — Attorney Review
        Notes</b> with the specific items we know need your input. Please treat
        those as a <em>starting list, not a limit</em>. If you spot additional
        legal risks or improvements, flag them.
      </p>

      <h2 className="pkt-h2">Documents Included</h2>
      <table className="pkt-doclist">
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Slug</th>
            <th>Version</th>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          {POLICIES.map((p, i) => (
            <tr key={p.slug}>
              <td className="tabular">{String(i + 1).padStart(2, "0")}</td>
              <td>{p.title}</td>
              <td className="mono">{p.slug}</td>
              <td className="tabular">{p.version}</td>
              <td>{p.category}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="pkt-h2">Nine Focus Areas — Please Review Specifically</h2>
      <ol className="pkt-focus">
        <li>
          <b>Consistency across all policies.</b> Where do the twelve documents
          disagree with each other on any material term, definition, hierarchy,
          or obligation?
        </li>
        <li>
          <b>Marketplace-facilitator responsibilities.</b> Does our
          marketplace-model framing (Platform vs. Maker vs. Buyer) hold up
          legally, including for marketplace-facilitator sales-tax purposes?
        </li>
        <li>
          <b>Washington State considerations.</b> We designate King County, WA
          as the primary venue and Washington law as governing. Please confirm
          this framework is defensible and identify any Washington-specific
          consumer-protection or business-license provisions we should add.
        </li>
        <li>
          <b>Privacy disclosures.</b> Does the Privacy Policy (v3.0) meet
          current state-privacy-law standards (CCPA/CPRA, VCDPA, CPA, CTDPA,
          UCPA)? If we open to EU/UK, what needs to change?
        </li>
        <li>
          <b>Payment / fee language.</b> Do the Fee &amp; Commission clauses
          accurately describe our commission structure and Stripe-facilitated
          payments? Any exposure around off-site ad fees or promoted-listing
          fees?
        </li>
        <li>
          <b>Seller obligations.</b> Does the Maker Agreement adequately
          protect the Platform while remaining enforceable against
          independent-contractor Makers? Please review content-license grant,
          exclusivity clarifications, and payout hold provisions.
        </li>
        <li>
          <b>Dispute resolution.</b> We currently point disputes to Washington
          courts. Should we adopt mandatory arbitration with a class-action
          waiver? What are the trade-offs for a Version-1 curated marketplace
          of our size?
        </li>
        <li>
          <b>Required consumer disclosures.</b> Are we missing any mandatory
          disclosures for a U.S. e-commerce marketplace (e.g., FTC endorsement
          guides for reviews, Made in USA claims, subscription auto-renewal
          for Crafters Plus at $12/month)?
        </li>
        <li>
          <b>Substantive changes flagged in Appendix A.</b> For each Appendix
          A item across the twelve documents, please confirm whether it
          requires substantive legal changes or can be resolved with a
          clarifying edit.
        </li>
      </ol>

      <h2 className="pkt-h2">What We Need Back</h2>
      <ul className="pkt-ul">
        <li>Tracked edits or comments on each document.</li>
        <li>
          Any items in Appendix A that are OK as-is (so we can clear those
          first).
        </li>
        <li>
          Any additional legal issues you identify that are not in Appendix A.
        </li>
        <li>
          Sign-off (or conditional sign-off with a list of blockers) so we can
          trigger the pre-publication process on our end.
        </li>
      </ul>

      <h2 className="pkt-h2">Standing Quarterly Review</h2>
      <p>
        Following this launch review, we intend to engage counsel on a{" "}
        <b>standing quarterly review cadence</b> (light-touch: 30–60 minutes
        per quarter, or ad-hoc after material feature launches or regulatory
        changes). This packet is the launch review; future reviews will be
        smaller in scope.
      </p>

      {!attorneyMode && (
        <>
          <h2 className="pkt-h2">Post-Review Process on Our Side</h2>
          <ol className="pkt-ol">
            <li>Apply your edits in a working branch.</li>
            <li>
              Clear the Appendix A / B / C arrays in <code>manifest.js</code> as
              each item is closed.
            </li>
            <li>Re-run our internal Policy Consistency Audit.</li>
            <li>Publish.</li>
          </ol>
        </>
      )}

      <div className="pkt-pagebreak" />
    </section>
  );
}

function PolicyHierarchyBlock() {
  return (
    <section className="pkt-block">
      <h3 className="pkt-h3">Policy Hierarchy — Order of Precedence</h3>
      <ol className="pkt-ol">
        {POLICY_HIERARCHY.map((h) => (
          <li key={h.level}>
            <b>{h.label}</b> — <span className="muted">{h.note}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RevisionHistoryBlock({ policy }) {
  if (!policy?.revision_history?.length) return null;
  return (
    <section className="pkt-block">
      <h3 className="pkt-h3">Revision History</h3>
      <ul className="pkt-ul">
        {policy.revision_history.map((r, i) => (
          <li key={i} className="mono">
            <b>v{r.version}</b> · {r.date} · {r.summary}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RelatedPoliciesBlock({ policy }) {
  if (!policy?.related?.length) return null;
  const items = policy.related
    .map((slug) => POLICIES.find((p) => p.slug === slug))
    .filter(Boolean);
  if (!items.length) return null;
  return (
    <section className="pkt-block">
      <h3 className="pkt-h3">Related Policies</h3>
      <ul className="pkt-ul">
        {items.map((r) => (
          <li key={r.slug}>
            → {r.title} <span className="muted">({r.slug})</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AttorneyReviewBlock({ policy, mode }) {
  if (!policy) return null;
  const attorneyMode = mode === "attorney";

  // In attorney mode, drop pure engineering-status notes and hide
  // Appendix B (Implementation Notes) and Appendix C (Cross-Reference
  // Checklist) entirely.
  const attorneyNotes = attorneyMode
    ? (policy.attorney_notes || []).filter((n) => !isEngineeringOnlyNote(n))
    : (policy.attorney_notes || []);
  const implNotes = attorneyMode ? [] : (policy.implementation_notes || []);
  const crossRef = attorneyMode ? [] : (policy.cross_ref_checklist || []);

  const has =
    attorneyNotes.length + implNotes.length + crossRef.length > 0;
  if (!has) return null;

  return (
    <section className="pkt-block pkt-attorney">
      <h3 className="pkt-h3">
        {attorneyMode
          ? "Appendix A — Attorney Review Questions"
          : "Internal Appendices — Attorney Review Notes / Implementation / Cross-Reference"}
      </h3>

      {attorneyNotes.length > 0 && (
        <>
          {!attorneyMode && <h4 className="pkt-h4">Appendix A — Attorney Review Notes</h4>}
          <ul className="pkt-ul">
            {attorneyNotes.map((n, i) => (
              <li key={i}>
                <b>{n.section}</b> — {n.note}
              </li>
            ))}
          </ul>
        </>
      )}

      {implNotes.length > 0 && (
        <>
          <h4 className="pkt-h4">Appendix B — Implementation Notes</h4>
          <ul className="pkt-ul">
            {implNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}

      {crossRef.length > 0 && (
        <>
          <h4 className="pkt-h4">Appendix C — Cross-Reference Checklist</h4>
          <ul className="pkt-ul">
            {crossRef.map((c, i) => (
              <li key={i}>✓ {c}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function PolicyPacketSection({ policy, index, mode }) {
  const section = SECTIONS.find((s) => s.id === policy.section_id);
  return (
    <article className="pkt-policy">
      <header className="pkt-pol-header">
        <div className="pkt-eyebrow">
          Policy {String(index + 1).padStart(2, "0")} of {POLICIES.length} ·{" "}
          {policy.category}
        </div>
        <h2 className="pkt-h1-pol">{policy.title}</h2>
        <div className="pkt-meta-inline mono">
          <span>
            <b>Version:</b> {policy.version}
          </span>
          <span>
            <b>Effective:</b> {policy.effective_date}
          </span>
          <span>
            <b>Last updated:</b> {policy.last_updated}
          </span>
          <span>
            <b>Slug:</b> /policies/{policy.slug}
          </span>
        </div>
        <p className="pkt-description">{policy.description}</p>
      </header>

      {section?.intro && <p className="pkt-intro">{section.intro}</p>}

      {section?.blocks?.length > 0 && (
        <section className="pkt-block">
          <h3 className="pkt-h3">Contents</h3>
          <ol className="pkt-toc">
            {section.blocks.map((b, i) => (
              <li key={i}>{b.heading || `Section ${i + 1}`}</li>
            ))}
          </ol>
        </section>
      )}

      <div className="pkt-body">
        {(section?.blocks || []).map((block, i) => (
          <section key={i} className="pkt-body-block">
            {block.heading && (
              <h3 className="pkt-h3">
                §{String(i + 1).padStart(2, "0")} · {block.heading}
              </h3>
            )}
            {block.text && <p>{block.text}</p>}
            {block.list && (
              <ul className="pkt-ul">
                {block.list.map(([k, v], j) => (
                  <li key={j}>
                    <b>{k}</b> {v}
                  </li>
                ))}
              </ul>
            )}
            {block.bullets && (
              <ul className="pkt-ul">
                {block.bullets.map((b, j) => (
                  <li key={j}>{b}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {section?.callout && (
        <aside className="pkt-callout">
          <b>◆ Note:</b> {section.callout.text}
        </aside>
      )}

      {section?.outro && <div className="pkt-outro">{section.outro}</div>}

      <PolicyHierarchyBlock />
      <RevisionHistoryBlock policy={policy} />
      <RelatedPoliciesBlock policy={policy} />
      <AttorneyReviewBlock policy={policy} mode={mode} />

      <div className="pkt-pagebreak" />
    </article>
  );
}

function GlossaryAppendix() {
  return (
    <section className="pkt-glossary">
      <div className="pkt-eyebrow">Appendix</div>
      <h2 className="pkt-h1-pol">Shared Terminology Glossary</h2>
      <p className="muted">
        Every Crafters Market policy uses these terms consistently.
      </p>
      <dl className="pkt-glossary-list">
        {GLOSSARY.map((g) => (
          <React.Fragment key={g.term}>
            <dt>{g.term}</dt>
            <dd>{g.definition}</dd>
          </React.Fragment>
        ))}
      </dl>
    </section>
  );
}

export default function PrintBundlePage() {
  const location = useLocation();
  const mode = location.pathname.startsWith("/attorney-packet") ? "attorney" : "internal";

  React.useEffect(() => {
    document.body.classList.add("counsel-packet-mode");
    return () => document.body.classList.remove("counsel-packet-mode");
  }, []);

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div
        className="pkt-root"
        data-testid={mode === "attorney" ? "attorney-packet-page" : "counsel-packet-page"}
        data-packet-mode={mode}
      >
        <CoverSheet mode={mode} />
        {POLICIES.map((p, i) => (
          <PolicyPacketSection key={p.slug} policy={p} index={i} mode={mode} />
        ))}
        <GlossaryAppendix />
        <footer className="pkt-footer">
          <p className="muted mono">
            End of packet · {POLICIES.length} policies · Generated{" "}
            {PACKET_META.prepared_at} · Crafters Market Operations ·{" "}
            {PACKET_META.contact} · Mode: {mode}
          </p>
        </footer>
      </div>
    </>
  );
}

// ============================================================
//  Print stylesheet — inlined so the page renders identically
//  whether opened in the browser or fed to chromium
//  --print-to-pdf. Uses only serif fonts and simple layout to
//  keep the PDF small and printable.
// ============================================================
const PRINT_CSS = `
  /* iter413dp — hide site chrome when the counsel packet is
     mounted. Applied via body.counsel-packet-mode set by
     PrintBundlePage's useEffect. Renders as a standalone
     document in the browser AND for chromium --print-to-pdf. */
  body.counsel-packet-mode { background: #fff !important; }
  body.counsel-packet-mode .App > .fixed,
  body.counsel-packet-mode > .fixed,
  body.counsel-packet-mode nav,
  body.counsel-packet-mode footer,
  body.counsel-packet-mode [data-testid="site-nav"],
  body.counsel-packet-mode [class*="BetaBanner"],
  body.counsel-packet-mode [class*="HelpSupportWidget"],
  body.counsel-packet-mode [class*="AIAssistant"],
  body.counsel-packet-mode [data-testid="cookie-banner"],
  body.counsel-packet-mode [data-testid^="cookie-banner"],
  body.counsel-packet-mode [class*="cookie"],
  body.counsel-packet-mode [class*="Cookie"],
  body.counsel-packet-mode .ImpersonationBanner,
  body.counsel-packet-mode [class*="Impersonation"] {
    display: none !important;
  }
  body.counsel-packet-mode main { padding-top: 0 !important; }
  body.counsel-packet-mode .grain,
  body.counsel-packet-mode .App { background-image: none !important; background: #fff !important; }

  html, body { background: #fff; color: #111; }
  .pkt-root {
    max-width: 780px;
    margin: 0 auto;
    padding: 48px 40px;
    font-family: "Georgia", "Times New Roman", serif;
    font-size: 11.5pt;
    line-height: 1.55;
    color: #111;
  }
  .pkt-root .mono, .pkt-root code { font-family: "SFMono-Regular", "Menlo", monospace; font-size: 10pt; }
  .pkt-root .tabular { font-variant-numeric: tabular-nums; }
  .pkt-root .muted { color: #555; }
  .pkt-root .pkt-eyebrow {
    font-family: "SFMono-Regular", monospace;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    font-size: 8.5pt;
    color: #b24a00;
    margin-bottom: 8px;
  }
  .pkt-root .pkt-h1 {
    font-size: 26pt;
    line-height: 1.1;
    font-weight: 700;
    margin: 0 0 20px;
    letter-spacing: -0.01em;
  }
  .pkt-root .pkt-h1-pol {
    font-size: 22pt;
    line-height: 1.15;
    font-weight: 700;
    margin: 0 0 12px;
    letter-spacing: -0.005em;
  }
  .pkt-root .pkt-h2 {
    font-size: 14pt;
    font-weight: 700;
    margin: 28px 0 10px;
    border-bottom: 1px solid #b24a00;
    padding-bottom: 4px;
  }
  .pkt-root .pkt-h3 {
    font-size: 12pt;
    font-weight: 700;
    margin: 20px 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .pkt-root .pkt-h4 {
    font-size: 11pt;
    font-weight: 700;
    margin: 14px 0 6px;
  }
  .pkt-root p { margin: 0 0 10px; }
  .pkt-root ul, .pkt-root ol { margin: 0 0 12px 0; padding-left: 22px; }
  .pkt-root li { margin: 4px 0; }

  .pkt-root .pkt-meta { width: 100%; border-collapse: collapse; margin: 20px 0 28px; }
  .pkt-root .pkt-meta th, .pkt-root .pkt-meta td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 10.5pt; }
  .pkt-root .pkt-meta th { background: #f7f2ec; width: 30%; font-weight: 700; }

  .pkt-root .pkt-doclist { width: 100%; border-collapse: collapse; margin: 8px 0 24px; }
  .pkt-root .pkt-doclist th, .pkt-root .pkt-doclist td { border: 1px solid #ddd; padding: 5px 8px; font-size: 10pt; text-align: left; }
  .pkt-root .pkt-doclist th { background: #f7f2ec; font-weight: 700; }

  .pkt-root .pkt-focus { margin: 10px 0 20px 20px; }
  .pkt-root .pkt-focus li { margin: 8px 0; }

  .pkt-root .pkt-policy {
    margin-top: 28px;
    padding-top: 20px;
    border-top: 2px solid #b24a00;
  }
  .pkt-root .pkt-pol-header { margin-bottom: 16px; }
  .pkt-root .pkt-meta-inline { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 8px 0 12px; font-size: 9.5pt; color: #333; }
  .pkt-root .pkt-description { font-style: italic; color: #333; margin: 8px 0 14px; }

  .pkt-root .pkt-intro { margin: 12px 0 14px; }
  .pkt-root .pkt-body-block { margin: 12px 0; page-break-inside: avoid; }
  .pkt-root .pkt-toc { margin: 4px 0 12px 20px; font-size: 10.5pt; }
  .pkt-root .pkt-toc li { margin: 2px 0; }

  .pkt-root .pkt-callout {
    background: #fff7ec;
    border-left: 3px solid #b24a00;
    padding: 10px 12px;
    margin: 14px 0;
    font-size: 10.5pt;
  }

  .pkt-root .pkt-attorney {
    background: #fffaf0;
    border: 1px solid #e6c37a;
    padding: 12px 16px;
    margin-top: 18px;
    page-break-inside: avoid;
  }
  .pkt-root .pkt-attorney .pkt-h3 { color: #8a4a00; }

  .pkt-root .pkt-glossary { margin-top: 40px; padding-top: 20px; border-top: 2px solid #b24a00; }
  .pkt-root .pkt-glossary-list { margin-top: 10px; }
  .pkt-root .pkt-glossary-list dt { font-weight: 700; margin-top: 8px; }
  .pkt-root .pkt-glossary-list dd { margin: 2px 0 6px 16px; color: #333; }

  .pkt-root .pkt-footer { margin-top: 40px; text-align: center; }

  .pkt-root .pkt-pagebreak { page-break-after: always; }

  @page {
    size: Letter;
    margin: 0.6in 0.6in 0.75in 0.6in;
    @bottom-center {
      content: "Crafters Market — Trust & Policy Center v1 · Counsel Review Packet · Page " counter(page) " of " counter(pages);
      font-family: Georgia, serif;
      font-size: 8.5pt;
      color: #666;
    }
  }
`;
