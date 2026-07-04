/*
 * Founder Review tab (iter418) — Final-review closeout UI.
 *
 * Renders:
 *   1. A "Founder Slots" card with the headline metrics (active /
 *      needs_review / cap) and Open/Close applications buttons.
 *   2. A table of every ``tier === "founder"`` maker with activity
 *      metrics + status verdict + "Move to Free Tier" action.
 *
 * Backend contract:
 *   GET  /api/admin/founders/slots-detail    → { active, needs_review, cap, applications_open }
 *   GET  /api/admin/founders/review          → { rows: [...] , active, needs_review, cap, applications_open }
 *   POST /api/admin/founders/{slug}/downgrade  { reason? }  → downgrades, opens slot
 *   POST /api/admin/founders/applications-gate { open: bool }  → manual toggle
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";

const API = process.env.REACT_APP_BACKEND_URL;

function adminHeaders(extra = {}) {
  const token = localStorage.getItem("cm_admin_jwt") || "";
  return { Authorization: `Bearer ${token}`, ...extra };
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function SignalPill({ active, label }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] border ${
        active
          ? "border-emerald-600 bg-emerald-500/10 text-emerald-400"
          : "border-line bg-transparent text-ink-muted"
      }`}
      title={active ? `Signal present: ${label}` : `Signal missing: ${label}`}
      data-testid={`signal-${label}-${active ? "on" : "off"}`}
    >
      {active ? "✓" : "○"} {label.replace(/_/g, " ")}
    </span>
  );
}

export default function FounderReviewTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // slug that's currently being downgraded
  const [gateBusy, setGateBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/admin/founders/review`, {
        headers: adminHeaders(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j);
    } catch (e) {
      toast.error(`Could not load Founder review: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function downgrade(slug) {
    const reason = window.prompt(
      `Move ${slug} to the Free tier?\n\nThis frees a Founder slot. The maker and their listings stay intact.\n\nOptional reason (visible in audit log):`,
      "",
    );
    if (reason === null) return; // cancelled
    setBusy(slug);
    try {
      const r = await fetch(`${API}/api/admin/founders/${slug}/downgrade`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ reason }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      toast.success(`${slug} moved to Free. ${j.slots_available} slot(s) available.`);
      await load();
    } catch (e) {
      toast.error(`Downgrade failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function toggleGate(open) {
    if (
      open === false
      && !window.confirm("Close Founder applications? The /founders CTA will show the closed-for-review message.")
    ) return;
    if (
      open === true
      && !window.confirm("Reopen Founder applications? New signups can promote to Founder while slots are available.")
    ) return;
    setGateBusy(true);
    try {
      const r = await fetch(`${API}/api/admin/founders/applications-gate`, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ open }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      toast.success(
        open ? `Applications reopened (${j.active_founders}/${j.cap} active)` : `Applications closed`,
      );
      if (open && j.at_or_over_cap) {
        toast.warning("Note: you're already at or over the cap — no new promotions will succeed until slots free up.");
      }
      await load();
    } catch (e) {
      toast.error(`Toggle failed: ${e.message}`);
    } finally {
      setGateBusy(false);
    }
  }

  if (loading) return <div className="p-6 font-mono text-sm text-ink-muted">Loading Founder review…</div>;
  if (!data) return null;

  const slotsAvail = Math.max(0, data.cap - data.active);

  return (
    <div className="space-y-8" data-testid="founder-review-tab">
      {/* ---------- Slots card ---------- */}
      <section
        className="border border-line bg-paper/50 p-6"
        data-testid="founder-slots-card"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2">
              ◆ Founder Slots
            </div>
            <div className="font-display text-4xl mb-2">
              <span data-testid="slots-active">{data.active}</span>
              <span className="text-ink-muted"> / {data.cap}</span>
            </div>
            <div className="font-mono text-xs text-ink-muted uppercase tracking-[0.18em]">
              Active Founder Makers &nbsp;·&nbsp;{" "}
              <span
                className={data.needs_review > 0 ? "text-amber-500" : "text-ink-muted"}
                data-testid="slots-needs-review"
              >
                {data.needs_review} needs review
              </span>{" "}
              &nbsp;·&nbsp; {slotsAvail} slot{slotsAvail === 1 ? "" : "s"} available
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div
              className={`inline-flex items-center gap-2 px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] ${
                data.applications_open
                  ? "border-emerald-600 bg-emerald-500/10 text-emerald-400"
                  : "border-amber-500 bg-amber-500/10 text-amber-500"
              }`}
              data-testid="slots-applications-status"
            >
              {data.applications_open ? "◆ Applications Open" : "◆ Applications Closed"}
            </div>
            {data.applications_open ? (
              <button
                type="button"
                onClick={() => toggleGate(false)}
                disabled={gateBusy}
                className="px-4 py-2 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
                data-testid="slots-close-btn"
              >
                Close Founder Applications
              </button>
            ) : (
              <button
                type="button"
                onClick={() => toggleGate(true)}
                disabled={gateBusy}
                className="px-4 py-2 border border-brand bg-brand text-white hover:bg-brand/90 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
                data-testid="slots-reopen-btn"
              >
                Reopen Founder Applications
              </button>
            )}
          </div>
        </div>
        {data.active >= data.cap && data.applications_open && (
          <div className="mt-4 border-l-4 border-amber-500 bg-amber-500/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-500">
            ⚠ At/over cap but applications still open. New promotes will succeed
            beyond {data.cap}. Consider closing until inactive founders are moved.
          </div>
        )}
      </section>

      {/* ---------- Review table ---------- */}
      <section data-testid="founder-review-table-wrap">
        {/* iter421 — Health score distribution strip: at-a-glance
            of how the roster is doing without scanning every row. */}
        {data.rows.length > 0 && (
          <div
            className="flex flex-wrap gap-2 mb-3"
            data-testid="health-distribution"
          >
            {(() => {
              const buckets = [
                { name: "Excellent", stars: 5, tint: "border-emerald-600 bg-emerald-500/10 text-emerald-500" },
                { name: "Healthy", stars: 4, tint: "border-emerald-600/60 bg-emerald-500/5 text-emerald-500" },
                { name: "Good", stars: 3, tint: "border-line bg-paper text-ink" },
                { name: "Needs Attention", stars: 2, tint: "border-amber-500 bg-amber-500/10 text-amber-500" },
                { name: "Dormant", stars: 1, tint: "border-red-500 bg-red-500/10 text-red-400" },
              ];
              return buckets.map((b) => {
                const n = data.rows.filter((r) => (r.health || {}).stars === b.stars).length;
                if (n === 0) return null;
                return (
                  <span
                    key={b.stars}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.18em] ${b.tint}`}
                    data-testid={`health-bucket-${b.stars}`}
                  >
                    {"★".repeat(b.stars)}{"☆".repeat(5 - b.stars)} · {b.name} · {n}
                  </span>
                );
              });
            })()}
          </div>
        )}
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-brand">
            ◆ Founder Roster — Activity Review
          </div>
          <button
            type="button"
            onClick={load}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand"
            data-testid="review-refresh-btn"
          >
            ↻ Refresh
          </button>
        </div>
        <div className="overflow-x-auto border border-line">
          <table className="w-full text-sm font-mono" data-testid="founder-review-table">
            <thead className="bg-paper/70 text-ink-muted text-[10px] uppercase tracking-[0.2em]">
              <tr>
                <th className="text-left px-3 py-2">Founder</th>
                <th className="text-left px-3 py-2">Health</th>
                <th className="text-left px-3 py-2">Approved</th>
                <th className="text-left px-3 py-2">Last Login</th>
                <th className="text-right px-3 py-2">Published</th>
                <th className="text-left px-3 py-2">Last Product Update</th>
                <th className="text-right px-3 py-2">Sales</th>
                <th className="text-left px-3 py-2">Signals</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={row.slug}
                  className={`border-t border-line ${row.status === "needs_review" ? "bg-amber-500/5" : ""}`}
                  data-testid={`founder-row-${row.slug}`}
                >
                  <td className="px-3 py-3">
                    <div className="text-ink flex items-center gap-2">
                      {row.founder_number != null && (
                        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-brand">
                          #{String(row.founder_number).padStart(3, "0")}
                        </span>
                      )}
                      <span className="font-medium">{row.name || row.slug}</span>
                    </div>
                    {row.shop_title && (
                      <div className="text-[11px] text-ink-muted">{row.shop_title}</div>
                    )}
                    {row.email && (
                      <div className="text-[11px] text-ink-muted break-all">{row.email}</div>
                    )}
                    {row.founder_status && (
                      <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted mt-1">
                        {row.founder_status}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {row.health && row.health.stars ? (
                      <div className="min-w-[9rem]" data-testid={`health-${row.slug}`}>
                        <div className={`font-display text-lg ${
                          row.health.stars >= 4 ? "text-emerald-500"
                          : row.health.stars === 3 ? "text-ink"
                          : row.health.stars === 2 ? "text-amber-500" : "text-red-400"
                        }`} title={`Score: ${row.health.score}/100`}>
                          {"★".repeat(row.health.stars)}{"☆".repeat(5 - row.health.stars)}
                        </div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                          {row.health.verdict} · {row.health.score}/100
                        </div>
                        <div className="font-mono text-[9px] text-ink-muted mt-0.5">
                          store {row.health.completeness_pct || 0}% complete
                        </div>
                      </div>
                    ) : (
                      <span className="font-mono text-[10px] text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-ink-muted text-[11px]">{fmtDate(row.approved_at)}</td>
                  <td className="px-3 py-3 text-ink-muted text-[11px]">{fmtDate(row.last_login)}</td>
                  <td className="px-3 py-3 text-right">
                    {row.published_products}
                    {row.total_products !== row.published_products && (
                      <span className="text-ink-muted"> / {row.total_products}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-ink-muted text-[11px]">{fmtDate(row.last_product_update)}</td>
                  <td className="px-3 py-3 text-right">{row.sales_count}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[240px]">
                      <SignalPill active={row.signals.has_shop_profile} label="profile" />
                      <SignalPill active={row.signals.has_published_product} label="listing" />
                      <SignalPill active={row.signals.recent_login} label="login" />
                      <SignalPill active={row.signals.has_sales} label="sales" />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.2em] border ${
                        row.status === "active"
                          ? "border-emerald-600 bg-emerald-500/10 text-emerald-400"
                          : "border-amber-500 bg-amber-500/10 text-amber-500"
                      }`}
                    >
                      {row.status === "active" ? "Active" : "Needs Review"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => downgrade(row.slug)}
                      disabled={busy === row.slug}
                      className="px-2 py-1 border border-line hover:border-brand font-mono text-[9px] uppercase tracking-[0.2em] disabled:opacity-50"
                      data-testid={`downgrade-${row.slug}`}
                      title="Move this founder back to the Free tier. Frees a slot. Maker + listings kept."
                    >
                      {busy === row.slug ? "…" : "Move to Free"}
                    </button>
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-ink-muted text-[11px] uppercase tracking-[0.2em]">
                    No Founder makers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
          A Founder is <span className="text-emerald-400">Active</span> if <em>any</em> signal is present.
          {" "}Rows flagged <span className="text-amber-500">Needs Review</span> have no activity — decide whether to move them to Free.
          Downgrades open a slot and are logged in the audit trail.
        </p>
      </section>
    </div>
  );
}
