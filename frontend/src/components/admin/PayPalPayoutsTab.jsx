/**
 * iter441 — Admin → PayPal Payouts (Phase 1: admin-triggered).
 * Per-maker balances (available / missing email / on hold / processing /
 * lifetime paid), Pay Now / Pay Selected / Pay All Eligible with a dry-run
 * confirmation, payout run history, CSV export.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, X } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;
const _auth = () => {
  const t = localStorage.getItem("cm_admin_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
const usd = (c) => `$${((c || 0) / 100).toFixed(2)}`;

const STATUS_BADGE = {
  ready: "text-green-600 border-green-500/40",
  deferred: "text-amber-500 border-amber-400/40",
  hold: "text-red-400 border-red-400/40",
};

export default function PayPalPayoutsTab() {
  const [data, setData] = useState(null);
  const [runs, setRuns] = useState([]);
  const [engine, setEngine] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testDlg, setTestDlg] = useState(null); // {email, request_id, result}

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, ov] = await Promise.all([
        fetch(`${API}/api/admin/paypal/payouts/summary`, { headers: _auth() }).then((x) => x.json()),
        fetch(`${API}/api/admin/paypal/payouts/runs`, { headers: _auth() }).then((x) => x.json()),
        fetch(`${API}/api/admin/paypal/payouts/overview`, { headers: _auth() }).then((x) => x.json()),
      ]);
      setData(s); setRuns(r.runs || []); setEngine(ov);
    } catch (e) { toast.error(`Load failed: ${e.message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const makers = engine?.makers || [];
  const totals = engine?.totals || {};
  const automation = engine?.automation || {};
  const eligible = makers.filter((m) => m.eligible_cents > 0 && m.paypal_email && !m.payouts_on_hold);

  async function toggleAutomation() {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/admin/paypal/payouts/automation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ..._auth() },
        body: JSON.stringify({ enabled: !automation.admin_flag }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      toast.success(`Automation ${d.admin_flag ? "armed" : "paused"} (env flag ${d.env_flag ? "ON" : "OFF"}).`);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function runEngineNow(dry) {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/admin/paypal/payouts/automation/run-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ..._auth() },
        body: JSON.stringify({ dry_run: dry }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      toast.success(dry
        ? `Dry run: ${(d.dispatched || []).length} maker(s) would be paid, ${(d.skipped || []).length} skipped.`
        : `Engine cycle done — ${(d.dispatched || []).length} maker(s) dispatched.`);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  const toggle = (slug) => setSelected((s) => {
    const n = new Set(s); n.has(slug) ? n.delete(slug) : n.add(slug); return n;
  });

  async function dryRun(slugs) {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/admin/paypal/payouts/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ..._auth() },
        body: JSON.stringify({ maker_slugs: slugs, dry_run: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      if (!d.makers) { toast.info("No eligible balances for that selection."); return; }
      setPreview({ ...d, slugs });
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function execute() {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/admin/paypal/payouts/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ..._auth() },
        body: JSON.stringify({ maker_slugs: preview.slugs, dry_run: false }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      toast.success(`Payout batch ${d.payout_batch_id || d.run_id} submitted — ${d.makers} maker(s), ${usd(d.total_cents)}.`);
      setPreview(null); setSelected(new Set());
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function exportCsv() {
    try {
      const r = await fetch(`${API}/api/admin/paypal/payouts/export.csv`, { headers: _auth() });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "paypal-payouts.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(`Export failed: ${e.message}`); }
  }

  async function sendTestPayout() {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/admin/paypal/payouts/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ..._auth() },
        body: JSON.stringify({
          recipient_email: testDlg.email.trim(),
          confirm: true,
          request_id: testDlg.request_id,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setTestDlg((s) => ({ ...s, result: d }));
      toast.success(d.duplicate
        ? "Already submitted — showing the existing test batch."
        : `Test payout submitted — batch ${d.payout_batch_id}.`);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  const cards = [
    ["Eligible", totals.eligible_today_cents, "text-green-600"],
    ["Waiting hold", totals.waiting_hold_cents, "text-amber-500"],
    ["Waiting minimum", totals.waiting_minimum_cents, "text-amber-500"],
    ["Missing email", totals.missing_paypal_cents, "text-amber-500"],
    ["Processing", totals.processing_cents, "text-sky-600"],
    ["Paid today", totals.paid_today_cents, "text-ink"],
    ["Failed", totals.failed_cents, "text-red-400"],
  ];

  return (
    <div className="space-y-6" data-testid="paypal-payouts-tab">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
          ◆ PayPal Payouts · admin-triggered · {data?.environment || "…"}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] hover:border-brand transition" data-testid="pp-payouts-export">
            ⤓ Export CSV
          </button>
          <button onClick={load} className="border border-line px-2 py-1.5 hover:border-brand transition" title="Refresh" data-testid="pp-payouts-refresh">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {cards.map(([label, val, cls]) => (
          <div key={label} className="border border-line p-3" data-testid={`payouts-card-${label}`}>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">{label}</div>
            <div className={`font-display text-2xl mt-1 ${cls}`}>{usd(val)}</div>
          </div>
        ))}
      </div>

      <div className="border border-line p-3 flex items-center gap-3 flex-wrap" data-testid="autopayout-strip">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">◆ Automated payouts</span>
        <span className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
          automation.enabled ? "text-green-600 border-green-500/40" : "text-amber-500 border-amber-400/40"}`}
          data-testid="autopayout-status-badge">
          {automation.enabled ? "🟢 enabled" : automation.admin_flag ? "🟡 armed (env flag off)" : "⏸ paused"}
        </span>
        <span className="font-mono text-[10px] text-ink-muted">
          {automation.schedule} · hold {automation.hold_days}d · min {usd(automation.platform_min_cents)}
        </span>
        <button disabled={busy} onClick={toggleAutomation}
                className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] hover:border-brand disabled:opacity-40 transition"
                data-testid="autopayout-toggle-btn">
          {automation.admin_flag ? "Pause" : "Arm"}
        </button>
        <button disabled={busy} onClick={() => runEngineNow(true)}
                className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] hover:border-brand disabled:opacity-40 transition"
                data-testid="autopayout-dryrun-btn">
          Dry run now
        </button>
        {engine?.last_report && (
          <span className="font-mono text-[10px] text-ink-muted" data-testid="autopayout-last-report">
            last cycle: {new Date(engine.last_report.at).toLocaleString()} ·{" "}
            {(engine.last_report.dispatched || []).length} paid · {(engine.last_report.skipped || []).length} skipped
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          disabled={busy || selected.size === 0}
          onClick={() => dryRun([...selected])}
          className="border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] hover:border-brand disabled:opacity-40 transition"
          data-testid="pp-pay-selected"
        >
          Pay Selected ({selected.size})
        </button>
        <button
          disabled={busy || eligible.length === 0}
          onClick={() => dryRun([])}
          className="border border-brand text-brand px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] hover:bg-brand hover:text-paper disabled:opacity-40 transition"
          data-testid="pp-pay-all"
        >
          Pay All Eligible ({eligible.length})
        </button>
        <span className="font-mono text-[10px] text-ink-muted">
          Every run shows a dry-run preview before anything is sent.
        </span>
        {data?.environment === "sandbox" && (
          <button
            disabled={busy}
            onClick={() => setTestDlg({
              email: "", result: null,
              request_id: `tp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            })}
            className="border border-amber-400/60 text-amber-600 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] hover:bg-amber-400/10 disabled:opacity-40 transition"
            data-testid="pp-test-payout-btn"
          >
            ⚗ Test payout ($0.01)
          </button>
        )}
      </div>

      <div className="overflow-x-auto border border-line">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-ink-muted uppercase tracking-[0.16em] text-[10px] border-b border-line">
              <th className="px-2 py-2" />
              <th className="text-left px-2 py-2">Maker</th>
              <th className="text-left px-2 py-2">PayPal email</th>
              <th className="text-right px-2 py-2">Available</th>
              <th className="text-right px-2 py-2">Pending</th>
              <th className="text-left px-2 py-2">Method</th>
              <th className="text-left px-2 py-2">Next payout</th>
              <th className="text-right px-2 py-2">Processing</th>
              <th className="text-right px-2 py-2">Lifetime paid</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {makers.length === 0 && (
              <tr><td colSpan={10} className="text-center py-8 text-ink-muted">
                No PayPal maker balances yet{loading ? "…" : "."}
              </td></tr>
            )}
            {makers.map((m) => {
              const canPay = m.eligible_cents > 0 && m.paypal_email && !m.payouts_on_hold;
              const pendingCents = (m.waiting_hold_cents || 0) + (m.missing_email_cents || 0)
                + (m.disputed_cents || 0) + (m.refund_hold_cents || 0);
              const badge = m.paypal_email ? (canPay ? "ready" : null) : "deferred";
              return (
                <tr key={m.maker_slug} className="border-t border-line" data-testid={`payout-maker-${m.maker_slug}`}>
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(m.maker_slug)}
                      disabled={!canPay}
                      onChange={() => toggle(m.maker_slug)}
                      data-testid={`payout-select-${m.maker_slug}`}
                    />
                  </td>
                  <td className="px-2 py-2">{m.maker_name}</td>
                  <td className="px-2 py-2">
                    {m.paypal_email || <span className="text-amber-500">— missing</span>}
                    {badge && (
                      <span className={`ml-2 border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${STATUS_BADGE[badge]}`}>
                        {badge === "ready" ? "🟢 ready" : "🟡 deferred"}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-green-600" data-testid={`payout-available-${m.maker_slug}`}>
                    {usd(m.eligible_cents)}
                    {m.waiting_minimum && (
                      <span className="ml-1 text-amber-500 text-[9px] uppercase" data-testid={`payout-waitmin-${m.maker_slug}`}>· min</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-amber-500" data-testid={`payout-pending-${m.maker_slug}`}>{usd(pendingCents)}</td>
                  <td className="px-2 py-2 uppercase" data-testid={`payout-method-${m.maker_slug}`}>{m.payout_method || "paypal"}</td>
                  <td className="px-2 py-2 whitespace-nowrap" data-testid={`payout-next-${m.maker_slug}`}>
                    {m.payout_frequency === "manual" ? "manual" : m.next_payout_date || "—"}
                  </td>
                  <td className="px-2 py-2 text-right text-sky-600">{usd(m.processing_cents)}</td>
                  <td className="px-2 py-2 text-right">{usd(m.paid_cents)}</td>
                  <td className="px-2 py-2">
                    <button
                      disabled={busy || !canPay}
                      onClick={() => dryRun([m.maker_slug])}
                      className="border border-line px-2 py-1 text-[10px] uppercase tracking-[0.14em] hover:border-brand disabled:opacity-30 transition"
                      data-testid={`payout-pay-now-${m.maker_slug}`}
                    >
                      Pay now
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted mb-2">
          ◆ Payout runs
        </div>
        {runs.length === 0 ? (
          <p className="font-mono text-[11px] text-ink-muted">No payout batches yet.</p>
        ) : (
          <div className="border border-line divide-y divide-line">
            {runs.map((r) => (
              <div key={r.id} className="p-3 flex flex-wrap items-center gap-3 font-mono text-[11px]" data-testid={`payout-run-${r.id}`}>
                <span className="text-ink">{new Date(r.created_at).toLocaleString()}</span>
                {r.kind === "test" && (
                  <span className="border border-amber-400/60 text-amber-600 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em]"
                        data-testid={`payout-run-test-badge-${r.id}`}>
                    ⚗ TEST
                  </span>
                )}
                <span className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${
                  r.status === "submitted" ? "text-green-600 border-green-500/40" : "text-red-400 border-red-400/40"}`}>
                  {r.batch_status || r.status}
                </span>
                {r.kind === "test" ? (
                  <>
                    <span className="text-ink-muted">→ {r.recipient_email}</span>
                    <span className="text-brand font-display text-base">$0.01</span>
                    <span className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${
                      r.test_item_status === "paid" ? "text-green-600 border-green-500/40"
                        : r.test_item_status === "failed" ? "text-red-400 border-red-400/40"
                          : "text-sky-600 border-sky-500/40"}`}
                          data-testid={`payout-run-test-status-${r.id}`}>
                      item: {r.test_item_status || "submitted"}
                    </span>
                    {(r.webhook_updates || []).slice(-1).map((w, i) => (
                      <span key={i} className="text-ink-muted">last webhook: {w.event_type}</span>
                    ))}
                  </>
                ) : (
                  <>
                    <span className="text-ink-muted">{r.maker_count} maker(s)</span>
                    <span className="text-brand font-display text-base">{usd(r.total_cents)}</span>
                  </>
                )}
                <span className="text-ink-muted truncate">batch {r.payout_batch_id || "—"} · run {r.id}</span>
                <span className="text-ink-muted">by {r.created_by}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="payout-preview-modal">
          <div className="bg-paper border border-line p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Confirm payout batch</div>
              <button onClick={() => setPreview(null)} data-testid="payout-preview-close" aria-label="Close"><X size={16} /></button>
            </div>
            <p className="font-mono text-xs text-ink mb-3">
              You are about to pay <strong>{preview.makers} maker(s)</strong> a total of{" "}
              <strong className="text-brand">{usd(preview.total_cents)}</strong> via PayPal ({data?.environment}).
            </p>
            <ul className="border border-line divide-y divide-line mb-4 max-h-56 overflow-y-auto">
              {(preview.items || []).map((i) => (
                <li key={i.maker_slug} className="p-2 flex justify-between font-mono text-[11px]">
                  <span>{i.maker_name} <span className="text-ink-muted">→ {i.paypal_email}</span></span>
                  <span className="text-brand">{usd(i.amount_cents)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPreview(null)} className="border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]" data-testid="payout-cancel-btn">
                Cancel
              </button>
              <button onClick={execute} disabled={busy}
                      className="border border-brand text-brand px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] hover:bg-brand hover:text-paper disabled:opacity-50 transition"
                      data-testid="payout-confirm-btn">
                {busy ? "Sending…" : `Send ${usd(preview.total_cents)} →`}
              </button>
            </div>
          </div>
        </div>
      )}
      {testDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="test-payout-modal">
          <div className="bg-paper border border-line p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-600">⚗ Sandbox test payout</div>
              <button onClick={() => setTestDlg(null)} data-testid="test-payout-close" aria-label="Close"><X size={16} /></button>
            </div>
            {!testDlg.result ? (
              <>
                <p className="font-mono text-xs text-ink mb-3">
                  Sends exactly <strong className="text-brand">$0.01 USD</strong> to a PayPal
                  <strong> sandbox</strong> account. Never touches maker balances or reporting.
                </p>
                <input
                  type="email"
                  value={testDlg.email}
                  onChange={(e) => setTestDlg((s) => ({ ...s, email: e.target.value }))}
                  placeholder="sb-xxxxx@personal.example.com"
                  className="border border-line bg-paper px-3 py-2 font-mono text-xs w-full mb-3"
                  data-testid="test-payout-email-input"
                />
                {testDlg.email.trim() && (
                  <p className="font-mono text-[11px] text-ink-muted mb-3" data-testid="test-payout-confirm-text">
                    Confirm: pay <strong className="text-brand">$0.01</strong> to{" "}
                    <strong className="text-ink">{testDlg.email.trim()}</strong> (sandbox).
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setTestDlg(null)} className="border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                    Cancel
                  </button>
                  <button
                    onClick={sendTestPayout}
                    disabled={busy || !testDlg.email.trim()}
                    className="border border-amber-400/60 text-amber-600 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] hover:bg-amber-400/10 disabled:opacity-50 transition"
                    data-testid="test-payout-confirm-btn"
                  >
                    {busy ? "Sending…" : "Send $0.01 test →"}
                  </button>
                </div>
              </>
            ) : (
              <div data-testid="test-payout-result">
                <pre className="text-[10px] leading-relaxed border border-line p-3 mb-4 overflow-x-auto whitespace-pre-wrap break-all bg-black/5">
                  {JSON.stringify(testDlg.result, null, 2)}
                </pre>
                <p className="font-mono text-[11px] text-ink-muted mb-3">
                  Watch the run below — the payout webhook will flip the item from
                  “submitted” to “paid” (or “failed”) within a minute.
                </p>
                <div className="flex justify-end">
                  <button onClick={() => { setTestDlg(null); load(); }}
                          className="border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
                          data-testid="test-payout-done-btn">
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
