import React, { useEffect, useState } from "react";
import { fetchMakerStats, fetchFeePolicy, fetchMakerMe } from "../../lib/api";
import { StatsSkeleton } from "../../components/Skeleton";
import WorstPerformersPanel from "./WorstPerformersPanel";
import PlusAnalytics from "./PlusAnalytics";
import { isFounder, isInauguralFounder } from "../../lib/founderTier";

/** Stats tab — read-only dashboard surfacing aggregates already in the DB. */
export default function StatsTab() {
  const [stats, setStats] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [maker, setMaker] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([fetchMakerStats(), fetchFeePolicy(), fetchMakerMe()])
      .then(([s, p, m]) => { setStats(s); setPolicy(p); setMaker(m); })
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load stats."));
  }, []);

  if (err) return <p className="font-mono text-sm text-red-400" data-testid="stats-error">{err}</p>;

  // PlusAnalytics owns its own fetch and gating — render it even while
  // the basic stats are still loading so the cold-load doesn't hide
  // the upsell card / Plus metrics behind a skeleton.
  if (!stats) {
    return (
      <div className="space-y-8" data-testid="stats-tab">
        <PlusAnalytics />
        <StatsSkeleton />
      </div>
    );
  }

  // Net revenue after platform + processing fees (visible best-estimate)
  // iter413cl — Use the founder/plus rate when applicable so the number
  // reflects the maker's ACTUAL take-home, not the generic Free-tier math.
  const founderBps = 300;
  const plusBps = policy?.plus_platform_fee_bps || 400;
  const procBps = policy?.processing_fee_bps || 300;
  const baseBps = policy?.platform_fee_bps || 500;
  const effectivePlatformBps = isFounder(maker)
    ? founderBps + procBps
    : (maker?.subscription_status === "active" ? plusBps + procBps : baseBps + procBps);
  const platformBps = effectivePlatformBps;
  const netRevenue = stats.gross_revenue * (1 - platformBps / 10000);
  const tierBlurb = isFounder(maker)
    ? `Based on your ${isInauguralFounder(maker) ? "Inaugural Founder" : "Founder"} rate (3% commission + ${(procBps/100).toFixed(0)}% processing) — lower than every other tier.`
    : (maker?.subscription_status === "active"
      ? `Based on your Crafters Plus rate (${(plusBps/100).toFixed(0)}% commission + ${(procBps/100).toFixed(0)}% processing).`
      : `Based on Standard rate (${(platformBps/100).toFixed(0)}% combined commission + processing). Plus subscribers keep more — see Upgrade tab.`);

  return (
    <div className="space-y-8" data-testid="stats-tab">
      <header className="pb-6 border-b border-line">
        <h2 className="font-display text-3xl md:text-4xl uppercase">Stats.</h2>
        <p className="font-mono text-xs text-ink-muted mt-2 max-w-xl">
          Quick health check on your shop. Numbers update in real time.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
        <Tile label="Active Listings"  value={stats.active_listings}                          testid="stat-active" />
        <Tile label="Paid Orders"      value={stats.paid_orders}                              testid="stat-orders" />
        <Tile label="Pending Orders"   value={stats.pending_orders} accent={stats.pending_orders > 0} testid="stat-pending" />
        <Tile label="Fulfilled"        value={stats.fulfilled_orders}                         testid="stat-fulfilled" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-5">
        <Tile label="Gross Revenue · all time"
              value={`$${stats.gross_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              size="lg" testid="stat-gross" />
        <Tile label="Last 30 Days"
              value={`$${stats.last_30d_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              size="lg" testid="stat-30d" />
      </div>

      <div className="border border-line bg-paper p-5" data-testid="stat-net">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
          ◆ Estimated take-home (after fees)
        </div>
        <div className="font-display text-3xl text-brand">
          ${netRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <p className="font-mono text-[10px] text-ink-muted mt-2 leading-relaxed">
          {tierBlurb}
        </p>
      </div>

      {/* Crafters Plus advanced analytics — gated server-side. Free
          makers get a polished upsell card here. */}
      <PlusAnalytics />

      {/* Recovery Queue — surfaces underperforming listings + forgotten drafts
          with one-click AI refresh / publish actions. Lives in Stats (not
          Listings) so the Listings tab stays clean for browsing/editing. */}
      <WorstPerformersPanel />
    </div>
  );
}

function Tile({ label, value, accent, size = "md", testid }) {
  return (
    <div
      className={`border border-line bg-paper p-4 md:p-5 ${accent ? "border-brand" : ""}`}
      data-testid={testid}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2 truncate">
        {label}
      </div>
      <div className={`font-display ${size === "lg" ? "text-4xl md:text-5xl" : "text-3xl"} text-ink`}>
        {value}
      </div>
    </div>
  );
}
