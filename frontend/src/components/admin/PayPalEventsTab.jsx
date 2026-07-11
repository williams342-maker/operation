/**
 * iter437 — Admin → PayPal Events (read-only viewer).
 * Summary cards, env/type/status filters, ID search, paginated table,
 * detail drawer with sanitized payload. No reprocessing actions by design.
 */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { X, RefreshCw } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;
const _auth = () => {
  const t = localStorage.getItem("cm_admin_jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const badge = (v) => {
  const map = {
    SUCCESS: "text-green-500 border-green-500/40",
    FAILURE: "text-red-400 border-red-400/40",
    ERROR: "text-amber-400 border-amber-400/40",
  };
  return `inline-block border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.14em] ${map[v] || "text-ink-muted border-line"}`;
};

export default function PayPalEventsTab() {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [eventTypes, setEventTypes] = useState([]);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [filters, setFilters] = useState({ environment: "", event_type: "", verification_status: "", processing_result: "", q: "", date_from: "", date_to: "" });
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), page_size: String(pageSize) });
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
      const [ev, sm] = await Promise.all([
        fetch(`${API}/api/admin/paypal/events?${params}`, { headers: _auth() }).then(r => r.json()),
        fetch(`${API}/api/admin/paypal/events/summary`, { headers: _auth() }).then(r => r.json()),
      ]);
      setRows(ev.events || []); setTotal(ev.total || 0); setEventTypes(ev.event_types || []);
      setSummary(sm);
    } catch (e) { toast.error(`Load failed: ${e.message}`); }
    finally { setLoading(false); }
  }, [filters, page]);

  useEffect(() => { load(1); setPage(1); /* eslint-disable-next-line */ }, [filters]);

  async function openDetail(eventId) {
    try {
      const r = await fetch(`${API}/api/admin/paypal/events/${encodeURIComponent(eventId)}`, { headers: _auth() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setDetail(d);
    } catch (e) { toast.error(e.message); }
  }

  const setF = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const sel = "border border-line bg-paper px-2 py-1.5 font-mono text-[11px]";
  const s24 = summary?.last_24h || {};
  const health = summary?.health;

  const cards = [
    ["Received (24h)", s24.received, ""],
    ["Verified", s24.verified, "text-green-500"],
    ["Verify failures", s24.verification_failures, "text-red-400"],
    ["Processing failures", s24.processing_failures, "text-amber-400"],
    ["Duplicates", s24.duplicates, "text-ink-muted"],
  ];

  return (
    <div className="space-y-6" data-testid="paypal-events-tab">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ PayPal Events · read-only</div>
        {health && (
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]" data-testid="paypal-health">
            <span className="text-ink-muted">Env: <strong className="text-ink">{health.environment}</strong></span>
            {["client_id", "client_secret", "webhook_id"].map((k) => (
              <span key={k} className={`border px-1.5 py-0.5 ${health[k] === "Configured" ? "text-green-500 border-green-500/40" : "text-red-400 border-red-400/40"}`}>
                {k.replace("_", " ")}: {health[k]}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {cards.map(([label, val, cls]) => (
          <div key={label} className="border border-line p-3" data-testid={`pp-card-${label}`}>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">{label}</div>
            <div className={`font-display text-2xl mt-1 ${cls}`}>{val ?? "—"}</div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-ink-muted border border-line border-dashed p-3 leading-relaxed" data-testid="pp-simulator-note">
        PayPal Webhook Simulator events may fail verification because simulator messages use the
        simulator webhook identifier rather than the application&apos;s configured webhook ID. Use a
        real sandbox checkout for the final verified end-to-end test.
      </p>

      <div className="flex flex-wrap gap-2 items-end">
        <select value={filters.environment} onChange={setF("environment")} className={sel} data-testid="pp-filter-env">
          <option value="">All environments</option><option value="sandbox">Sandbox</option><option value="live">Live</option>
        </select>
        <select value={filters.event_type} onChange={setF("event_type")} className={sel} data-testid="pp-filter-type">
          <option value="">All event types</option>
          {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filters.verification_status} onChange={setF("verification_status")} className={sel} data-testid="pp-filter-verify">
          <option value="">All verification</option><option value="SUCCESS">Success</option><option value="FAILURE">Failure</option><option value="ERROR">Error</option>
        </select>
        <select value={filters.processing_result} onChange={setF("processing_result")} className={sel} data-testid="pp-filter-processing">
          <option value="">All processing</option><option value="recorded">Recorded</option><option value="rejected_unverified">Rejected (unverified)</option><option value="error">Processing error</option>
        </select>
        <input type="date" value={filters.date_from} onChange={setF("date_from")} className={sel} data-testid="pp-filter-from" />
        <input type="date" value={filters.date_to} onChange={setF("date_to")} className={sel} data-testid="pp-filter-to" />
        <input value={filters.q} onChange={setF("q")} placeholder="Search event / order / resource / invoice ID"
               className={`${sel} w-72`} data-testid="pp-search" />
        <button onClick={() => load(page)} className="border border-line px-2 py-1.5 hover:border-brand transition" title="Refresh" data-testid="pp-refresh">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="overflow-x-auto border border-line">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-ink-muted uppercase tracking-[0.16em] text-[10px] border-b border-line">
              <th className="text-left px-2 py-2">Received</th>
              <th className="text-left px-2 py-2">Env</th>
              <th className="text-left px-2 py-2">Event type</th>
              <th className="text-left px-2 py-2">Event ID</th>
              <th className="text-left px-2 py-2">Resource ID</th>
              <th className="text-left px-2 py-2">Order ID</th>
              <th className="text-left px-2 py-2">Verify</th>
              <th className="text-left px-2 py-2">Processing</th>
              <th className="text-left px-2 py-2">HTTP outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="text-center py-8 text-ink-muted">No PayPal events{loading ? "…" : " match these filters."}</td></tr>
            )}
            {rows.map((e) => (
              <tr key={e.event_id} onClick={() => openDetail(e.event_id)}
                  className="border-t border-line hover:bg-brand/5 cursor-pointer" data-testid={`pp-row-${e.event_id}`}>
                <td className="px-2 py-2 whitespace-nowrap">{e.received_at ? new Date(e.received_at).toLocaleString() : "—"}</td>
                <td className="px-2 py-2 uppercase">{e.environment}</td>
                <td className="px-2 py-2">{e.event_type || "—"}</td>
                <td className="px-2 py-2 max-w-[180px] truncate" title={e.event_id}>{e.event_id}</td>
                <td className="px-2 py-2">{e.resource_id || "—"}</td>
                <td className="px-2 py-2">{e.order_id || "—"}</td>
                <td className="px-2 py-2"><span className={badge(e.verification_status)}>{e.verification_status}</span></td>
                <td className="px-2 py-2">{e.processing_result || "—"}</td>
                <td className="px-2 py-2">{e.http_outcome || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between font-mono text-[11px] text-ink-muted">
        <span data-testid="pp-total">{total} event{total === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => { setPage(page - 1); load(page - 1); }}
                  className="border border-line px-2 py-1 disabled:opacity-30" data-testid="pp-prev">‹ Prev</button>
          <span>Page {page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => { setPage(page + 1); load(page + 1); }}
                  className="border border-line px-2 py-1 disabled:opacity-30" data-testid="pp-next">Next ›</button>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setDetail(null)} data-testid="pp-detail-drawer">
          <div className="w-full max-w-xl h-full bg-paper border-l border-line overflow-y-auto p-6"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Event Detail</div>
              <button onClick={() => setDetail(null)} data-testid="pp-detail-close" aria-label="Close"><X size={16} /></button>
            </div>
            <table className="w-full text-xs font-mono mb-5">
              <tbody>
                {[
                  ["Event ID", detail.event_id],
                  ["Event type", detail.event_type],
                  ["Created (PayPal)", detail.event_time],
                  ["Received", detail.received_at],
                  ["Environment", detail.environment],
                  ["Verification", detail.verification_status],
                  ["Processing result", detail.processing_result],
                  ["HTTP outcome / rejection", detail.http_outcome],
                  ["Order ID", detail.order_id],
                  ["Capture ID", detail.capture_id],
                  ["Authorization ID", detail.authorization_id],
                  ["Invoice ID", detail.invoice_id],
                  ["Custom ID", detail.custom_id],
                  ["Amount", detail.amount ? `${detail.amount} ${detail.currency || ""}` : null],
                  ["Duplicate deliveries", detail.duplicate_count],
                ].map(([k, v]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1.5 pr-3 text-ink-muted uppercase text-[10px] tracking-[0.16em] whitespace-nowrap">{k}</td>
                    <td className="py-1.5 break-all">{v ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.verify_debug && Object.keys(detail.verify_debug).length > 0 && (
              <>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted mb-2">Verify debug</div>
                <pre className="text-[10px] leading-relaxed border border-amber-400/40 p-3 mb-5 overflow-x-auto whitespace-pre-wrap break-all bg-black/5"
                     data-testid="pp-detail-verify-debug">
                  {JSON.stringify(detail.verify_debug, null, 2)}
                </pre>
              </>
            )}
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted mb-2">Sanitized payload</div>
            <pre className="text-[10px] leading-relaxed border border-line p-3 overflow-x-auto whitespace-pre-wrap break-all bg-black/5"
                 data-testid="pp-detail-payload">
              {JSON.stringify(detail.payload ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
