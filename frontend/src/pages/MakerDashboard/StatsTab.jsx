import React, { useEffect, useState } from "react";
import { fetchMakerStats, fetchFeePolicy } from "../../lib/api";
import { StatsSkeleton } from "../../components/Skeleton";

/** Stats tab — read-only dashboard surfacing aggregates already in the DB. */
export default function StatsTab() {
  const [stats, setStats] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([fetchMakerStats(), fetchFeePolicy()])
      .then(([s, p]) => { setStats(s); setPolicy(p); })
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load stats."));
  }, []);

  if (err) return <p className="font-mono text-sm text-red-400" data-testid="stats-error">{err}</p>;
  if (!stats) return <StatsSkeleton />;

  // Net revenue after platform + processing fees (visible best-estimate)
  const platformBps = (policy?.platform_fee_bps || 500) + (policy?.processing_fee_bps || 300);
  const netRevenue = stats.gross_revenue * (1 - platformBps / 10000);

  return (
    <div className="space-y-8" data-testid="stats-tab">
      <header className="pb-6 border-b border-[#262626]">
        <h2 className="font-display text-3xl md:text-4xl uppercase">Stats.</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-xl">
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

      <div className="border border-[#1f1f1f] bg-[#0d0d0d] p-5" data-testid="stat-net">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
          ◆ Estimated take-home (after fees)
        </div>
        <div className="font-display text-3xl text-[#ff4500]">
          ${netRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <p className="font-mono text-[10px] text-[#525252] mt-2 leading-relaxed">
          Based on Free-tier rate ({(platformBps / 100).toFixed(0)}% combined commission + processing).
          Plus subscribers keep more — see Upgrade tab.
        </p>
      </div>
    </div>
  );
}

function Tile({ label, value, accent, size = "md", testid }) {
  return (
    <div
      className={`border border-[#1f1f1f] bg-[#0d0d0d] p-4 md:p-5 ${accent ? "border-[#ff4500]" : ""}`}
      data-testid={testid}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2 truncate">
        {label}
      </div>
      <div className={`font-display ${size === "lg" ? "text-4xl md:text-5xl" : "text-3xl"} text-[#e5e5e5]`}>
        {value}
      </div>
    </div>
  );
}
