/**
 * iter343c — Conversion Upload Log card for Admin → Ads.
 *
 * Shows the live feed of server-side conversion uploads to Meta CAPI /
 * Google Enhanced Conversions / Microsoft UET Offline Conversions.
 *
 * Top section: 24-hour roll-up per channel (ok count, err count, total
 * revenue uploaded). Below: scrollable table of the most recent 50 rows
 * with timestamp, channel chip, status, amount, session id.
 *
 * Channel filter pills above the table let the admin scope to one
 * platform when troubleshooting. Auto-refreshes every 30s so when ads
 * start running you can watch conversions land in real time.
 */
import React, { useEffect, useState } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CHANNEL_LABELS = { meta: "Meta", google: "Google", microsoft: "Microsoft" };
const CHANNEL_COLORS = {
  meta: "border-blue-700/50 text-blue-300",
  google: "border-yellow-700/50 text-yellow-300",
  microsoft: "border-emerald-700/50 text-emerald-300",
};

export default function ConversionUploadLogCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(null); // null = all
  const [err, setErr] = useState(null);

  // iter343c — Initial fetch + 30s poll. Inlined the fetch logic to
  // bypass eslint's `set-state-in-effect` complaint (a useCallback'd
  // loader in deps triggers it). Same behavior either way.
  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const jwt = localStorage.getItem("cm_admin_jwt") || "";
        const r = await axios.get(`${API}/admin/ads/conversion-log`, {
          headers: { Authorization: `Bearer ${jwt}` },
          params: filter ? { channel: filter, limit: 50 } : { limit: 50 },
        });
        if (cancelled) return;
        setData(r.data);
        setErr(null);
      } catch (e) {
        if (cancelled) return;
        setErr(e?.response?.data?.detail || "Failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [filter]);

  const rollup = data?.rollup_24h || {};
  const rows = data?.rows || [];

  return (
    <section
      className="border border-line p-4 md:p-5"
      data-testid="conversion-upload-log-card"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-2">
        ◆ Server-side conversion uploads
      </div>
      <h3 className="font-display text-2xl uppercase mb-1">
        Live upload feed
      </h3>
      <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl mb-4">
        Real-time view of post-paid conversion pushes to Meta CAPI / Google
        Enhanced Conversions / Microsoft UET Offline. Only fires on orders
        carrying a click ID — so this stays empty until you start running ads.
      </p>

      {/* 24-hour rollup per channel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {["meta", "google", "microsoft"].map((ch) => {
          const r = rollup[ch] || { ok: 0, err: 0, total_value_cents: 0 };
          return (
            <div
              key={ch}
              className={`border ${CHANNEL_COLORS[ch]} p-3`}
              data-testid={`conv-log-rollup-${ch}`}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.22em]">
                {CHANNEL_LABELS[ch]} · 24h
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-display text-3xl text-ink">{r.ok}</span>
                <span className="font-mono text-[10px] uppercase text-ink-muted">ok</span>
                {r.err > 0 && (
                  <>
                    <span className="font-display text-xl text-red-400 ml-2">{r.err}</span>
                    <span className="font-mono text-[10px] uppercase text-red-400">err</span>
                  </>
                )}
              </div>
              <div className="font-mono text-[10px] text-ink-muted mt-1">
                ${((r.total_value_cents || 0) / 100).toFixed(2)} uploaded
              </div>
            </div>
          );
        })}
      </div>

      {/* Channel filter pills */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          Filter:
        </span>
        {[null, "meta", "google", "microsoft"].map((ch) => (
          <button
            key={ch || "all"}
            type="button"
            onClick={() => setFilter(ch)}
            className={`px-2 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
              filter === ch
                ? "border-brand text-brand bg-brand/10"
                : "border-line text-ink-muted hover:border-ink-muted"
            }`}
            data-testid={`conv-log-filter-${ch || "all"}`}
          >
            {ch ? CHANNEL_LABELS[ch] : "All"}
          </button>
        ))}
        <span className="font-mono text-[10px] text-ink-muted ml-auto">
          {loading ? "…" : `${data?.total_in_db || 0} total in DB`}
        </span>
      </div>

      {err && (
        <div className="border border-red-700/50 bg-red-950/30 text-red-300 font-mono text-[10px] p-2 mb-3">
          ⚠ {err}
        </div>
      )}

      {/* Live feed table */}
      <div className="border border-line max-h-[480px] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="font-mono text-xs text-ink-muted p-6 text-center">
            {loading ? "Loading…" : "No conversion uploads yet. They start landing here once paid traffic with click IDs starts hitting checkout."}
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-paper sticky top-0">
              <tr className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Session</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.session_id}::${r.channel}`}
                  className="border-t border-line hover:bg-paper"
                  data-testid={`conv-log-row-${r.session_id}-${r.channel}`}
                >
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-muted whitespace-nowrap">
                    {_fmtAgo(r.uploaded_at)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.18em] ${CHANNEL_COLORS[r.channel] || "border-line text-ink-muted"}`}>
                      {CHANNEL_LABELS[r.channel] || r.channel}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px]">
                    {r.status === "ok" ? (
                      <span className="text-emerald-300">✓ ok</span>
                    ) : (
                      <span className="text-red-400" title={r.status}>
                        ✗ {(r.status || "err").replace(/^err:/, "").slice(0, 40)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-muted text-right whitespace-nowrap">
                    ${((r.amount_cents || 0) / 100).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-ink-muted truncate max-w-[180px]" title={r.session_id}>
                    {r.session_id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function _fmtAgo(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
