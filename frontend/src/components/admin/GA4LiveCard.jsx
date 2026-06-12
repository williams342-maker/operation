import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  fetchGa4Diag,
  fetchGa4Realtime,
  fetchGa4Summary7d,
  fetchGa4TopPages7d,
  fetchGa4TopSources7d,
} from "../../lib/api";

/**
 * iter226 — GA4 Live Analytics card for the Admin → Analytics tab.
 *
 * Surfaces four GA4 signals natively in the admin UI:
 *   1. Active users right now (realtime, polled every 20s)
 *   2. 7-day totals (users / sessions / page views)
 *   3. Top 10 pages over 7d
 *   4. Top 10 traffic sources over 7d
 *
 * On a fresh deploy, GA4 returns a friendly "API not enabled" or
 * "service account not authorized" error — both get rendered as a
 * red callout with the actionable next step (and a clickable link
 * when present).
 *
 * Why this lives in AnalyticsTab and not SettingsTab:
 *   • The diag/health pill BELONGS in Settings (it's an integration check).
 *   • The live metrics BELONG in Analytics (they're the data the admin
 *     came here to see). This card surfaces them where the admin's
 *     attention is, alongside the marketplace GMV/orders stats.
 */
export default function GA4LiveCard() {
  const [diag, setDiag] = useState(null);
  const [realtime, setRealtime] = useState(null);
  const [summary, setSummary] = useState(null);
  const [topPages, setTopPages] = useState([]);
  const [topSources, setTopSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Diag first — if it fails, skip the heavy queries to avoid
      // wasting GA4 quota on a property the SA can't read.
      const d = await fetchGa4Diag();
      setDiag(d);
      if (!d.ok) {
        setError(d.reason || "GA4 unavailable");
        setLoading(false);
        return;
      }
      // Run the three batched calls in parallel; realtime separately
      // because it polls on a different cadence.
      const [s, p, src, rt] = await Promise.all([
        fetchGa4Summary7d().catch((e) => ({ _err: e?.response?.data?.detail || "Summary failed" })),
        fetchGa4TopPages7d(10).catch((e) => ({ _err: e?.response?.data?.detail || "Top pages failed" })),
        fetchGa4TopSources7d(10).catch((e) => ({ _err: e?.response?.data?.detail || "Top sources failed" })),
        fetchGa4Realtime().catch((e) => ({ _err: e?.response?.data?.detail || "Realtime failed" })),
      ]);
      if (!s._err) setSummary(s); else toast.error(s._err);
      if (!p._err) setTopPages(p.pages || []); else toast.error(p._err);
      if (!src._err) setTopSources(src.sources || []); else toast.error(src._err);
      if (!rt._err) setRealtime(rt);
    } catch (e) {
      setError(e?.response?.data?.detail || "GA4 unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial + realtime poll (20s) — only the realtime endpoint refreshes
  // on the timer to keep GA4 Core quota usage tight.
  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    if (!diag?.ok) return;
    const id = setInterval(async () => {
      try {
        const rt = await fetchGa4Realtime();
        setRealtime(rt);
      } catch { /* silent — diag will catch a hard outage */ }
    }, 20_000);
    return () => clearInterval(id);
  }, [diag?.ok]);

  if (loading && !diag) {
    return (
      <div className="border border-line bg-paper p-6" data-testid="ga4-card-loading">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted mb-2">◆ GA4 · Live</div>
        <div className="font-mono text-sm text-ink-muted">Loading GA4 data…</div>
      </div>
    );
  }

  // Diag failed — render the friendly setup card instead of empty widgets.
  if (!diag?.ok) {
    return (
      <div className="border border-amber-700/40 bg-amber-950/15 p-6" data-testid="ga4-card-setup">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-1">◆ GA4 · Setup needed</div>
            <h3 className="font-display text-2xl text-ink">Google Analytics 4 — Not Connected</h3>
            <p className="font-mono text-[11px] text-ink-muted mt-1 max-w-[68ch] leading-relaxed">
              Live traffic metrics are one click away. Once GA4 is wired, this card surfaces realtime active users, 7-day totals, top pages, and top traffic sources right here.
            </p>
          </div>
          <button
            onClick={loadAll}
            className="px-3 py-1.5 border border-amber-700/60 hover:border-amber-400 hover:text-brand font-mono text-[11px] uppercase tracking-[0.22em] text-brand"
            data-testid="ga4-card-retry"
          >
            ↻ Retry
          </button>
        </div>
        {error && (
          <div className="mt-3 font-mono text-[11px] text-ink bg-paper/30 border border-amber-900/60 p-3 leading-relaxed" data-testid="ga4-card-reason">
            <strong className="text-brand">Reason:</strong>{" "}
            {(() => {
              const url = error.match(/\bhttps?:\/\/\S+/)?.[0];
              if (!url) return error;
              const [pre] = error.split(url);
              return (
                <>
                  {pre}
                  <a href={url} target="_blank" rel="noopener noreferrer"
                     className="text-emerald-700 underline break-all hover:text-emerald-700">
                    {url}
                  </a>
                </>
              );
            })()}
          </div>
        )}
        {diag && (
          <div className="grid grid-cols-2 gap-2 font-mono text-[11px] mt-3" data-testid="ga4-card-context">
            <div className="border border-line bg-paper px-2 py-1.5">
              <div className="uppercase tracking-[0.22em] text-[9px] text-ink-muted">Property ID</div>
              <div className="text-base text-ink">{diag.property_id || "—"}</div>
            </div>
            <div className="border border-line bg-paper px-2 py-1.5">
              <div className="uppercase tracking-[0.22em] text-[9px] text-ink-muted">Service account</div>
              <div className="text-[11px] text-ink truncate" title={diag.client_email}>{diag.client_email || "—"}</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Happy path — render the live cards.
  return (
    <div className="space-y-4" data-testid="ga4-card-live">
      <div className="flex items-end justify-between flex-wrap gap-3 border-b border-line pb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-emerald-700 mb-1">◆ GA4 · Live</div>
          <h3 className="font-display text-2xl">Google Analytics</h3>
        </div>
        <button
          onClick={loadAll}
          className="px-3 py-1.5 border border-line hover:border-emerald-500 hover:text-emerald-700 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted"
          data-testid="ga4-card-refresh"
        >
          ↻ Refresh
        </button>
      </div>

      {/* KPI row: realtime + 7d summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="ga4-kpis">
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="border border-emerald-700/40 bg-emerald-950/20 p-4"
          data-testid="ga4-kpi-realtime"
        >
          <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-emerald-700 mb-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Now
          </div>
          <div className="font-display text-4xl text-emerald-700">{realtime?.active_users ?? "—"}</div>
          <div className="font-mono text-[10px] text-ink-muted mt-1">active users</div>
        </motion.div>
        <KpiTile label="Users · 7d" value={summary?.total_users} testId="ga4-kpi-users-7d" />
        <KpiTile label="Sessions · 7d" value={summary?.sessions} testId="ga4-kpi-sessions-7d" />
        <KpiTile label="Page views · 7d" value={summary?.page_views} testId="ga4-kpi-pageviews-7d" />
      </div>

      {/* Top tables */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-line bg-paper p-4" data-testid="ga4-top-pages">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted mb-3">Top pages · 7d</div>
          {!topPages.length ? (
            <div className="font-mono text-xs text-ink-muted">No traffic in the last 7 days yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {topPages.map((p, i) => (
                <li key={i} className="flex justify-between items-center gap-3 font-mono text-xs">
                  <span className="text-ink truncate" title={p.page_path}>{p.page_path}</span>
                  <span className="text-emerald-700 shrink-0">{p.page_views.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border border-line bg-paper p-4" data-testid="ga4-top-sources">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted mb-3">Top sources · 7d</div>
          {!topSources.length ? (
            <div className="font-mono text-xs text-ink-muted">No traffic in the last 7 days yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {topSources.map((s, i) => (
                <li key={i} className="flex justify-between items-center gap-3 font-mono text-xs">
                  <span className="text-ink truncate" title={s.source_medium}>{s.source_medium}</span>
                  <span className="text-emerald-700 shrink-0">{s.sessions.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiTile({ label, value, testId }) {
  return (
    <div className="border border-line bg-paper p-4" data-testid={testId}>
      <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-ink-muted mb-1">{label}</div>
      <div className="font-display text-4xl text-ink">{value === undefined || value === null ? "—" : value.toLocaleString()}</div>
    </div>
  );
}
