import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { decideMakerApplication, deleteMakerApplication, toggleMakerBeta } from "../../lib/api";
import { formatDate } from "./_shared";

// Filter pills — "Pending" is the default so rejected apps don't clutter
// the admin's actionable queue. "Beta" is the dedicated view the user
// asked for ("a spot for beta applications") — same data, just sliced.
const FILTERS = [
  { id: "pending",  label: "Pending"  },
  { id: "beta",     label: "Beta"     },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all",      label: "All"      },
];

function matchesFilter(app, filterId) {
  const status = app.status || "pending";
  if (filterId === "all")      return true;
  if (filterId === "pending")  return !app.status;
  if (filterId === "approved") return status === "approved";
  if (filterId === "rejected") return status === "rejected";
  if (filterId === "beta")     return !!app.is_beta;
  return true;
}

export default function ApplicationsList({ items, onChange }) {
  const [filter, setFilter] = useState("pending");
  // Counts per filter so the admin sees the queue depth at a glance.
  const counts = useMemo(() => {
    const c = { pending: 0, beta: 0, approved: 0, rejected: 0, all: items.length };
    items.forEach((a) => {
      if (!a.status) c.pending += 1;
      if (a.is_beta) c.beta += 1;
      if (a.status === "approved") c.approved += 1;
      if (a.status === "rejected") c.rejected += 1;
    });
    return c;
  }, [items]);

  const filtered = items.filter((a) => matchesFilter(a, filter));

  return (
    <div className="space-y-4" data-testid="apps-list">
      {/* Filter pills bar */}
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-[#262626]" data-testid="apps-filters">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mr-1">Filter:</span>
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
                  ? "border-[#ff4500] text-[#ff4500] bg-[#ff4500]/5"
                  : "border-[#262626] text-[#a3a3a3] hover:border-[#525252] hover:text-[#e5e5e5]"
              }`}
            >
              {f.label}
              <span className={`text-[9px] ${active ? "text-[#ff4500]" : "text-[#525252]"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="font-mono text-sm text-[#a3a3a3] py-6" data-testid="apps-empty">
          {filter === "pending"
            ? "No pending applications — you're all caught up."
            : `No ${filter} applications.`}
        </p>
      ) : (
        filtered.map((a) => (
          <ApplicationRow key={a.id} app={a} onChange={onChange} />
        ))
      )}
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
    <div className="mt-3 border border-[#ff4500]/40 bg-[#ff4500]/5 p-3" data-testid="beta-countdown">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
          {expired ? "◆ Beta Expired" : "◆ Founding Seller Beta"}
        </div>
        <div className="font-display text-xl text-[#ff4500]" data-testid="beta-countdown-value">
          {expired ? `Ended ${days}d ago` : `${days}d ${hours}h left`}
        </div>
      </div>
      <div className="mt-2 h-1 bg-[#262626] overflow-hidden">
        <div
          className="h-full bg-[#ff4500] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
          data-testid="beta-progress-bar"
        />
      </div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3]">
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
      <div className="flex items-center justify-between gap-3 border border-[#262626] p-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            Founding Seller Beta
          </div>
          <div className="font-mono text-xs text-[#e5e5e5] mt-1">
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
              ? "bg-[#ff4500] border-[#ff4500]"
              : "bg-[#0a0a0a] border-[#262626]"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 bg-black transition-transform ${
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
    if (!window.confirm(
      `Permanently delete this application?\n\n` +
      `Studio: ${app.studio_name}\nStatus: ${app.status || "pending"}\n\n` +
      `This removes the application row only. Approved makers (and their listings/orders) are NOT affected.`,
    )) return;
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
          ? "border-[#ff4500]/60 hover:border-[#ff4500]"
          : "border-[#262626] hover:border-[#ff4500]"
      }`}
      data-testid={`app-${app.id}`}
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 pb-3 border-b border-[#262626]">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] flex flex-wrap items-center gap-2">
            <span>
              ◆ {app.status ? `Decided · ${app.status}` : "Pending"} ·{" "}
              {formatDate(app.created_at)}
            </span>
            {app.is_beta && (
              <span
                className="px-1.5 py-0.5 bg-[#ff4500] text-black font-bold"
                data-testid={`app-beta-badge-${app.id}`}
              >
                FOUNDING SELLER BETA
              </span>
            )}
          </div>
          <div className="font-display text-2xl mt-1 break-words">{app.studio_name}</div>
          <div className="font-mono text-xs text-[#a3a3a3] mt-1 break-words">
            {app.name} · {app.location} ·{" "}
            <a href={`mailto:${app.email}`} className="underline hover:text-[#ff4500] break-all">
              {app.email}
            </a>
          </div>
          {app.techniques?.length ? (
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-2">
              {app.techniques.join(" · ")}
            </div>
          ) : null}
          {app.portfolio_url ? (
            <div className="font-mono text-[10px] mt-1">
              <a
                href={app.portfolio_url}
                target="_blank"
                rel="noreferrer"
                className="text-[#ff4500] hover:underline"
              >
                Portfolio ↗
              </a>
            </div>
          ) : null}
        </div>
        {/* Delete control — kept on every row so admins can clean up
            spam/test/duplicate apps regardless of status. The confirm
            dialog explains we only remove the application audit row,
            not the maker / listings / orders. */}
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          aria-label="Delete application"
          title="Delete this application"
          data-testid={`app-delete-${app.id}`}
          className="shrink-0 self-start inline-flex items-center gap-1.5 px-2.5 py-1 border border-[#262626] hover:border-red-500 hover:text-red-400 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
        >
          {deleting ? "…" : "✕ Delete"}
        </button>
      </div>
      <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-3">{displayAbout}</p>

      {!decided && (
        <div className="mt-4 space-y-3">
          {app.is_beta && (
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] leading-relaxed">
              ◆ Approving this applicant will grant Founding Seller Beta with a 90-day window.
            </p>
          )}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional note (sent to applicant)"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
            data-testid={`app-note-${app.id}`}
          />
          <div className="flex gap-3">
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
              className="px-5 py-3 border border-[#262626] hover:border-red-500 hover:text-red-400 font-mono text-[11px] uppercase tracking-[0.22em] transition disabled:opacity-50"
              data-testid={`app-reject-${app.id}`}
            >
              Reject
            </button>
          </div>
        </div>
      )}
      {decided && app.note && (
        <div className="mt-3 font-mono text-xs text-[#a3a3a3] border-l-2 border-[#ff4500] pl-3">
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
    </div>
  );
}
