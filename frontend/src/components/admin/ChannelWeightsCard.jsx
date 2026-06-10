/**
 * iter335.14 — Phase 4 Promotion Engine: Channel attribution weights.
 *
 * Surfaces the rolling 30-day per-channel performance to admins:
 *   • Orders attributed (by gclid / fbclid / msclkid)
 *   • Spend (from ad_spend ledger)
 *   • ROAS (revenue / spend)
 *   • Normalized weight (sum=1.0 across channels)
 *
 * The weights are what the allocator uses to recommend a default
 * paid-channel split for makers — channels with proven lift get
 * more of the auto-allocated budget; underperformers shrink.
 *
 * Recomputed daily at 04:30 UTC; admin can also force a recompute.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TrendingUp, RefreshCw, Loader2 } from "lucide-react";
import {
  adminFetchChannelWeights, adminRecomputeChannelWeights,
} from "../../lib/api";

const CHANNEL_TONE = {
  google:    "border-emerald-700/50 text-emerald-300",
  meta:      "border-sky-700/50 text-sky-300",
  microsoft: "border-amber-700/50 text-amber-300",
};

const CHANNEL_LABEL = {
  google: "Google Ads",
  meta: "Meta",
  microsoft: "Microsoft Ads",
};

function dollars(cents) { return (Number(cents || 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
function roasFmt(r) { return r > 0 ? `${r.toFixed(2)}×` : "—"; }

export default function ChannelWeightsCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await adminFetchChannelWeights();
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.detail || "Failed to load channel weights.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const onRecompute = async () => {
    setRecomputing(true);
    try {
      await adminRecomputeChannelWeights();
      toast.success("Weights recomputed.");
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Recompute failed.");
    } finally { setRecomputing(false); }
  };

  return (
    <div className="border border-line p-4 md:p-5" data-testid="channel-weights-card">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-emerald-300 mb-2 flex items-center gap-1.5">
            <TrendingUp size={12} /> ◆ Channel Attribution
          </div>
          <h3 className="font-display text-2xl uppercase mb-1">Paid-Channel Weights · 30 Days</h3>
          <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl">
            Normalized weight per ad platform based on observed ROAS. The allocator uses these to recommend a default split when makers run multi-channel campaigns.
          </p>
        </div>
        <button
          type="button"
          onClick={onRecompute}
          disabled={recomputing}
          className="px-3 py-2 border border-emerald-700/50 hover:border-emerald-400 text-emerald-300 font-mono text-[10px] uppercase tracking-[0.22em] flex items-center gap-1.5 disabled:opacity-50"
          data-testid="channel-weights-recompute"
        >
          {recomputing
            ? <><Loader2 size={11} className="animate-spin" /> Recomputing…</>
            : <><RefreshCw size={11} /> Recompute now</>}
        </button>
      </div>

      {loading && <p className="font-mono text-xs text-ink-muted">Loading…</p>}

      {!loading && data && (
        <>
          {data.cold_start && (
            <div
              className="border border-amber-700/40 bg-amber-950/20 px-3 py-2 mb-3 font-mono text-[11px] text-amber-200 leading-snug"
              data-testid="channel-weights-cold-start"
            >
              No paid attribution yet in the 30-day window — falling back to equal weights ({(100 / data.channels.length).toFixed(0)}% each). Weights will rebalance once paid orders + spend land in the ledger.
            </div>
          )}
          <div className="border border-line divide-y divide-line" data-testid="channel-weights-list">
            {data.channels.map((c) => (
              <div
                key={c.channel}
                className="p-3 flex items-center gap-3 flex-wrap"
                data-testid={`channel-weight-row-${c.channel}`}
              >
                <div className="min-w-[120px]">
                  <span className={`font-mono text-[10px] uppercase tracking-[0.22em] px-1.5 py-0.5 border ${CHANNEL_TONE[c.channel] || ""}`}>
                    {CHANNEL_LABEL[c.channel] || c.channel}
                  </span>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <div className="h-2 bg-surface relative overflow-hidden">
                    <div
                      className="h-2 bg-gradient-to-r from-emerald-700 to-emerald-300 transition-all"
                      style={{ width: `${Math.max(2, (c.weight || 0) * 100)}%` }}
                    />
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted mt-1">
                    Weight {(c.weight * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="text-right min-w-[100px]">
                  <div className="font-display text-lg text-ink tabular-nums" data-testid={`channel-weight-orders-${c.channel}`}>
                    {c.orders_30d}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">Orders</div>
                </div>
                <div className="text-right min-w-[100px]">
                  <div className="font-display text-lg text-ink tabular-nums">
                    ${dollars(c.spend_cents_30d)}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">Spend</div>
                </div>
                <div className="text-right min-w-[80px]">
                  <div className={`font-display text-lg tabular-nums ${
                    c.roas >= 2 ? "text-emerald-300" :
                    c.roas >= 1 ? "text-amber-300" :
                    c.roas > 0 ? "text-red-300" : "text-ink-muted"
                  }`}>
                    {roasFmt(c.roas)}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">ROAS</div>
                </div>
              </div>
            ))}
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted mt-3">
            Computed {data.computed_at ? new Date(data.computed_at).toLocaleString() : "—"} · window {data.window_days || 30} days
          </div>
        </>
      )}
    </div>
  );
}
