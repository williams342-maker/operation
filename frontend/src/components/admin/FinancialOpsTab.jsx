/**
 * iter446 — Admin → Fin Ops: executive financial operations dashboard.
 * GMV / revenue / balances / payouts / health score / reconciliation status
 * in one morning view, plus nightly report history + run-now.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, PlayCircle } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;
const _auth = () => {
  const t = localStorage.getItem("cm_admin_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
const usd = (c) => (c === null || c === undefined ? "—" : `$${(c / 100).toFixed(2)}`);

function Card({ label, value, sub, cls = "text-ink", testId }) {
  return (
    <div className="border border-line p-3" data-testid={testId}>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">{label}</div>
      <div className={`font-display text-2xl mt-1 ${cls}`}>{value}</div>
      {sub && <div className="font-mono text-[9px] text-ink-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export default function FinancialOpsTab() {
  const [d, setD] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, rep] = await Promise.all([
        fetch(`${API}/api/admin/finance/ops-dashboard`, { headers: _auth() }).then((x) => x.json()),
        fetch(`${API}/api/admin/finance/recon-reports?limit=7`, { headers: _auth() }).then((x) => x.json()),
      ]);
      setD(dash); setReports(rep.reports || []);
    } catch (e) { toast.error(`Load failed: ${e.message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function runNow() {
    setRunning(true);
    try {
      const r = await fetch(`${API}/api/admin/finance/reconciliation/run`, {
        method: "POST", headers: _auth(),
      });
      const rep = await r.json();
      if (!r.ok) throw new Error(rep.detail || `HTTP ${r.status}`);
      toast.success(`Reconciliation ${rep.status.toUpperCase()} — health ${rep.score}%.`);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setRunning(false); }
  }

  const health = d?.health;
  return (
    <div className="space-y-6" data-testid="finops-tab">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
          ◆ Financial Operations · morning dashboard
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runNow} disabled={running}
                  className="border border-brand text-brand px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] hover:bg-brand hover:text-paper disabled:opacity-40 transition flex items-center gap-1.5"
                  data-testid="finops-run-recon">
            <PlayCircle size={13} /> {running ? "Checking…" : "Run checks now"}
          </button>
          <button onClick={load} className="border border-line px-2 py-1.5 hover:border-brand transition" title="Refresh" data-testid="finops-refresh">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Health score hero */}
      <div className="border border-line p-4 flex flex-col md:flex-row gap-5" data-testid="finops-health">
        <div className="text-center md:text-left md:pr-6 md:border-r md:border-line">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Marketplace health</div>
          <div className={`font-display text-5xl mt-1 ${
            health ? (health.score >= 99 ? "text-green-600" : health.score >= 90 ? "text-amber-500" : "text-red-400") : "text-ink-muted"}`}
            data-testid="finops-health-score">
            {health ? `${health.score}%` : "—"}
          </div>
          <div className="font-mono text-[10px] text-ink-muted mt-1" data-testid="finops-health-checked">
            {health ? `last checked ${new Date(health.at).toLocaleString()}` : "no nightly run yet — hit Run checks now"}
          </div>
          {health && (
            <div className={`inline-block mt-2 border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
              health.status === "balanced" ? "text-green-600 border-green-500/40" : "text-amber-500 border-amber-400/40"}`}
              data-testid="finops-recon-status">
              {health.status === "balanced" ? "✔ Ledger Balanced" : `⚠ Difference ${usd(Math.abs(d?.diff_cents || 0))}`}
            </div>
          )}
        </div>
        <div className="flex-1 grid sm:grid-cols-2 gap-x-6" data-testid="finops-health-checklist">
          {(health?.checks || []).map((c) => (
            <div key={c.id} className={`font-mono text-[11px] py-0.5 ${c.ok ? "text-green-600" : "text-amber-500"}`}
                 data-testid={`finops-check-${c.id}`} title={c.detail}>
              {c.ok ? "✓" : "⚠"} {c.label}
              <span className="text-ink-muted"> — {c.detail}</span>
            </div>
          ))}
          {!health && <p className="font-mono text-[11px] text-ink-muted">Nightly checks run at 2:07 AM Pacific.</p>}
        </div>
      </div>

      {/* Money now */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Today's GMV" value={usd(d?.gmv_today_cents)} sub={`${d?.orders_today ?? "—"} order(s)`} cls="text-brand" testId="finops-gmv" />
        <Card label="Platform revenue (commission)" value={usd(d?.commission_today_cents)} cls="text-green-600" testId="finops-revenue" />
        <Card label="Stripe balance" value={usd(d?.stripe_balance_cents)} sub={d?.stripe_balance_cents === null ? "API unavailable" : null} testId="finops-stripe" />
        <Card label="PayPal balance" value={usd(d?.paypal_balance_cents)} sub={d?.paypal_balance_cents === null ? "API unavailable" : null} testId="finops-paypal" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Deferred maker balances" value={usd(d?.deferred_maker_balances_cents)} cls="text-green-600" testId="finops-deferred" />
        <Card label="Upcoming payouts (eligible)" value={usd(d?.upcoming_payouts_cents)} cls="text-sky-600" testId="finops-upcoming" />
        <Card label="Failed payouts" value={usd(d?.failed_payouts?.cents)} sub={`${d?.failed_payouts?.count ?? 0} row(s)`}
              cls={d?.failed_payouts?.count ? "text-red-400" : "text-ink"} testId="finops-failed" />
        <Card label="Refunds today" value={usd(d?.refunds_today_cents)} cls="text-red-400" testId="finops-refunds" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Chargebacks / disputes" value={usd(d?.disputes_cents)} cls={d?.disputes_cents ? "text-red-400" : "text-ink"} testId="finops-disputes" />
        <Card label="Automation" value={d?.automation?.enabled ? "ON" : d?.automation?.admin_flag ? "ARMED" : "PAUSED"}
              sub={d?.automation?.schedule} cls={d?.automation?.enabled ? "text-green-600" : "text-amber-500"} testId="finops-automation" />
        <Card label="Next payout run" value={d?.next_payout_run_at ? new Date(d.next_payout_run_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}
              sub={d?.next_payout_run_at ? new Date(d.next_payout_run_at).toLocaleDateString() : null} testId="finops-next-run" />
        <Card label="Weekly payout forecast" value={usd(d?.weekly_payout_forecast_cents)} cls="text-sky-600" testId="finops-forecast" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Largest outstanding balance" value={usd(d?.largest_outstanding?.cents)}
              sub={d?.largest_outstanding?.maker_name || "—"} testId="finops-largest" />
        <Card label="Makers awaiting PayPal email" value={d?.makers_missing_paypal_email ?? "—"}
              cls={d?.makers_missing_paypal_email ? "text-amber-500" : "text-ink"} testId="finops-missing-email" />
        <Card label="Makers below minimum" value={d?.makers_below_minimum ?? "—"} testId="finops-below-min" />
        <Card label="Pending payouts (processing)" value={usd(d?.pending_payouts_cents)} cls="text-sky-600" testId="finops-pending" />
      </div>

      {/* Nightly report history */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted mb-2">
          ◆ Nightly reconciliation reports
        </div>
        {reports.length === 0 ? (
          <p className="font-mono text-[11px] text-ink-muted" data-testid="finops-reports-empty">
            No reports yet — the engine runs nightly at 2:07 AM Pacific.
          </p>
        ) : (
          <div className="border border-line divide-y divide-line" data-testid="finops-reports">
            {reports.map((r) => (
              <div key={r.id} className="p-3 flex flex-wrap items-center gap-3 font-mono text-[11px]" data-testid={`finops-report-${r.id}`}>
                <span className="text-ink">{new Date(r.at).toLocaleString()}</span>
                <span className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${
                  r.status === "balanced" ? "text-green-600 border-green-500/40" : "text-amber-500 border-amber-400/40"}`}>
                  {r.status === "balanced" ? "✔ balanced" : "⚠ alert"}
                </span>
                <span className="text-brand font-display text-base">{r.score}%</span>
                <span className="text-ink-muted">{r.orders_today} order(s) · {r.payouts_today} payout(s)</span>
                {r.possible_cause && <span className="text-amber-500 truncate">{r.possible_cause}</span>}
                <span className="text-ink-muted ml-auto">by {r.trigger}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
