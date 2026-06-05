import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, TrendingUp, TrendingDown, RefreshCw, Play } from "lucide-react";
import { adminRunPricingDigest, fetchPricingDigestHistory } from "../../lib/api";

/**
 * iter334h — Admin pricing-digest health view.
 *
 * Renders inside the existing DigestsTab. Two halves:
 *   1. "Run dry-run" button → shows TODAY's would-send breakdown
 *      (above/below counts per maker, no email side effects).
 *   2. "Week-over-week" table from `pricing_digest_log` showing the
 *      last 8 ISO weeks of digests + their above/below split + top 5
 *      receivers per week.
 *
 * Surfaced to ops so we can spot:
 *   - "Digest didn't fire last Monday" (sent=0 row appears)
 *   - "Suddenly 80% of flagged listings are below market" (a new
 *     supply spike, e.g. someone seeded the AI Price Check at scale)
 *   - "Same maker keeps getting flagged" (top_makers repeats)
 */
export default function PricingDigestHealthCard() {
  const [history, setHistory] = useState(null);
  const [dryRunResult, setDryRunResult] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const r = await fetchPricingDigestHistory(8);
      setHistory(r);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load pricing digest history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const runDryRun = async () => {
    setDryRunLoading(true);
    try {
      const r = await adminRunPricingDigest(true);
      setDryRunResult(r);
      if (r.status === "skipped") {
        toast.info(`Dry-run skipped: ${r.reason}`);
      } else {
        toast.success(`Dry-run done · would send to ${r.would_send || 0} maker(s).`);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Dry-run failed.");
    } finally {
      setDryRunLoading(false);
    }
  };

  useEffect(() => { loadHistory(); }, []);

  return (
    <div className="border border-[#262626] bg-[#0d0d0d] p-6 space-y-5" data-testid="pricing-digest-health">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 border border-cyan-400/40 bg-cyan-400/[0.06] flex items-center justify-center shrink-0">
          <Sparkles size={16} className="text-cyan-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-2xl md:text-3xl mb-1">AI pricing digest health</h2>
          <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed max-w-2xl">
            Week-over-week visibility into the Monday pricing digest cron. The "Above market"
            column counts listings priced 20%+ above AI-derived median; "Below market" counts
            opportunities priced 20%+ below (potential upside for the maker).
          </p>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={runDryRun}
          disabled={dryRunLoading}
          className="px-3 py-2 border border-cyan-400/40 hover:border-cyan-300 text-cyan-300 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-wait"
          data-testid="pricing-digest-dry-run"
        >
          <Play size={11} /> {dryRunLoading ? "Running…" : "Dry-run today"}
        </button>
        <button
          onClick={loadHistory}
          disabled={historyLoading}
          className="px-3 py-2 border border-[#262626] hover:border-[#525252] text-[#a3a3a3] hover:text-[#e5e5e5] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5 disabled:opacity-40"
          data-testid="pricing-digest-refresh-history"
        >
          <RefreshCw size={11} /> Refresh history
        </button>
      </div>

      {/* Dry-run snapshot */}
      {dryRunResult && (
        <div className="border border-cyan-400/30 bg-cyan-400/[0.04] p-4" data-testid="pricing-digest-dry-run-result">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400 mb-2">
            ◆ Dry-run · {dryRunResult.week_key || "now"}
          </p>
          {dryRunResult.status === "ok" ? (
            <>
              <div className="grid sm:grid-cols-4 gap-3 mb-3">
                <Cell label="Comparisons scanned" value={dryRunResult.comparisons_scanned} />
                <Cell label="Makers eligible" value={dryRunResult.makers_eligible} />
                <Cell label="Would send" value={dryRunResult.would_send} accent="cyan" />
                <Cell label="Opted out" value={dryRunResult.skipped_opted_out} />
              </div>
              {Array.isArray(dryRunResult.details) && dryRunResult.details.length > 0 && (
                <table className="w-full font-mono text-[11px]">
                  <thead className="text-[9px] uppercase tracking-[0.22em] text-[#737373]">
                    <tr>
                      <th className="text-left pb-2">Maker</th>
                      <th className="text-right pb-2">Above</th>
                      <th className="text-right pb-2">Below</th>
                      <th className="text-right pb-2">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dryRunResult.details.map((d) => (
                      <tr key={d.maker} className="border-t border-[#1a1a1a]">
                        <td className="py-1.5 text-[#e5e5e5]">{d.maker}</td>
                        <td className="py-1.5 text-right text-[#ff4500]">{d.above_count ?? "—"}</td>
                        <td className="py-1.5 text-right text-cyan-400">{d.below_count ?? "—"}</td>
                        <td className="py-1.5 text-right text-[#737373]">{d.would_send_to || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="font-mono text-xs text-[#a3a3a3]">
              <strong className="text-cyan-400">{dryRunResult.status}</strong>
              {dryRunResult.reason ? ` — ${dryRunResult.reason}` : ""}
              {typeof dryRunResult.comparisons_scanned === "number" && (
                <> · scanned {dryRunResult.comparisons_scanned} recent comparison(s).</>
              )}
            </p>
          )}
        </div>
      )}

      {/* Week-over-week history */}
      <div data-testid="pricing-digest-history">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373] mb-2">
          ◆ Last {history?.weeks?.length || 0} weeks
        </p>
        {historyLoading && (
          <p className="font-mono text-xs text-[#525252] py-4">Loading history…</p>
        )}
        {!historyLoading && (!history || history.weeks.length === 0) && (
          <p className="font-mono text-xs text-[#525252] py-4">
            No digests sent yet — the cron will fire Mondays at 15:00 UTC.
          </p>
        )}
        {!historyLoading && history?.weeks?.length > 0 && (
          <table className="w-full font-mono text-[11px] border border-[#262626]">
            <thead className="text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] bg-[#171717]">
              <tr>
                <th className="text-left p-3">Week</th>
                <th className="text-right p-3">Sent</th>
                <th className="text-right p-3">
                  <span className="inline-flex items-center gap-1 text-[#ff4500]">
                    <TrendingUp size={10} /> Above
                  </span>
                </th>
                <th className="text-right p-3">
                  <span className="inline-flex items-center gap-1 text-cyan-400">
                    <TrendingDown size={10} /> Below
                  </span>
                </th>
                <th className="text-left p-3">Top makers</th>
              </tr>
            </thead>
            <tbody>
              {history.weeks.map((w) => (
                <tr key={w.week_key} className="border-t border-[#1a1a1a]" data-testid={`pricing-digest-week-${w.week_key}`}>
                  <td className="p-3 text-[#e5e5e5]">{w.week_key}</td>
                  <td className="p-3 text-right text-[#e5e5e5]">{w.sent}</td>
                  <td className="p-3 text-right text-[#ff4500] font-bold">{w.above_flagged}</td>
                  <td className="p-3 text-right text-cyan-400 font-bold">{w.below_flagged}</td>
                  <td className="p-3 text-[#a3a3a3] text-[10px]">
                    {(w.top_makers || []).slice(0, 3).map((m, i) => (
                      <span key={m.maker_slug}>
                        {i > 0 ? " · " : ""}
                        <span className="text-[#e5e5e5]">{m.maker_slug}</span>
                        <span className="text-[#525252]"> ({m.flagged})</span>
                      </span>
                    ))}
                    {(w.top_makers || []).length === 0 && <span className="text-[#525252]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, accent }) {
  const color = accent === "cyan" ? "text-cyan-300" : "text-[#e5e5e5]";
  return (
    <div className="border border-[#262626] p-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#737373]">{label}</div>
      <div className={`font-display text-2xl mt-1 ${color}`}>{value ?? "—"}</div>
    </div>
  );
}
