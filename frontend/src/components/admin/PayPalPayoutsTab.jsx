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
  const [selected, setSelected] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        fetch(`${API}/api/admin/paypal/payouts/summary`, { headers: _auth() }).then((x) => x.json()),
        fetch(`${API}/api/admin/paypal/payouts/runs`, { headers: _auth() }).then((x) => x.json()),
      ]);
      setData(s); setRuns(r.runs || []);
    } catch (e) { toast.error(`Load failed: ${e.message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const makers = data?.makers || [];
  const totals = data?.totals || {};
  const eligible = makers.filter((m) => m.available_cents > 0 && m.paypal_email);

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

  const cards = [
    ["Available", totals.available_cents, "text-green-600"],
    ["Missing PayPal email", totals.missing_email_cents, "text-amber-500"],
    ["On hold (refund/dispute)", totals.hold_cents, "text-red-400"],
    ["Processing", totals.processing_cents, "text-sky-600"],
    ["Lifetime paid", totals.paid_cents, "text-ink"],
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

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {cards.map(([label, val, cls]) => (
          <div key={label} className="border border-line p-3" data-testid={`payouts-card-${label}`}>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">{label}</div>
            <div className={`font-display text-2xl mt-1 ${cls}`}>{usd(val)}</div>
          </div>
        ))}
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
      </div>

      <div className="overflow-x-auto border border-line">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-ink-muted uppercase tracking-[0.16em] text-[10px] border-b border-line">
              <th className="px-2 py-2" />
              <th className="text-left px-2 py-2">Maker</th>
              <th className="text-left px-2 py-2">PayPal email</th>
              <th className="text-right px-2 py-2">Available</th>
              <th className="text-right px-2 py-2">Missing email</th>
              <th className="text-right px-2 py-2">On hold</th>
              <th className="text-right px-2 py-2">Processing</th>
              <th className="text-right px-2 py-2">Lifetime paid</th>
              <th className="text-left px-2 py-2">Last payout</th>
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
              const badge = m.paypal_email
                ? (m.available_cents > 0 ? "ready" : null)
                : "deferred";
              return (
                <tr key={m.maker_slug} className="border-t border-line" data-testid={`payout-maker-${m.maker_slug}`}>
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(m.maker_slug)}
                      disabled={!(m.available_cents > 0 && m.paypal_email)}
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
                  <td className="px-2 py-2 text-right text-green-600">{usd(m.available_cents)}</td>
                  <td className="px-2 py-2 text-right text-amber-500">{usd(m.missing_email_cents)}</td>
                  <td className="px-2 py-2 text-right text-red-400">{usd(m.hold_cents)}</td>
                  <td className="px-2 py-2 text-right text-sky-600">{usd(m.processing_cents)}</td>
                  <td className="px-2 py-2 text-right">{usd(m.paid_cents)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {m.last_payout_at ? new Date(m.last_payout_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      disabled={busy || !(m.available_cents > 0 && m.paypal_email)}
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
                <span className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${
                  r.status === "submitted" ? "text-green-600 border-green-500/40" : "text-red-400 border-red-400/40"}`}>
                  {r.batch_status || r.status}
                </span>
                <span className="text-ink-muted">{r.maker_count} maker(s)</span>
                <span className="text-brand font-display text-base">{usd(r.total_cents)}</span>
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
    </div>
  );
}
