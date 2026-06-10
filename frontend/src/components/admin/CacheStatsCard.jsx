import React, { useEffect, useState } from "react";
import { Database, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fetchAdminCacheStats, clearAdminCache } from "../../lib/api";

/**
 * iter334o — In-process /api/products TTL cache stats.
 *
 * Read-only snapshot — hit rate, entries, oldest age. Useful when
 * tuning TTL or investigating "why does the homepage feel stale"
 * (oldest_age_s near TTL → most reads are warm).
 *
 * Stats are per-process and reset on backend restart.
 */
export default function CacheStatsCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setData(await fetchAdminCacheStats());
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load cache stats.");
    } finally {
      setLoading(false);
    }
  };

  const clear = async () => {
    setClearing(true);
    try {
      const r = await clearAdminCache();
      toast.success(`Cache cleared — dropped ${r.cleared} ${r.cleared === 1 ? "entry" : "entries"}.`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't clear cache.");
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const hitRatePct = data ? Math.round(data.hit_rate * 100) : 0;
  const rateColor =
    hitRatePct >= 70 ? "text-emerald-400"
    : hitRatePct >= 40 ? "text-cyan-400"
    : hitRatePct >= 15 ? "text-amber-400"
    : "text-ink-muted";

  return (
    <div
      className="border border-line bg-paper p-4 space-y-4"
      data-testid="cache-stats-card"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 border border-cyan-400/40 bg-cyan-400/[0.06] flex items-center justify-center shrink-0">
          <Database size={14} className="text-cyan-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg md:text-xl mb-1">Products Cache</h3>
          <p className="font-mono text-[10px] text-ink-muted leading-relaxed">
            In-process TTL cache on <code className="text-cyan-300">/api/products</code>.
            Resets on backend restart.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-2 py-1 border border-line hover:border-ink-muted text-ink-muted hover:text-ink font-mono text-[9px] uppercase tracking-[0.22em] inline-flex items-center gap-1 disabled:opacity-40 shrink-0"
          data-testid="cache-stats-refresh"
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
        <button
          onClick={clear}
          disabled={clearing || loading || !data?.entries_count}
          className="px-2 py-1 border border-red-500/30 hover:border-red-400 text-red-400 hover:text-red-300 hover:bg-red-500/5 font-mono text-[9px] uppercase tracking-[0.22em] inline-flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          data-testid="cache-stats-clear"
          title={data?.entries_count ? "Drop every cached entry (read counters preserved)." : "Cache already empty."}
        >
          <Trash2 size={10} className={clearing ? "animate-pulse" : ""} /> {clearing ? "Clearing…" : "Clear"}
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="cache-stats-kpis">
        <Kpi label="Hit rate" value={data ? `${hitRatePct}%` : "—"} accent={rateColor} />
        <Kpi label="Hits / Misses" value={data ? `${data.hits} / ${data.misses}` : "—"} />
        <Kpi label="Entries" value={data ? `${data.entries_count} / ${data.cap}` : "—"} />
        <Kpi label="Oldest age" value={data ? `${data.oldest_age_s.toFixed(1)}s` : "—"} sub={data ? `TTL ${data.ttl_s}s` : null} />
      </div>

      {/* Entries table — collapsible to keep the tile compact. */}
      {data?.entries?.length > 0 && (
        <details className="border border-line bg-[#080808] px-3 py-2">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink">
            ◆ Cached entries ({data.entries.length})
          </summary>
          <table className="w-full font-mono text-[10px] mt-2">
            <thead className="text-[9px] uppercase tracking-[0.22em] text-ink-muted">
              <tr>
                <th className="text-left py-1.5">Key (category·technique·q·featured·example·maker)</th>
                <th className="text-right py-1.5">Size</th>
                <th className="text-right py-1.5">Age</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1 text-ink-muted truncate max-w-[280px]" title={e.key}>{e.key}</td>
                  <td className="py-1 text-right text-ink">{e.size}</td>
                  <td className="py-1 text-right text-ink-muted">{e.age_s.toFixed(1)}s</td>
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
    <div className="border border-line px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">{label}</div>
      <div className={`font-display text-xl mt-0.5 ${accent || "text-ink"}`}>{value}</div>
      {sub && <div className="font-mono text-[9px] text-ink-muted mt-0.5">{sub}</div>}
    </div>
  );
}
