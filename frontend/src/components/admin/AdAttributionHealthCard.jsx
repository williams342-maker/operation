/**
 * iter335.10 — Ad Attribution Health card.
 *
 * One-glance pipeline diagnostic on the Admin → Ads tab:
 *   • % of last-7-day paid sessions that have at least one click ID
 *   • Per-channel: paid sessions w/ click ID → conversions uploaded
 *   • Replay backlog (distinct session_ids still in `err:` state)
 *
 * Backed by `/api/admin/ads/attribution-health`. Refreshes on-demand
 * via the refresh button; no auto-poll (data only changes when new
 * orders come in).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, ShieldCheck, AlertTriangle, History } from "lucide-react";
import { fetchAdAttributionHealth } from "../../lib/api";

const CHANNEL_LABEL = { google: "Google Ads", meta: "Meta", microsoft: "Microsoft" };

const fmtPct = (v) => v == null ? "—" : `${v.toFixed ? v.toFixed(1) : v}%`;
const fmtInt = (v) => (v ?? 0).toLocaleString();

function rateTone(rate) {
  if (rate == null) return "text-[#737373]";
  if (rate >= 95) return "text-emerald-400";
  if (rate >= 80) return "text-amber-300";
  return "text-red-300";
}

export default function AdAttributionHealthCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      setData(await fetchAdAttributionHealth());
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load attribution health.");
    } finally { setBusy(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (!data) {
    return (
      <div className="border border-[#262626] bg-[#0a0a0a] p-5" data-testid="ad-attribution-health-card">
        <div className="flex items-center gap-2 text-[#a3a3a3] font-mono text-[10px] uppercase tracking-[0.22em]">
          <ShieldCheck size={12} /> Ad attribution health
        </div>
        <div className="mt-3 text-xs text-[#737373] flex items-center gap-2">
          {busy ? <><Loader2 size={11} className="animate-spin" /> Loading…</> : "—"}
        </div>
      </div>
    );
  }

  const coverage = data.click_id_coverage_pct;
  const backlog = data.replay_backlog || 0;

  return (
    <div className="border border-[#262626] bg-[#0a0a0a] p-5" data-testid="ad-attribution-health-card">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <div className="flex items-center gap-2 text-[#a3a3a3] font-mono text-[10px] uppercase tracking-[0.22em]">
            <ShieldCheck size={12} /> Ad attribution health
            <span className="text-[#525252]">· last {data.window_days}d</span>
          </div>
          <div className="font-mono text-[9px] text-[#525252] mt-0.5">
            as of {(data.as_of || "").slice(0, 16).replace("T", " ")} UTC
          </div>
        </div>
        <button
          onClick={load}
          disabled={busy}
          className="px-3 py-1.5 border border-[#262626] hover:border-cyan-400 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
          data-testid="ad-attribution-health-refresh"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Refresh
        </button>
      </header>

      {/* Top-line coverage */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="border border-[#1f1f1f] p-3" data-testid="health-stat-coverage">
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#737373]">Click-ID coverage</div>
          <div className={`font-display text-3xl mt-1 ${rateTone(coverage)}`}>
            {fmtPct(coverage)}
          </div>
          <div className="font-mono text-[10px] text-[#737373] mt-1 tabular-nums">
            {fmtInt(data.sessions_with_click_id)} / {fmtInt(data.paid_sessions)} paid
          </div>
        </div>
        <div className="border border-[#1f1f1f] p-3" data-testid="health-stat-paid">
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#737373]">Paid sessions</div>
          <div className="font-display text-3xl mt-1 text-[#f5f5f5]">{fmtInt(data.paid_sessions)}</div>
          <div className="font-mono text-[10px] text-[#737373] mt-1">last {data.window_days} days</div>
        </div>
        <div className={`border ${backlog > 0 ? "border-amber-900/50 bg-amber-950/20" : "border-[#1f1f1f]"} p-3`} data-testid="health-stat-backlog">
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#737373] flex items-center gap-1">
            <History size={10} /> Replay backlog
          </div>
          <div className={`font-display text-3xl mt-1 ${backlog > 0 ? "text-amber-300" : "text-[#737373]"}`}>
            {fmtInt(backlog)}
          </div>
          <div className="font-mono text-[10px] text-[#737373] mt-1">
            {backlog > 0 ? "errored uploads · auto-retried 05:30 UTC" : "all uploads landed cleanly"}
          </div>
        </div>
      </div>

      {/* Per-channel breakdown */}
      <table className="w-full text-xs mt-5">
        <thead>
          <tr className="border-b border-[#262626] font-mono text-[9px] uppercase tracking-[0.22em] text-[#737373]">
            <th className="text-left py-1.5">Channel</th>
            <th className="text-right py-1.5">Paid w/ click ID</th>
            <th className="text-right py-1.5">Uploaded</th>
            <th className="text-right py-1.5">Errored</th>
            <th className="text-right py-1.5">Pending</th>
            <th className="text-right py-1.5">Rate</th>
          </tr>
        </thead>
        <tbody>
          {data.by_channel.map((row) => (
            <tr key={row.channel} className="border-b border-[#1f1f1f]" data-testid={`health-row-${row.channel}`}>
              <td className="py-2 text-[#f5f5f5] capitalize">{CHANNEL_LABEL[row.channel] || row.channel}</td>
              <td className="py-2 text-right font-mono text-[#a3a3a3] tabular-nums">{fmtInt(row.paid_with_click_id)}</td>
              <td className="py-2 text-right font-mono text-emerald-400 tabular-nums">{fmtInt(row.uploaded_ok)}</td>
              <td className={`py-2 text-right font-mono tabular-nums ${row.uploaded_err > 0 ? "text-red-300" : "text-[#737373]"}`}>
                {fmtInt(row.uploaded_err)}
              </td>
              <td className={`py-2 text-right font-mono tabular-nums ${row.pending > 0 ? "text-amber-300" : "text-[#737373]"}`}>
                {fmtInt(row.pending)}
              </td>
              <td className={`py-2 text-right font-mono font-semibold tabular-nums ${rateTone(row.upload_rate_pct)}`}>
                {fmtPct(row.upload_rate_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {backlog > 0 && (
        <div className="mt-4 text-[10px] text-amber-300 flex items-start gap-2 border-l-2 border-amber-700/50 pl-3 py-1">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>
            {backlog} session{backlog === 1 ? "" : "s"} stuck in <span className="font-mono">err:</span> state.
            The daily 05:30 UTC replay cron will retry; if backlog persists 48h+, check the channel&apos;s API status or env config.
          </span>
        </div>
      )}
    </div>
  );
}
