/**
 * iter445 — Admin → Finance → Ledger & Reconciliation.
 * Provider balances vs Marketplace Ledger vs operational maker balances,
 * with a single balanced/difference indicator + the raw journal.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;
const _auth = () => {
  const t = localStorage.getItem("cm_admin_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
const usd = (c) => (c === null || c === undefined ? "—" : `$${(c / 100).toFixed(2)}`);

const KIND_BADGE = {
  sale: "text-green-600 border-green-500/40",
  refund: "text-red-400 border-red-400/40",
  payout: "text-sky-600 border-sky-500/40",
  payout_reversal: "text-amber-500 border-amber-400/40",
};

export default function MarketplaceLedgerTab() {
  const [recon, setRecon] = useState(null);
  const [entries, setEntries] = useState([]);
  const [provider, setProvider] = useState("");
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (provider) qs.set("provider", provider);
      if (kind) qs.set("kind", kind);
      const [r, l] = await Promise.all([
        fetch(`${API}/api/admin/finance/reconciliation`, { headers: _auth() }).then((x) => x.json()),
        fetch(`${API}/api/admin/ledger?${qs}`, { headers: _auth() }).then((x) => x.json()),
      ]);
      setRecon(r); setEntries(l.entries || []);
    } catch (e) { toast.error(`Load failed: ${e.message}`); }
    finally { setLoading(false); }
  }, [provider, kind]);
  useEffect(() => { load(); }, [load]);

  const cards = recon ? [
    ["Stripe balance", recon.stripe_balance_cents, "text-ink"],
    ["PayPal balance", recon.paypal_balance_cents, "text-ink"],
    ["Ledger balance", recon.ledger?.outstanding_cents, "text-brand"],
    ["Outstanding maker balances", recon.maker_outstanding_cents, "text-green-600"],
    ["Pending payouts", recon.pending_payouts_cents, "text-sky-600"],
    ["Paid today", recon.paid_today_cents, "text-ink"],
    ["Refunds", recon.refunds_cents, "text-red-400"],
    ["Disputes", recon.disputes_cents, "text-red-400"],
  ] : [];

  return (
    <div className="space-y-6" data-testid="ledger-recon-tab">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
          ◆ Marketplace Ledger · reconciliation
        </div>
        <button onClick={load} className="border border-line px-2 py-1.5 hover:border-brand transition" title="Refresh" data-testid="ledger-refresh">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {recon && (
        <div
          className={`border p-3 flex items-center gap-3 font-mono text-xs ${
            recon.balanced ? "border-green-500/40 text-green-600" : "border-amber-400/60 text-amber-600"}`}
          data-testid="recon-status-banner"
        >
          {recon.balanced
            ? "✔ Ledger Balanced — journal matches outstanding maker balances."
            : `⚠ Difference: $${(Math.abs(recon.diff_cents) / 100).toFixed(2)} — ledger says ${usd(recon.ledger?.outstanding_cents)} outstanding, books say ${usd(recon.maker_outstanding_cents)}.`}
          <span className="text-ink-muted ml-auto">checked {new Date(recon.checked_at).toLocaleTimeString()}</span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map(([label, val, cls]) => (
          <div key={label} className="border border-line p-3" data-testid={`recon-card-${label}`}>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">{label}</div>
            <div className={`font-display text-2xl mt-1 ${cls}`}>{usd(val)}</div>
            {val === null && <div className="font-mono text-[9px] text-ink-muted mt-1">API unavailable</div>}
          </div>
        ))}
      </div>

      {/* iter448 — payout status flags from the payout-status webhook */}
      {recon?.payout_flags && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="recon-payout-flags">
          {[
            ["Unclaimed payouts", recon.payout_flags.unclaimed, true],
            ["Returned payouts", recon.payout_flags.returned, false],
            ["Refunded payouts", recon.payout_flags.refunded, false],
            ["Canceled payouts", recon.payout_flags.canceled, false],
          ].map(([label, f, warn]) => (
            <div key={label}
                 className={`border p-3 ${warn && f?.count ? "border-amber-400/60 bg-amber-400/5" : "border-line"}`}
                 data-testid={`recon-flag-${label}`}>
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
                {warn && f?.count ? "⚠ " : ""}{label}
              </div>
              <div className={`font-display text-2xl mt-1 ${
                f?.count ? (warn ? "text-amber-500" : "text-ink") : "text-ink-muted"}`}>
                {f?.count ?? 0}
              </div>
              <div className="font-mono text-[9px] text-ink-muted mt-0.5">
                {usd(f?.cents)}{warn && f?.count ? " in limbo at PayPal — recoverable" : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
        <span className="text-ink-muted">Filter:</span>
        {["", "stripe", "paypal"].map((p) => (
          <button key={p || "all"} onClick={() => setProvider(p)}
                  className={`border px-2 py-1 transition ${provider === p ? "border-brand text-brand" : "border-line hover:border-brand"}`}
                  data-testid={`ledger-filter-provider-${p || "all"}`}>
            {p || "all providers"}
          </button>
        ))}
        <span className="text-ink-muted ml-2">·</span>
        {["", "sale", "refund", "payout", "payout_reversal"].map((k) => (
          <button key={k || "all"} onClick={() => setKind(k)}
                  className={`border px-2 py-1 transition ${kind === k ? "border-brand text-brand" : "border-line hover:border-brand"}`}
                  data-testid={`ledger-filter-kind-${k || "all"}`}>
            {k || "all kinds"}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto border border-line">
        <table className="w-full text-xs font-mono" data-testid="ledger-table">
          <thead>
            <tr className="text-ink-muted uppercase tracking-[0.16em] text-[10px] border-b border-line">
              <th className="text-left px-2 py-2">Date</th>
              <th className="text-left px-2 py-2">Order / ref</th>
              <th className="text-left px-2 py-2">Provider</th>
              <th className="text-left px-2 py-2">Kind</th>
              <th className="text-left px-2 py-2">Maker</th>
              <th className="text-right px-2 py-2">Gross</th>
              <th className="text-right px-2 py-2">Fee</th>
              <th className="text-right px-2 py-2">Commission</th>
              <th className="text-right px-2 py-2">Maker net</th>
              <th className="text-left px-2 py-2">Payout batch</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={10} className="text-center py-8 text-ink-muted" data-testid="ledger-empty">
                No ledger entries yet{loading ? "…" : "."}
              </td></tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-line" data-testid={`ledger-entry-${e.id}`}>
                <td className="px-2 py-2 whitespace-nowrap">{new Date(e.created_at).toLocaleDateString()}</td>
                <td className="px-2 py-2 max-w-[180px] truncate" title={e.session_id}>{e.session_id}</td>
                <td className="px-2 py-2">
                  <span className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${
                    e.provider === "paypal" ? "text-sky-600 border-sky-500/40" : "text-indigo-500 border-indigo-400/40"}`}>
                    {e.provider}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <span className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${KIND_BADGE[e.kind] || ""}`}>
                    {e.kind}
                  </span>
                </td>
                <td className="px-2 py-2">{e.maker_name}</td>
                <td className="px-2 py-2 text-right">{usd(e.gross_cents)}</td>
                <td className="px-2 py-2 text-right">{usd(e.fee_cents)}</td>
                <td className="px-2 py-2 text-right">{usd(e.commission_cents)}</td>
                <td className="px-2 py-2 text-right text-green-600">{usd(e.net_cents)}</td>
                <td className="px-2 py-2 max-w-[140px] truncate" title={e.payout_batch_id || ""}>
                  {e.payout_batch_id || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
