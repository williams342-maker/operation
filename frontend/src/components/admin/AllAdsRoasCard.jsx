import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Target, RefreshCw } from "lucide-react";
import { fetchAllAdsRoas } from "../../lib/api";

/**
 * iter334v — Combined "All Ads ROAS" header card.
 *
 * Sums Microsoft (msclkid + ops-entered spend) + Google (gclid + synced
 * spend) into a single all-paid-channel ROAS. Lives at the top of the
 * Analytics tab so ops sees the rolled-up number first; the per-platform
 * cards below provide drill-down detail.
 *
 * Layout: prominent ROAS number on the left, per-platform mini-rows on
 * the right. Compact so it doesn't dominate the page.
 */
export default function AllAdsRoasCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetchAllAdsRoas(days);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.detail || "Couldn't load combined ROAS.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days]);

  const roasColor = (() => {
    if (!data?.roas || !data?.total_ad_spend_usd) return "text-ink-muted";
    if (data.roas >= 4) return "text-emerald-400";
    if (data.roas >= 1.5) return "text-cyan-400";
    if (data.roas >= 1) return "text-amber-400";
    return "text-brand";
  })();

  const platformAccent = {
    microsoft: "text-cyan-300 border-cyan-400/30",
    google: "text-emerald-300 border-emerald-400/30",
    meta: "text-blue-300 border-blue-400/30",
  };
  const platformLabel = { microsoft: "Microsoft", google: "Google", meta: "Meta" };

  const refresh = () => setDays((d) => d);

  return (
    <div
      className="border border-brand/30 bg-gradient-to-br from-brand/10 to-surface p-6 space-y-5"
      data-testid="all-ads-roas-card"
    >
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 border border-brand/50 bg-brand/[0.08] flex items-center justify-center shrink-0">
          <Target size={16} className="text-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-2xl md:text-3xl mb-1">All Paid Channels · ROAS</h2>
          <p className="font-mono text-xs text-ink-muted leading-relaxed">
            Combined Microsoft + Google attributed revenue ÷ total ad spend, last {days} days.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                days === d
                  ? "border-brand text-brand bg-brand/[0.06]"
                  : "border-line text-ink-muted hover:border-ink-muted"
              }`}
              data-testid={`all-roas-window-${d}`}
            >
              {d}d
            </button>
          ))}
          <button
            onClick={() => { refresh(); setDays((d) => d); }}
            disabled={loading}
            className="px-2 py-1 border border-line hover:border-ink-muted text-ink-muted hover:text-ink font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1 disabled:opacity-40"
            data-testid="all-roas-refresh"
            title="Refresh"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Headline ROAS — spans 1 col, oversized */}
        <div className="border border-line bg-paper p-5 flex flex-col justify-center" data-testid="all-roas-headline">
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">Combined ROAS</div>
          <div className={`font-display text-5xl md:text-6xl mt-1 ${roasColor}`}>
            {data?.roas != null ? `${data.roas.toFixed(2)}×` : "—"}
          </div>
          <div className="font-mono text-[10px] text-ink-muted mt-2">
            {data ? (
              <>
                ${(data.total_attributed_revenue || 0).toFixed(0)} rev / $
                {(data.total_ad_spend_usd || 0).toFixed(0)} spend
                <br />
                {data.total_attributed_orders} attributed orders
              </>
            ) : "Loading…"}
          </div>
        </div>

        {/* Per-platform breakdown — spans 2 cols (3 platforms fit nicely on md+) */}
        <div className="md:col-span-2 grid sm:grid-cols-3 gap-3" data-testid="all-roas-breakdown">
          {(data?.breakdown || []).map((p) => (
            <div
              key={p.platform}
              className={`border ${platformAccent[p.platform] || "border-line"} bg-paper p-4 space-y-2`}
              data-testid={`all-roas-platform-${p.platform}`}
            >
              <div className="flex items-baseline justify-between">
                <div className={`font-mono text-[10px] uppercase tracking-[0.22em] ${platformAccent[p.platform]?.split(" ")[0]}`}>
                  {platformLabel[p.platform] || p.platform}
                </div>
                <div className="font-display text-2xl text-ink">
                  {p.roas != null ? `${p.roas.toFixed(2)}×` : "—"}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 font-mono text-[9px]">
                <Stat label="Orders" value={p.orders} />
                <Stat label="Revenue" value={`$${p.revenue.toFixed(0)}`} />
                <Stat label="Spend" value={`$${p.spend.toFixed(0)}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-ink-muted uppercase tracking-[0.22em]">{label}</div>
      <div className="text-ink mt-0.5 text-sm">{value}</div>
    </div>
  );
}
