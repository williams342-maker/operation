import React, { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { fetchAdminGrowthStats } from "../../lib/api";

/**
 * Compact growth heartbeat bar — pinned above the standard 4 stat tiles
 * on the admin dashboard. Shows total + 24h delta + 7d delta for each
 * opt-in list. Designed to be a daily dopamine hit + early demand signal
 * (e.g. "Neon waitlist +12 in 24h" tells you to launch Neon next).
 */
export default function GrowthStatsBar() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchAdminGrowthStats()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.detail || "Failed to load growth stats."); });
    return () => { cancelled = true; };
  }, []);

  if (err) {
    return (
      <div className="font-mono text-[11px] text-red-400 mb-6" data-testid="growth-stats-error">
        {err}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#525252] mb-6" data-testid="growth-stats-loading">
        ◇ Loading growth heartbeat…
      </div>
    );
  }

  const stats = data.stats || [];
  return (
    <div className="mb-8" data-testid="growth-stats-bar">
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#ff4500]">
          ◆ Growth · 24h heartbeat
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
          {data.as_of ? new Date(data.as_of).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        {stats.map((s) => (
          <Tile key={s.key} stat={s} />
        ))}
      </div>
    </div>
  );
}

function Tile({ stat }) {
  const d1 = stat.d1 || 0;
  const d7 = stat.d7 || 0;
  const Trend = d1 > 0 ? TrendingUp : d1 < 0 ? TrendingDown : Minus;
  const trendColor = d1 > 0 ? "text-emerald-400" : d1 < 0 ? "text-red-400" : "text-[#525252]";
  const sign = d1 > 0 ? "+" : "";

  return (
    <div
      className="border border-[#262626] bg-[#0a0a0a] hover:border-[#ff4500]/40 transition-colors p-3"
      data-testid={`growth-tile-${stat.key}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252] truncate">
          {stat.label}
        </span>
        <Trend size={11} className={`${trendColor} shrink-0 ml-2`} />
      </div>
      <div className="flex items-baseline gap-2">
        <div className="font-display text-2xl text-[#e5e5e5]" data-testid={`growth-tile-${stat.key}-total`}>
          {stat.total}
        </div>
        <div className={`font-mono text-[10px] ${trendColor}`} data-testid={`growth-tile-${stat.key}-d1`}>
          {sign}{d1} 24h
        </div>
      </div>
      <div className="font-mono text-[9px] text-[#525252] mt-0.5" data-testid={`growth-tile-${stat.key}-d7`}>
        {d7 > 0 ? "+" : ""}{d7} · 7d
      </div>
    </div>
  );
}
