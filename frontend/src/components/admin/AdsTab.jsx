import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  fetchAdsMetrics,
  fetchAdsPerformance,
  adminSeedAdsDemo,
  adminClearAdsDemo,
} from "../../lib/api";
import { Stat } from "./_shared";
import { Sparkline } from "../Charts";
import { useConfirm } from "../../hooks/useConfirm";
import GoogleAdsConnectionCard from "./GoogleAdsConnectionCard";
import MicrosoftAdsConnectionCard from "./MicrosoftAdsConnectionCard";
import MetaAdsConnectionCard from "./MetaAdsConnectionCard";
import AdAttributionHealthCard from "./AdAttributionHealthCard";
import ConversionUploadLogCard from "./ConversionUploadLogCard";
import ChannelWeightsCard from "./ChannelWeightsCard";
import PromoteThemesCard from "./PromoteThemesCard";
import SitePromosCard from "./SitePromosCard";
import AdCreativeWorkshopCard from "./AdCreativeWorkshopCard";

const PLATFORM_TONE = {
  google: "border-blue-700/50 text-blue-700",
  meta: "border-purple-700/50 text-purple-700",
};

export default function AdsTab() {
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState(null);
  const [perf, setPerf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmModal] = useConfirm();

  const load = async (d = days) => {
    setLoading(true);
    try {
      const [m, p] = await Promise.all([
        fetchAdsMetrics({ days: d }),
        fetchAdsPerformance(d),
      ]);
      setMetrics(m);
      setPerf(p);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load ad metrics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); /* eslint-disable-next-line */ }, []);

  const seedDemo = async () => {
    setBusy(true);
    try {
      const r = await adminSeedAdsDemo(14);
      toast.success(`Seeded ${r.rows} demo rows across ${r.campaigns} campaigns.`);
      await load(days);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Demo seed failed.");
    } finally {
      setBusy(false);
    }
  };

  const clearDemo = async () => {
    const ok = await confirm({
      title: "Wipe all demo ad-spend rows?",
      body: "Only synthetic 'demo-' campaigns are deleted — real data is untouched.",
      confirmLabel: "Wipe demo data",
      tone: "warn",
      testId: "confirm-clear-ads-demo",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await adminClearAdsDemo();
      toast.success(`Cleared ${r.deleted} demo rows.`);
      await load(days);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Clear failed.");
    } finally {
      setBusy(false);
    }
  };

  const sparkPoints = useMemo(
    () => (perf?.daily || []).map((d) => d.spend),
    [perf],
  );

  return (
    <div data-testid="ads-tab" className="space-y-6">
      {confirmModal}
      <AdCreativeWorkshopCard />
      <SitePromosCard />
      <AdAttributionHealthCard />
      <ConversionUploadLogCard />
      <ChannelWeightsCard />
      <PromoteThemesCard />
      <GoogleAdsConnectionCard />
      <MicrosoftAdsConnectionCard />
      <MetaAdsConnectionCard />
      <div className="border border-line p-4 md:p-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-2">
          ◆ Off-site Ad Spend
        </div>
        <h3 className="font-display text-2xl uppercase mb-1">Google + Meta · ROAS</h3>
        <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl">
          Tracks daily spend across paid acquisition channels and cross-references against orders with <code className="text-brand">external_attribution=true</code> for true attributed-revenue ROAS. Seed synthetic data to see the dashboard render before live API credentials are wired.
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <div className="flex border border-line">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => { setDays(d); load(d); }}
                className={`px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] border-r border-line last:border-r-0 ${
                  days === d ? "bg-brand text-[#0a0a0a]" : "text-ink-muted hover:text-ink"
                }`}
                data-testid={`ads-range-${d}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={seedDemo}
            disabled={busy}
            className="px-3 py-2 border border-line hover:border-brand font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="ads-seed-demo"
          >
            {busy ? "…" : "Seed demo"}
          </button>
          <button
            onClick={clearDemo}
            disabled={busy}
            className="px-3 py-2 border border-red-900/60 text-red-600 hover:border-red-500 hover:text-red-600 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="ads-clear-demo"
          >
            Clear demo
          </button>
        </div>
      </div>

      {loading || !metrics ? (
        <p className="font-mono text-sm text-ink-muted" data-testid="ads-loading">Loading ad metrics…</p>
      ) : metrics.spend === 0 ? (
        <div className="border border-dashed border-line p-10 text-center" data-testid="ads-empty">
          <p className="font-mono text-sm text-ink-muted mb-3">
            No spend data yet for the last {days} days.
          </p>
          <p className="font-mono text-xs text-ink-muted">
            Live Google Ads + Meta SDK wiring is parked until API credentials arrive. Hit "Seed demo" to populate the dashboard with synthetic data so you can review the layout.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            <Stat label="Spend" value={`$${metrics.spend.toLocaleString()}`} testId="ads-stat-spend" />
            <Stat label="Att. Revenue" value={`$${metrics.attributed_revenue.toLocaleString()}`} testId="ads-stat-revenue" />
            <Stat label="ROAS" value={`${metrics.roas}×`} testId="ads-stat-roas" />
            <Stat label="Clicks" value={metrics.clicks.toLocaleString()} testId="ads-stat-clicks" />
          </div>

          <div className="border border-line p-4 md:p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
              ◆ Daily spend · last {days} days
            </div>
            {sparkPoints.length > 0 && (
              <Sparkline points={sparkPoints} />
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-muted mb-2">
                ◆ Top campaigns
              </div>
              {!perf?.campaigns?.length ? (
                <p className="font-mono text-sm text-ink-muted">None.</p>
              ) : (
                <div className="border border-line divide-y divide-line" data-testid="ads-campaigns">
                  {perf.campaigns.slice(0, 8).map((c) => (
                    <div key={`${c.platform}-${c.campaign_id}`} className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-display text-base truncate">{c.campaign_name}</div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted flex gap-2 mt-0.5">
                          <span className={`px-1 border ${PLATFORM_TONE[c.platform] || ""}`}>{c.platform}</span>
                          {c.category && <span>{c.category}</span>}
                          <span>CTR {c.ctr}%</span>
                          <span>CPC ${c.cpc}</span>
                        </div>
                      </div>
                      <div className="font-display text-xl text-brand shrink-0">${c.spend.toFixed(0)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-ink-muted mb-2">
                ◆ By technique
              </div>
              {!perf?.categories?.length ? (
                <p className="font-mono text-sm text-ink-muted">None.</p>
              ) : (
                <div className="border border-line divide-y divide-line" data-testid="ads-categories">
                  {perf.categories.map((c) => (
                    <div key={c.category} className="p-3 flex items-center justify-between gap-3">
                      <div className="font-mono text-sm text-ink">{c.category}</div>
                      <div className="font-display text-xl text-brand">${c.spend.toFixed(0)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
