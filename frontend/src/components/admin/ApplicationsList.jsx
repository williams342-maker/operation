import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { decideMakerApplication, deleteMakerApplication, toggleMakerBeta } from "../../lib/api";
import { formatDate } from "./_shared";
import AdminEmailModal from "./AdminEmailModal";
import WelcomePacketPreviewModal from "./WelcomePacketPreviewModal";
import DeclineReasonPicker from "../DeclineReasonPicker";
import { useConfirm } from "../../hooks/useConfirm";

// Filter pills — Pending is the default so decided applications don't
// clutter the daily review queue. Approved and Rejected moved to dedicated
// tabs ("Approved Makers" / "Rejected") so each list has its own focus.
const FILTERS = [
  { id: "pending",  label: "Pending"  },
  { id: "beta",     label: "Beta"     },
  { id: "all",      label: "All"      },
];

function matchesFilter(app, filterId) {
  const status = app.status || "pending";
  if (filterId === "all")      return true;
  if (filterId === "pending")  return !app.status;
  if (filterId === "beta")     return !!app.is_beta && !status.match(/rejected/);
  return true;
}

export default function ApplicationsList({ items, onChange }) {
  const [filter, setFilter] = useState("pending");
  // Counts per filter so the admin sees the queue depth at a glance.
  const counts = useMemo(() => {
    const c = { pending: 0, beta: 0, all: items.length };
    items.forEach((a) => {
      if (!a.status) c.pending += 1;
      if (a.is_beta && a.status !== "rejected") c.beta += 1;
    });
    return c;
  }, [items]);

  const filtered = items.filter((a) => matchesFilter(a, filter));

  return (
    <div className="space-y-4" data-testid="apps-list">
      {/* Filter pills bar */}
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-line" data-testid="apps-filters">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mr-1">Filter:</span>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count = counts[f.id];
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              data-testid={`apps-filter-${f.id}`}
              className={`px-2.5 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition inline-flex items-center gap-2 ${
                active
                  ? "border-brand text-brand bg-brand/5"
                  : "border-line text-ink-muted hover:border-ink-muted hover:text-ink"
              }`}
            >
              {f.label}
              <span className={`text-[9px] ${active ? "text-brand" : "text-ink-muted"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="font-mono text-sm text-ink-muted py-6" data-testid="apps-empty">
          {filter === "pending"
            ? "No pending applications — you're all caught up."
            : `No ${filter} applications.`}
        </p>
      ) : (
        filtered.map((a) => (
          <ApplicationRow key={a.id} app={a} onChange={onChange} />
        ))
      )}
      <p className="font-mono text-[10px] text-ink-muted uppercase tracking-[0.22em] pt-2 border-t border-line">
        ◆ Approved makers and rejected applications now live in dedicated tabs.
      </p>
    </div>
  );
}

// Live 90-day countdown for Founding Seller Beta access. Re-renders every
// 60s so the "X days / Y hrs left" stays honest without a websocket.
function BetaCountdown({ expiresAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!expiresAt) return null;
  const end = new Date(expiresAt).getTime();
  const msLeft = end - now;
  const expired = msLeft <= 0;
  const days = Math.floor(Math.abs(msLeft) / (1000 * 60 * 60 * 24));
  const hours = Math.floor((Math.abs(msLeft) / (1000 * 60 * 60)) % 24);
  const pct = Math.max(0, Math.min(100, (msLeft / (90 * 24 * 60 * 60 * 1000)) * 100));
  return (
    <div className="mt-3 border border-brand/40 bg-brand/5 p-3" data-testid="beta-countdown">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
          {expired ? "◆ Beta Expired" : "◆ Founding Seller Beta"}
        </div>
        <div className="font-display text-xl text-brand" data-testid="beta-countdown-value">
          {expired ? `Ended ${days}d ago` : `${days}d ${hours}h left`}
        </div>
      </div>
      <div className="mt-2 h-1 bg-line overflow-hidden">
        <div
          className="h-full bg-brand transition-[width] duration-500"
          style={{ width: `${pct}%` }}
          data-testid="beta-progress-bar"
        />
      </div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
        Ends {new Date(expiresAt).toLocaleDateString()} · 90-day founding window
      </div>
    </div>
  );
}

function BetaToggleSwitch({ slug, initialEnabled, initialExpiresAt, onUpdated }) {
  const [enabled, setEnabled] = useState(!!initialEnabled);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt || null);
  const [busy, setBusy] = useState(false);

  const flip = async () => {
    const next = !enabled;
    setBusy(true);
    try {
      const r = await toggleMakerBeta(slug, next);
      setEnabled(!!r.is_beta);
      setExpiresAt(r.beta_expires_at || null);
      toast.success(
        next
          ? `Beta access granted · 90-day countdown started.`
          : `Beta access removed.`
      );
      onUpdated?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to update beta status.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border border-line p-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Founding Seller Beta
          </div>
          <div className="font-mono text-xs text-ink mt-1">
            {enabled ? "Active · 90-day perks & badge enabled" : "Off · regular maker"}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={busy}
          onClick={flip}
          data-testid={`beta-switch-${slug}`}
          className={`relative inline-flex items-center h-7 w-14 shrink-0 border transition-colors disabled:opacity-50 ${
            enabled
              ? "bg-brand border-brand"
              : "bg-paper border-line"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 bg-paper transition-transform ${
              enabled ? "translate-x-8" : "translate-x-1"
            }`}
          />
          <span className="sr-only">{enabled ? "Disable beta" : "Enable beta"}</span>
        </button>
      </div>
      {enabled && <BetaCountdown expiresAt={expiresAt} />}
    </div>
  );
}

function ApplicationRow({ app, onChange }) {
  const [note, setNote] = useState(app.note || "");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirm, confirmModal] = useConfirm();
  const decided = app.status === "approved" || app.status === "rejected";
  const decide = async (approved) => {
    setBusy(true);
    try {
      await decideMakerApplication(app.id, { approved, note });
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const ok = await confirm({
      title: "Permanently delete this application?",
      body: `${app.studio_name} · Status: ${app.status || "pending"}. Removes the application row only — approved makers, listings, and orders are NOT affected.`,
      confirmLabel: "Delete application",
      tone: "danger",
      testId: `confirm-delete-app-${app.id}`,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteMakerApplication(app.id);
      toast.success("Application deleted.");
      await onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to delete.");
      setDeleting(false);
    }
  };
  // Strip the internal `[FOUNDING SELLER BETA]` marker from the public
  // about excerpt so admins see the applicant's actual pitch, not our tag.
  const displayAbout = (app.about || "").replace(/^\[FOUNDING SELLER BETA\]\s*/, "");
  return (
    <div
      className={`border transition p-5 ${
        app.is_beta
          ? "border-brand/60 hover:border-brand"
          : "border-line hover:border-brand"
      }`}
      data-testid={`app-${app.id}`}
    >
      {confirmModal}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 pb-3 border-b border-line">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand flex flex-wrap items-center gap-2">
            <span>
              ◆ {app.status ? `Decided · ${app.status}` : "Pending"} ·{" "}
              {formatDate(app.created_at)}
            </span>
            {app.is_beta && (
              <span
                className="px-1.5 py-0.5 bg-brand text-ink font-bold"
                data-testid={`app-beta-badge-${app.id}`}
              >
                FOUNDING SELLER BETA
              </span>
            )}
          </div>
          <div className="font-display text-2xl mt-1 break-words">{app.studio_name}</div>
          <div className="font-mono text-xs text-ink-muted mt-1 break-words">
            {app.name} · {app.location} ·{" "}
            <a href={`mailto:${app.email}`} className="underline hover:text-brand break-all">
              {app.email}
            </a>
          </div>
          {app.techniques?.length ? (
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-2">
              {app.techniques.join(" · ")}
            </div>
          ) : null}
          {app.portfolio_url ? (
            <div className="font-mono text-[10px] mt-1">
              <a
                href={app.portfolio_url}
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                Portfolio ↗
              </a>
            </div>
          ) : null}
        </div>
        {/* Email + Delete controls — the ✉ Email button lets the admin
            reply to the applicant directly (pending, approved, or
            rejected). Delete removes the audit row without affecting the
            maker / listings / orders. */}
        <div className="flex gap-2 shrink-0 self-start">
          <button
            type="button"
            onClick={() => setEmailOpen(true)}
            aria-label="Email applicant"
            title="Send a direct email to this applicant"
            data-testid={`app-email-${app.id}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
          >
            ✉ Email
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={deleting}
            aria-label="Delete application"
            title="Delete this application"
            data-testid={`app-delete-${app.id}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-line hover:border-red-500 hover:text-red-400 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          >
            {deleting ? "…" : "✕ Delete"}
          </button>
        </div>
      </div>
      <p className="font-mono text-xs text-ink leading-relaxed mt-3">{displayAbout}</p>

      {!decided && (
        <div className="mt-4 space-y-3">
          {app.is_beta && (
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand leading-relaxed">
              ◆ Approving this applicant will grant Founding Seller Beta with a 90-day window.
            </p>
          )}
          <DeclineReasonPicker
            kind="application"
            value={note}
            onChange={setNote}
            testIdPrefix={`app-note-${app.id}`}
            placeholder="Optional note (sent to applicant on Approve OR Reject)"
            rows={2}
          />
          <div className="flex gap-3">
            <button
              onClick={() => setPreviewOpen(true)}
              disabled={busy}
              type="button"
              data-testid={`app-preview-${app.id}`}
              className="px-5 py-3 border border-line hover:border-brand hover:text-brand font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              title="Preview the email the applicant will receive on approve / reject"
            >
              ▤ Preview email
            </button>
            <button
              onClick={() => decide(true)}
              disabled={busy}
              className="btn-industrial btn-primary disabled:opacity-50"
              data-testid={`app-approve-${app.id}`}
            >
              Approve
            </button>
            <button
              onClick={() => decide(false)}
              disabled={busy}
              className="px-5 py-3 border border-line hover:border-red-500 hover:text-red-400 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid={`app-reject-${app.id}`}
            >
              Reject
            </button>
          </div>
        </div>
      )}
      {decided && app.note && (
        <div className="mt-3 font-mono text-xs text-ink-muted border-l-2 border-brand pl-3">
          {app.note}
        </div>
      )}
      {/* Beta switch + countdown — shown for every approved application that
          has a linked maker (any maker, not just beta ones). This lets the
          admin promote/demote a regular maker into the Founding Seller
          program retroactively. */}
      {app.status === "approved" && app.maker_slug && (
        <div className="mt-4">
          <BetaToggleSwitch
            slug={app.maker_slug}
            initialEnabled={app.maker_is_beta}
            initialExpiresAt={app.maker_beta_expires_at}
            onUpdated={onChange}
          />
        </div>
      )}
      {emailOpen && (
        <AdminEmailModal
          applicationId={app.id}
          recipientEmail={app.email}
          recipientName={app.name || app.studio_name}
          onClose={() => setEmailOpen(false)}
        />
      )}
      {previewOpen && (
        <WelcomePacketPreviewModal
          applicationId={app.id}
          applicantName={app.name}
          studio={app.studio_name}
          initialNote={note}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}
