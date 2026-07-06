/**
 * `/account/data-request` — Google Play Data Safety compliance surface.
 *
 * Play Console's Data Safety form asks a separate question:
 *   "Do you provide a way for users to request that SOME or ALL of their
 *    data is deleted, WITHOUT requiring them to delete their account?"
 *
 * Answering "Yes" requires a public URL. This page is that URL. It
 * covers PARTIAL data-deletion requests — as opposed to full account
 * closure, which is at `/account/delete`.
 *
 * We don't try to be clever with SDK integrations here. The clearest
 * compliant path is a structured email intake form that a human on the
 * support team fulfils within the SLA disclosed on the page.
 */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const SUPPORT_EMAIL = "support@craftersmarket.org";

// The categories Google Play requires us to enumerate individually. Mirrors
// what we declare in the Play Console → Data Safety form so a reviewer sees
// perfect parity between the two artefacts.
const CATEGORIES = [
  { id: "profile",     label: "Profile info (name, avatar, bio, phone)" },
  { id: "reviews",     label: "Reviews I've written" },
  { id: "showcase",    label: "Showcase posts I've published" },
  { id: "forum",       label: "Forum threads and replies" },
  { id: "messages",    label: "Direct messages I've sent" },
  { id: "followers",   label: "Follows and follower relationships" },
  { id: "search",      label: "My search history (what I've looked for)" },
  { id: "analytics",   label: "My usage-analytics identifier" },
  { id: "marketing",   label: "Marketing preferences and email opt-ins" },
  { id: "addresses",   label: "Saved shipping / billing addresses" },
];

export default function DataRequestPage() {
  const [picked, setPicked] = useState(() => new Set());
  const [notes, setNotes] = useState("");

  function toggle(id) {
    setPicked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const mailtoHref = (() => {
    const chosen = CATEGORIES.filter(c => picked.has(c.id))
      .map(c => `- ${c.label}`).join("\n");
    const body =
      `Please delete the following categories of my personal data from ` +
      `Crafters Market. My account should remain active.\n\n` +
      `Requested categories:\n${chosen || "- (none selected)"}\n\n` +
      `Additional notes:\n${notes || "(none)"}\n\n` +
      `— Sent from craftersmarket.org/account/data-request`;
    const params = new URLSearchParams({
      subject: "Data-deletion request (account stays active)",
      body,
    });
    return `mailto:${SUPPORT_EMAIL}?${params.toString()}`;
  })();

  function copyEmail() {
    navigator.clipboard.writeText(SUPPORT_EMAIL);
    toast.success("Support address copied to clipboard.");
  }

  return (
    <div className="min-h-screen bg-paper text-ink" data-testid="data-request-page">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-4">
          ◆ Account · Data request
        </div>
        <h1 className="font-display text-4xl md:text-5xl leading-tight mb-6">
          Request deletion of some of your data
        </h1>
        <p className="text-ink-muted mb-10 max-w-2xl">
          You can ask us to remove specific categories of your personal
          data without closing your Crafters Market account. Pick what
          you&apos;d like removed below, then send us your request. If
          you&apos;d rather delete your entire account, use{" "}
          <Link to="/account/delete" className="text-brand underline">
            /account/delete
          </Link>{" "}
          instead.
        </p>

        {/* Category checklist */}
        <section className="border border-line p-6 mb-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-4">
            Choose what to remove
          </div>
          <ul className="space-y-2">
            {CATEGORIES.map(c => (
              <li key={c.id}>
                <label
                  className={`flex items-start gap-3 px-3 py-2 border cursor-pointer transition
                    ${picked.has(c.id) ? "border-brand bg-brand/5" : "border-line hover:border-ink-muted"}`}
                >
                  <input
                    type="checkbox"
                    checked={picked.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="mt-1 accent-brand"
                    data-testid={`data-cat-${c.id}`}
                  />
                  <span className="text-sm">{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
            rows={3}
            placeholder="Optional — anything else you'd like our team to know."
            className="mt-4 w-full border border-line bg-paper px-3 py-2 font-mono text-xs focus:outline-none focus:border-brand"
            data-testid="data-request-notes"
          />
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <a
              href={mailtoHref}
              className="flex-1 text-center bg-brand hover:bg-brand-hover text-ink font-mono text-xs uppercase tracking-[0.22em] px-4 py-3"
              data-testid="data-request-mailto-btn"
            >
              Send request email →
            </a>
            <button
              onClick={copyEmail}
              className="border border-line px-4 py-3 font-mono text-xs uppercase tracking-[0.22em] hover:bg-surface-2"
              data-testid="data-request-copy-email-btn"
            >
              Copy support address
            </button>
          </div>
          <p className="mt-4 text-[10px] text-ink-muted">
            The button above opens your email client with a pre-filled
            request. Please send it from the address on your account so
            we can verify identity — otherwise we&apos;ll need to ask
            you to confirm before deleting anything.
          </p>
        </section>

        {/* Timeline + retention notice */}
        <section className="space-y-8">
          <div>
            <h2 className="font-display text-2xl md:text-3xl mb-3">Timeline</h2>
            <ul className="list-disc pl-6 space-y-1 text-ink-muted">
              <li>Requests are acknowledged within <strong>2 business days</strong>.</li>
              <li>Standard requests are completed within <strong>10 business days</strong>.</li>
              <li>Complex cases (e.g. touching multiple systems) may take up to <strong>30 days</strong>. We will update you if we need the extra time.</li>
              <li>You&apos;ll receive an email confirmation with the exact rows removed.</li>
            </ul>
          </div>

          <div>
            <h2 className="font-display text-2xl md:text-3xl mb-3">What we can&apos;t remove</h2>
            <p className="text-ink-muted mb-2">
              Some records are retained by law and cannot be deleted while
              your account stays active. We can, however, anonymize the
              personally identifiable fields on them:
            </p>
            <ul className="list-disc pl-6 space-y-1 text-ink-muted">
              <li>Completed order and tax records — retained up to 7 years for accounting and fraud-prevention rules.</li>
              <li>Aggregate analytics — session and funnel metrics that no longer identify you.</li>
              <li>Payments audit trail on the Stripe side — governed by Stripe&apos;s own retention policy.</li>
            </ul>
          </div>

          <div>
            <h2 className="font-display text-2xl md:text-3xl mb-3">Prefer to delete everything?</h2>
            <p className="text-ink-muted">
              Head to{" "}
              <Link to="/account/delete" className="text-brand underline">
                /account/delete
              </Link>
              {" "}for full account deletion. You can also do it in-app
              from the settings screen once signed in.
            </p>
          </div>

          <div>
            <h2 className="font-display text-2xl md:text-3xl mb-3">Legal basis</h2>
            <p className="text-ink-muted">
              This flow satisfies the deletion rights granted under GDPR
              Article 17, CCPA §1798.105, and equivalent state privacy
              laws (CPRA, CPA, VCDPA, CTDPA, UCPA, TDPSA). See the{" "}
              <Link to="/policies?tab=privacy" className="text-brand underline">
                Privacy Policy §6 (Your Rights)
              </Link>
              {" "}for the full framework.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
