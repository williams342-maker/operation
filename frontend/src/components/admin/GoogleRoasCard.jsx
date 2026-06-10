import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { TrendingUp, RefreshCw, AlertTriangle } from "lucide-react";
import { fetchGoogleRoas } from "../../lib/api";

/**
 * iter334u — Google Ads ROAS tile.
 *
 * Pairs auto-tracked attributed revenue (via `gclid` URL param on Google
 * Ads landings, persisted on payment_transactions) with LIVE ad-spend
 * pulled by the daily Google Ads sync. Zero manual entry needed once
 * the OAuth connection is live.
 *
 * Mirrors `MsftRoasCard.jsx` layout — 4 KPI cells + window selector +
 * recent attributed orders + top campaigns table.
 *
 * Surfaces a stale-data hint if the sync hasn't run in the last 24h
 * (warns ops to check the Ads tab connection status).
 */
export default function GoogleRoasCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await fetchGoogleRoas(days);
      setData(r);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load Google Ads ROAS.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetchGoogleRoas(days);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.detail || "Couldn't load Google Ads ROAS.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days]);

  const roasColor = (() => {
    if (!data?.roas || !data?.ad_spend_usd) return "text-ink-muted";
    if (data.roas >= 4) return "text-emerald-400";
    if (data.roas >= 1.5) return "text-cyan-400";
    if (data.roas >= 1) return "text-amber-400";
    return "text-brand";
  })();

  // Sync staleness: if ad_spend_days_with_data is 0 but window > 0, the
  // cron likely hasn't populated rows yet (just connected, or sync
  // erroring). Surface a gentle warning so ops know why ROAS is blank.
  const noSpendData = data && data.ad_spend_usd === 0 && data.ad_spend_days_with_data === 0;

  return (
    <div className="border border-line bg-paper p-6 space-y-5" data-testid="google-roas-card">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 border border-emerald-400/40 bg-emerald-400/[0.06] flex items-center justify-center shrink-0">
          <TrendingUp size={16} className="text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-2xl md:text-3xl mb-1">Google Ads ROAS</h2>
          <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl">
            Attributed revenue / ad spend, last {days} days. Revenue auto-tracked via the{" "}
            <code className="text-emerald-300">gclid</code> URL param on Google-Ads landings.
            Spend pulled live from your synced Google Ads campaigns — no manual entry.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-2.5 py-1.5 border border-line hover:border-ink-muted text-ink-muted hover:text-ink font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5 disabled:opacity-40 shrink-0"
          data-testid="google-roas-refresh"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Window selector */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Window:</span>
        {[7, 14, 30].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
              days === d
                ? "border-emerald-400 text-emerald-300 bg-emerald-400/[0.06]"
                : "border-line text-ink-muted hover:border-ink-muted"
            }`}
            data-testid={`google-roas-window-${d}`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* KPI grid */}
      <div className="grid sm:grid-cols-4 gap-3" data-testid="google-roas-kpis">
        <Kpi label="Attributed orders" value={data?.attributed_orders ?? "—"} />
        <Kpi label="Attributed revenue" value={data?.attributed_revenue != null ? `$${data.attributed_revenue.toFixed(2)}` : "—"} />
        <Kpi
          label="Ad spend"
          value={data?.ad_spend_usd ? `$${data.ad_spend_usd.toFixed(2)}` : "—"}
          sub={data ? `${data.ad_spend_days_with_data} of ${data.days} days w/ data` : null}
        />
        <Kpi label="ROAS" value={data?.roas != null ? `${data.roas.toFixed(2)}×` : "—"} accent={roasColor} />
      </div>

      {/* No-spend warning */}
      {noSpendData && (
        <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/[0.05] px-4 py-3" data-testid="google-roas-no-data">
          <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="font-mono text-[11px] text-amber-200 leading-relaxed">
            No Google Ads spend rows in the last {days} days. Either campaigns
            haven&apos;t launched yet, or the daily sync (03:30 UTC) hasn&apos;t completed.
            Check the <strong>Ads</strong> tab → Google Ads card for sync status.
          </p>
        </div>
      )}

      {/* Top campaigns */}
      {data?.top_campaigns?.length > 0 && (
        <details className="border border-line bg-paper px-4 py-3" open>
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink">
            ◆ Top campaigns by spend ({data.top_campaigns.length})
          </summary>
          <table className="w-full font-mono text-[10px] mt-2" data-testid="google-roas-campaigns">
            <thead className="text-[9px] uppercase tracking-[0.22em] text-ink-muted">
              <tr>
                <th className="text-left py-2">Campaign</th>
                <th className="text-right py-2">Spend</th>
                <th className="text-right py-2">Clicks</th>
                <th className="text-right py-2">Impressions</th>
              </tr>
            </thead>
            <tbody>
              {data.top_campaigns.map((c, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 text-ink truncate max-w-[280px]" title={c.name}>{c.name}</td>
                  <td className="py-1.5 text-right text-emerald-300">${c.spend.toFixed(2)}</td>
                  <td className="py-1.5 text-right text-ink-muted">{c.clicks}</td>
                  <td className="py-1.5 text-right text-ink-muted">{c.impressions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {/* Sample attributed orders */}
      {data?.sample?.length > 0 && (
        <details className="border border-line bg-paper px-4 py-3">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink">
            ◆ Recent attributed orders ({data.sample.length})
          </summary>
          <table className="w-full font-mono text-[10px] mt-2">
            <thead className="text-[9px] uppercase tracking-[0.22em] text-ink-muted">
              <tr>
                <th className="text-left py-2">When</th>
                <th className="text-left py-2">gclid</th>
                <th className="text-right py-2">Items</th>
                <th className="text-right py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.sample.map((s, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 text-ink-muted">{s.created_at?.slice(0, 16)?.replace("T", " ") || "—"}</td>
                  <td className="py-1.5 text-ink-muted">{s.gclid}</td>
                  <td className="py-1.5 text-right text-ink-muted">{s.item_count}</td>
                  <td className="py-1.5 text-right text-ink">${s.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className="border border-line p-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">{label}</div>
      <div className={`font-display text-2xl mt-1 ${accent || "text-ink"}`}>{value}</div>
      {sub && <div className="font-mono text-[9px] text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}
