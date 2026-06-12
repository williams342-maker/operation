import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Crown } from "lucide-react";
import { fetchAdminPlusMembers } from "../../lib/api";
import { formatDate } from "./_shared";
import { RowsSkeleton } from "../Skeleton";
import EmptyState from "../EmptyState";

const API = process.env.REACT_APP_BACKEND_URL;

// Directory of Crafters Plus subscribers ($12/mo). Shows Stripe subscription
// metadata + 30d ROI so the admin can spot churn-risk / high-value shops.
export default function PlusMembersTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [replenishBusy, setReplenishBusy] = useState(false);
  const [replenishResult, setReplenishResult] = useState(null);

  // iter326 — Founders Wall integrity. Auto-runs the repair endpoint
  // in dry-run mode on tab mount so we know IMMEDIATELY whether the
  // duplicate-founder-number bug has crept back in. Operator can then
  // hit "Apply repair" to renumber the collisions.
  const [repairStatus, setRepairStatus] = useState({ loading: true, plan: null, error: "" });
  const [repairBusy, setRepairBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await fetchAdminPlusMembers();
        setRows(data);
      } catch (e) {
        setErr(e?.response?.data?.detail || "Failed to load Plus members.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /**
   * One-click "seed boost credits now" button. Skips waiting for the
   * monthly cron on the 1st by hitting the admin replenish endpoint
   * directly. Idempotent — repeating it the same day just keeps both
   * pools at their per-month cap, so the admin can mash this safely.
   */
  const handleReplenish = async () => {
    setReplenishBusy(true);
    setReplenishResult(null);
    try {
      const token = localStorage.getItem("cm_admin_jwt");
      const res = await fetch(`${API}/api/admin/founders/replenish-credits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReplenishResult(data);
      const plusN = data?.plus?.replenished ?? 0;
      const vetN = data?.veteran?.replenished ?? 0;
      toast.success("Boost credits replenished", {
        description: `${plusN} Plus subscriber${plusN === 1 ? "" : "s"} · ${vetN} veteran${vetN === 1 ? "" : "s"}`,
      });
    } catch (e) {
      toast.error("Replenish failed", { description: e?.message || "Try again in a moment." });
    } finally {
      setReplenishBusy(false);
    }
  };

  // iter326 — Run the repair endpoint in dry-run mode on mount and
  // whenever the operator clicks "Re-check". Returns a structured plan
  // listing every collision the apply step will fix.
  const fetchRepairPlan = async () => {
    setRepairStatus((s) => ({ ...s, loading: true, error: "" }));
    try {
      const token = localStorage.getItem("cm_admin_jwt");
      const res = await fetch(`${API}/api/admin/founders/repair-numbers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRepairStatus({ loading: false, plan: data, error: "" });
    } catch (e) {
      setRepairStatus({ loading: false, plan: null, error: e?.message || "Could not load repair plan." });
    }
  };

  useEffect(() => { fetchRepairPlan(); }, []);

  // One-click apply. Re-fetches the plan after success so the badge
  // updates immediately. Protected by a confirm() — the underlying
  // endpoint is idempotent but a renumber on the live Founders Wall is
  // a visible, non-trivial change worth confirming.
  const handleApplyRepair = async () => {
    const planned = repairStatus.plan?.proposed_changes || [];
    if (!planned.length) {
      toast.info("Nothing to repair", { description: "No duplicate founder numbers detected." });
      return;
    }
    const ok = window.confirm(
      `Renumber ${planned.length} colliding maker${planned.length === 1 ? "" : "s"}? ` +
      `Newer collisions will get fresh sequential numbers. Older makers keep their slots.`,
    );
    if (!ok) return;
    setRepairBusy(true);
    try {
      const token = localStorage.getItem("cm_admin_jwt");
      const res = await fetch(`${API}/api/admin/founders/repair-numbers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      toast.success("Founder numbers repaired", {
        description: `${data.duplicates_renumbered || 0} maker${data.duplicates_renumbered === 1 ? "" : "s"} renumbered · counter set to #${data.counter_set_to}`,
      });
      await fetchRepairPlan();
    } catch (e) {
      toast.error("Repair failed", { description: e?.message || "Try again." });
    } finally {
      setRepairBusy(false);
    }
  };

  const mrr = rows.length * 12;
  const totalGmv30 = rows.reduce((s, r) => s + (r.gmv_30d || 0), 0);

  return (
    <div className="space-y-4" data-testid="plus-members-tab">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-700">◆ Paid Members</div>
        <h2 className="font-display text-3xl md:text-4xl mt-1">Crafters Plus Subscribers</h2>
      </div>

      {/* Maintenance — manual boost credit replenish.
          Normally fired by the monthly cron at 00:05 UTC on the 1st.
          This button gives the admin an "I want it NOW" lever during
          launch / testing or after a config change. */}
      <div
        className="border border-line bg-paper p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
        data-testid="plus-replenish-card"
      >
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            ◆ Maintenance · Boost Credit Replenish
          </div>
          <div className="text-xs text-ink mt-1.5 leading-relaxed">
            Tops every Plus subscriber to <span className="text-emerald-700">$15</span> and every veteran-owned maker to <span className="text-brand">$10</span> in boost credit.
            Auto-runs monthly on the 1st at 00:05 UTC.
          </div>
          {replenishResult && (
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-700 mt-2">
              ✓ Replenished: {replenishResult.plus?.replenished ?? 0} Plus · {replenishResult.veteran?.replenished ?? 0} Veterans
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleReplenish}
          disabled={replenishBusy}
          data-testid="plus-replenish-btn"
          className="shrink-0 inline-flex items-center justify-center px-4 py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-ink font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
        >
          {replenishBusy ? "Replenishing…" : "Replenish now"}
        </button>
      </div>

      {/* iter326 — Founders Wall integrity card. Auto-detects duplicate
          founder_numbers on mount and exposes a one-click repair. The
          underlying endpoint (POST /api/admin/founders/repair-numbers)
          renumbers newer collisions while keeping the OLDEST maker's
          slot stable. Idempotent — re-running is a no-op. */}
      {(() => {
        const plan = repairStatus.plan;
        const planned = plan?.proposed_changes || [];
        const hasDupes = planned.length > 0;
        return (
          <div
            className={`border bg-paper p-4 ${hasDupes ? "border-red-700/60" : "border-line"}`}
            data-testid="founders-repair-card"
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] flex items-center gap-2">
                  <span className={hasDupes ? "text-red-400" : "text-emerald-700"}>◆ Founders Wall integrity</span>
                  {repairStatus.loading ? (
                    <span className="text-[9px] text-ink-muted">checking…</span>
                  ) : hasDupes ? (
                    <span
                      className="text-[9px] px-1.5 py-px bg-red-950/40 border border-red-700 text-red-600"
                      data-testid="founders-repair-badge-dupes"
                    >
                      {planned.length} duplicate{planned.length === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span
                      className="text-[9px] px-1.5 py-px bg-emerald-950/40 border border-emerald-700 text-emerald-700"
                      data-testid="founders-repair-badge-clean"
                    >
                      Clean
                    </span>
                  )}
                </div>
                <div className="font-display text-lg mt-1 text-ink">
                  {hasDupes
                    ? `${planned.length} maker${planned.length === 1 ? " is" : "s are"} sharing slot number${planned.length === 1 ? "" : "s"}`
                    : "Every Founder owns a unique slot number."}
                </div>
                <div className="font-mono text-[10px] text-ink-muted mt-1.5 leading-relaxed">
                  {hasDupes
                    ? "Newer collisions will get fresh sequential numbers. Older makers keep their slots. Activity-ticker events stay in sync."
                    : `Counter at #${plan?.counter_will_be_set_to ?? "—"} · ${plan?.total_founders ?? 0} founders total.`}
                </div>
                {repairStatus.error && (
                  <div className="font-mono text-[10px] text-red-400 mt-2" data-testid="founders-repair-error">
                    {repairStatus.error}
                  </div>
                )}
                {hasDupes && (
                  <details className="mt-2" data-testid="founders-repair-details">
                    <summary className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted cursor-pointer hover:text-brand">
                      ▸ Show {planned.length} planned change{planned.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-2 space-y-1 font-mono text-[10px] text-ink-muted">
                      {planned.map((p, i) => (
                        <li key={i} className="flex items-baseline gap-2">
                          <span className="text-red-400">#{String(p.old_number).padStart(3, "0")}</span>
                          <span className="text-ink-muted">→</span>
                          <span className="text-emerald-700">#{String(p.new_number).padStart(3, "0")}</span>
                          <span className="text-ink truncate">{p.name || p.slug}</span>
                          <span className="text-ink-muted">(keeps slot: {p.kept_for_slug})</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <div className="shrink-0 flex flex-col md:flex-row gap-2">
                <button
                  type="button"
                  onClick={fetchRepairPlan}
                  disabled={repairStatus.loading}
                  data-testid="founders-repair-recheck-btn"
                  className="px-3 py-2 border border-line hover:border-brand disabled:opacity-50 font-mono text-[10px] uppercase tracking-[0.22em] text-ink transition"
                >
                  Re-check
                </button>
                <button
                  type="button"
                  onClick={handleApplyRepair}
                  disabled={!hasDupes || repairBusy}
                  data-testid="founders-repair-apply-btn"
                  className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition ${
                    hasDupes
                      ? "bg-red-600 hover:bg-red-700 text-ink"
                      : "bg-surface text-ink-muted cursor-not-allowed"
                  } disabled:opacity-60`}
                >
                  {repairBusy ? "Repairing…" : hasDupes ? `Apply repair (${planned.length})` : "Nothing to repair"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border border-line p-4" data-testid="plus-stat-count">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Active</div>
          <div className="font-display text-4xl mt-1 text-ink">{rows.length}</div>
        </div>
        <div className="border border-line p-4" data-testid="plus-stat-mrr">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">MRR</div>
          <div className="font-display text-4xl mt-1 text-emerald-700">${mrr}</div>
        </div>
        <div className="border border-line p-4" data-testid="plus-stat-gmv">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">30d GMV</div>
          <div className="font-display text-4xl mt-1 text-brand">${totalGmv30.toFixed(0)}</div>
        </div>
        <div className="border border-line p-4" data-testid="plus-stat-canceling">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Canceling</div>
          <div className="font-display text-4xl mt-1 text-brand">{rows.filter((r) => r.cancel_at_period_end).length}</div>
        </div>
      </div>

      {loading && <div data-testid="plus-loading" className="py-2"><RowsSkeleton count={5} /></div>}
      {err && <div className="font-mono text-xs text-red-400 py-6">{err}</div>}
      {!loading && rows.length === 0 && (
        <EmptyState
          icon={Crown}
          eyebrow="◆ Crafters Plus"
          title="No subscribers yet."
          body="When makers upgrade to Crafters Plus ($12/mo), their subscription metadata and 30-day ROI will appear here so you can spot churn risk early."
          cta={{
            label: "Open Pricing page",
            href: "/pricing",
            testId: "plus-empty-pricing-cta",
          }}
          testId="plus-empty"
        />
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-xs" data-testid="plus-members-table">
            <thead>
              <tr className="text-ink-muted uppercase tracking-[0.22em] text-[10px] border-b border-line">
                <th className="text-left py-2 pr-3">Studio</th>
                <th className="text-left py-2 pr-3">Email</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-left py-2 pr-3">Started</th>
                <th className="text-left py-2 pr-3">Renews</th>
                <th className="text-right py-2 pr-3">30d GMV</th>
                <th className="text-right py-2">Net value / mo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug} className="border-b border-line hover:bg-surface" data-testid={`plus-row-${r.slug}`}>
                  <td className="py-3 pr-3">
                    <div className="text-ink">{r.name || r.slug}</div>
                    <div className="text-[9px] text-ink-muted">/{r.slug}</div>
                  </td>
                  <td className="py-3 pr-3 break-all">
                    <a href={`mailto:${r.email}`} className="text-ink-muted hover:text-brand">{r.email}</a>
                  </td>
                  <td className="py-3 pr-3">
                    <span className={`inline-block px-1.5 py-0.5 border text-[9px] font-bold ${
                      r.cancel_at_period_end
                        ? "border-amber-500/60 text-brand"
                        : "border-emerald-500/60 text-emerald-700"
                    }`}>
                      {r.cancel_at_period_end ? "CANCELING" : r.subscription_status?.toUpperCase() || "ACTIVE"}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-ink-muted">{formatDate(r.started_at)}</td>
                  <td className="py-3 pr-3 text-ink-muted">{formatDate(r.current_period_end)}</td>
                  <td className="py-3 pr-3 text-right text-brand">${(r.gmv_30d || 0).toFixed(2)}</td>
                  <td className={`py-3 text-right ${r.plus_net_value_30d >= 0 ? "text-emerald-700" : "text-ink-muted"}`}>
                    {r.plus_net_value_30d >= 0 ? "+" : ""}${r.plus_net_value_30d?.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="font-mono text-[10px] text-ink-muted mt-3">
            Net value = 1% commission savings on 30d GMV − $12 monthly cost. Negative means Plus isn't paying off yet.
          </p>
        </div>
      )}
    </div>
  );
}
