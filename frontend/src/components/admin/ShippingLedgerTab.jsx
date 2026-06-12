import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Download, Play, Truck, Search } from "lucide-react";
import {
  adminFetchShippingLedger, adminFetchShippingRollup,
  adminMarkShippingBilled, adminRunShippingInvoices,
  adminShippingLedgerCsvUrl,
} from "../../lib/api";
import { useConfirm } from "../../hooks/useConfirm";
import { RowsSkeleton } from "../Skeleton";

/**
 * Admin Shipping Ledger (Phase 2D).
 * -----------------------------------
 * Per-maker rollup card (unbilled pile first) + full searchable ledger
 * table. Actions:
 *   • Dry-run + real-run the weekly invoice job on demand
 *   • Filter by maker, billed status, tracking number
 *   • CSV export (billed / unbilled / all) for accounting
 *   • Manual mark-billed when a maker pays via wire / cheque
 */
export default function ShippingLedgerTab() {
  const token = localStorage.getItem("cm_admin_jwt");
  const [rollup, setRollup] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ maker_slug: "", billed: "", tracking: "" });
  const [running, setRunning] = useState(false);
  const [markOpen, setMarkOpen] = useState(null); // ledger row being marked
  const [confirm, confirmModal] = useConfirm();

  const load = async () => {
    setLoading(true);
    try {
      const [r, l] = await Promise.all([
        adminFetchShippingRollup(token),
        adminFetchShippingLedger(token, _cleanFilters(filters)),
      ]);
      setRollup(r);
      setRows(l.rows || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load shipping ledger.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runInvoices = async (dryRun) => {
    if (!dryRun) {
      const ok = await confirm({
        title: "Invoice makers now?",
        body: "This will create REAL Stripe invoices and charge makers for their unbilled shipping labels. Run a dry-run first if you're unsure.",
        confirmLabel: "Charge makers",
        tone: "danger",
        testId: "confirm-invoice-run",
      });
      if (!ok) return;
    }
    setRunning(true);
    try {
      const r = await adminRunShippingInvoices(token, dryRun);
      toast.success(
        `${dryRun ? "Dry run" : "Invoiced"} · ${r.invoiced_makers} maker${r.invoiced_makers === 1 ? "" : "s"} · $${(r.invoiced_cents / 100).toFixed(2)}`,
        { duration: 6000 },
      );
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Invoice run failed.");
    } finally {
      setRunning(false);
    }
  };

  const downloadCsv = async () => {
    try {
      const url = adminShippingLedgerCsvUrl(token, _cleanFilters(filters));
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const dl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dl;
      a.download = `shipping-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(dl);
    } catch (e) {
      toast.error("CSV export failed.");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-shipping-ledger">
      {confirmModal}
      {/* Header + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-1">
            ◆ Shipping Ledger
          </div>
          <h2 className="font-display text-3xl text-ink">
            <Truck className="inline mr-2 mb-1" size={28} /> Shipping Ledger
          </h2>
          <p className="font-mono text-xs text-ink-muted mt-1">
            Platform-paid labels · roll up into weekly Stripe invoices per maker.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => runInvoices(true)}
            disabled={running}
            className="btn-industrial inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="admin-shipping-dry-run"
          >
            <Play size={13} /> Dry run
          </button>
          <button
            onClick={() => runInvoices(false)}
            disabled={running}
            className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="admin-shipping-run-invoices"
          >
            <Play size={13} /> Invoice now
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="btn-industrial inline-flex items-center gap-2"
            data-testid="admin-shipping-refresh"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            onClick={downloadCsv}
            className="btn-industrial inline-flex items-center gap-2"
            data-testid="admin-shipping-csv"
          >
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {/* Rollup cards — top 5 unbilled makers */}
      {rollup && (
        <div
          className="border border-brand/30 bg-brand/5 p-5"
          data-testid="admin-shipping-rollup"
        >
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
              Total unbilled across all makers
            </div>
            <div className="font-display text-4xl text-brand">
              ${(rollup.total_unbilled_cents / 100).toFixed(2)}
            </div>
          </div>
          {rollup.makers?.length > 0 ? (
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="text-ink-muted uppercase tracking-[0.22em] text-[10px] border-b border-line">
                  <th className="text-left py-2">Maker</th>
                  <th className="text-right">Unbilled</th>
                  <th className="text-right"># labels</th>
                  <th className="text-right">Billed lifetime</th>
                </tr>
              </thead>
              <tbody>
                {rollup.makers.slice(0, 10).map((m) => (
                  <tr key={m.maker_slug} className="border-b border-line last:border-b-0 text-ink">
                    <td className="py-2">
                      <button
                        onClick={() => setFilters({ ...filters, maker_slug: m.maker_slug })}
                        className="underline hover:text-brand"
                      >
                        {m.maker_slug}
                      </button>
                    </td>
                    <td className="text-right text-brand">${(m.unbilled_cents / 100).toFixed(2)}</td>
                    <td className="text-right text-ink-muted">{m.unbilled_count}</td>
                    <td className="text-right text-ink-muted">${(m.billed_cents / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div
              className="border border-line bg-paper p-6 text-center"
              data-testid="admin-shipping-summary-empty"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted mb-2">◇ No shipping activity</div>
              <p className="font-mono text-[11px] text-ink-muted leading-relaxed max-w-[42ch] mx-auto">
                Once makers buy a shipping label through the platform, their unbilled balances and reimbursement history will surface here.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <form
        onSubmit={(e) => { e.preventDefault(); load(); }}
        className="grid md:grid-cols-4 gap-2"
        data-testid="admin-shipping-filters"
      >
        <input
          type="text"
          placeholder="Maker slug"
          value={filters.maker_slug}
          onChange={(e) => setFilters({ ...filters, maker_slug: e.target.value })}
          className="bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
          data-testid="admin-shipping-filter-maker"
        />
        <input
          type="text"
          placeholder="Tracking #"
          value={filters.tracking}
          onChange={(e) => setFilters({ ...filters, tracking: e.target.value })}
          className="bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
          data-testid="admin-shipping-filter-tracking"
        />
        <select
          value={filters.billed}
          onChange={(e) => setFilters({ ...filters, billed: e.target.value })}
          className="bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
          data-testid="admin-shipping-filter-billed"
        >
          <option value="">All</option>
          <option value="no">Unbilled only</option>
          <option value="yes">Billed only</option>
        </select>
        <button
          type="submit"
          className="btn-industrial inline-flex items-center justify-center gap-2"
          data-testid="admin-shipping-filter-apply"
        >
          <Search size={13} /> Apply
        </button>
      </form>

      {/* Ledger table */}
      <div className="border border-line" data-testid="admin-shipping-rows">
        <div className="hidden md:grid grid-cols-[1fr_1.2fr_1fr_1.2fr_100px_110px_120px] gap-2 px-4 py-2 border-b border-line font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted bg-paper">
          <span>Date</span>
          <span>Maker</span>
          <span>Carrier</span>
          <span>Tracking</span>
          <span className="text-right">Amount</span>
          <span>Status</span>
          <span>Actions</span>
        </div>
        {loading && <div data-testid="shipping-ledger-loading" className="p-3"><RowsSkeleton count={5} /></div>}
        {!loading && rows.length === 0 && (
          <div className="p-5 font-mono text-xs text-ink-muted">No rows match.</div>
        )}
        {!loading && rows.map((r) => (
          <div
            key={r.id}
            className="grid md:grid-cols-[1fr_1.2fr_1fr_1.2fr_100px_110px_120px] gap-2 px-4 py-3 border-b border-line last:border-b-0 font-mono text-xs text-ink items-center"
            data-testid={`admin-shipping-row-${r.id}`}
          >
            <span className="text-ink-muted">{new Date(r.created_at).toLocaleDateString()}</span>
            <span className="truncate">{r.maker_slug}</span>
            <span className="truncate">
              <span className="text-brand">{r.provider}</span>
              <span className="text-ink-muted"> · </span>
              {r.servicelevel_name}
            </span>
            <span className="truncate">
              {r.tracking_url_provider ? (
                <a href={r.tracking_url_provider} target="_blank" rel="noopener noreferrer"
                   className="underline hover:text-brand">{r.tracking_number}</a>
              ) : r.tracking_number}
            </span>
            <span className="text-right">${((r.billed_cents || 0) / 100).toFixed(2)}</span>
            <span>
              {r.billed_at ? (
                <span className="px-1.5 py-0.5 border border-emerald-400/40 text-emerald-700 text-[9px] uppercase tracking-[0.18em]">
                  Billed
                </span>
              ) : (
                <span className="px-1.5 py-0.5 border border-yellow-400/40 text-brand text-[9px] uppercase tracking-[0.18em]">
                  Unbilled
                </span>
              )}
            </span>
            <span>
              {!r.billed_at && (
                <button
                  onClick={() => setMarkOpen(r)}
                  className="text-brand hover:underline"
                  data-testid={`admin-shipping-mark-billed-${r.id}`}
                >
                  Mark billed →
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {markOpen && (
        <MarkBilledModal
          row={markOpen}
          onClose={() => setMarkOpen(null)}
          onSaved={async () => { setMarkOpen(null); await load(); }}
          token={token}
        />
      )}
    </div>
  );
}

function MarkBilledModal({ row, onClose, onSaved, token }) {
  const [invoiceId, setInvoiceId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!invoiceId.trim()) {
      toast.error("Invoice ID is required (use 'manual' for offline payments).");
      return;
    }
    setSaving(true);
    try {
      await adminMarkShippingBilled(token, row.id, { invoice_id: invoiceId.trim(), note });
      toast.success("Row marked as billed.");
      await onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't mark as billed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-paper/80 backdrop-blur-sm flex items-center justify-center px-3"
         onClick={onClose}>
      <div className="w-full max-w-md bg-paper border border-brand p-5 space-y-3"
           onClick={(e) => e.stopPropagation()}>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
          ◆ Mark billed · {row.tracking_number}
        </div>
        <p className="font-mono text-xs text-ink-muted leading-relaxed">
          Use this when a maker paid via wire / cheque / offline. For auto-billing,
          the weekly invoice job handles it automatically.
        </p>
        <input
          type="text"
          placeholder="Stripe invoice ID (or 'manual')"
          value={invoiceId}
          onChange={(e) => setInvoiceId(e.target.value)}
          className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
          data-testid="admin-mark-billed-invoice"
        />
        <textarea
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
          data-testid="admin-mark-billed-note"
        />
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-industrial">Cancel</button>
          <button onClick={submit} disabled={saving}
                  className="btn-industrial btn-primary disabled:opacity-50"
                  data-testid="admin-mark-billed-submit">
            {saving ? "Saving…" : "Mark billed"}
          </button>
        </div>
      </div>
    </div>
  );
}

function _cleanFilters(f) {
  const out = {};
  for (const k of ["maker_slug", "billed", "tracking"]) {
    const v = (f[k] || "").trim();
    if (v) out[k] = v;
  }
  return out;
}
