import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { TrendingUp, RefreshCw, DollarSign } from "lucide-react";
import { fetchMsftRoas, recordMsftAdSpend } from "../../lib/api";

/**
 * iter334l — Microsoft Ads ROAS tile.
 *
 * Pairs the auto-tracked attributed revenue (last-7-day Bing-Ads-tagged
 * paid txns via `msclkid`) with an ops-entered ad spend value to show
 * a real ROAS number — no Microsoft Advertising API OAuth needed.
 *
 * Layout: 4 KPI cells (attributed orders, attributed revenue, ad spend,
 * ROAS) + a small "Update spend" inline form. Stays compact so it can
 * sit alongside other admin tiles in the Analytics tab.
 */
export default function MsftRoasCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [spendInput, setSpendInput] = useState("");
  const [days, setDays] = useState(7);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await fetchMsftRoas(days);
      setData(r);
      setSpendInput(r.ad_spend_usd ? String(r.ad_spend_usd) : "");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load Microsoft Ads ROAS.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [days]);

  const saveSpend = async () => {
    const v = parseFloat(spendInput);
    if (Number.isNaN(v) || v < 0) {
      toast.error("Enter a valid spend amount.");
      return;
    }
    try {
      await recordMsftAdSpend(v, days);
      toast.success(`Microsoft Ads spend recorded: $${v.toFixed(2)}`);
      setEditing(false);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save spend.");
    }
  };

  const roasColor = (() => {
    if (!data?.roas || !data?.ad_spend_usd) return "text-[#a3a3a3]";
    if (data.roas >= 4) return "text-emerald-400";   // 4x+ → strong
    if (data.roas >= 1.5) return "text-cyan-400";    // 1.5x+ → healthy
    if (data.roas >= 1) return "text-amber-400";     // 1x+ → break-even
    return "text-[#ff4500]";                         // <1x → losing money
  })();

  return (
    <div className="border border-[#262626] bg-[#0d0d0d] p-6 space-y-5" data-testid="msft-roas-card">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 border border-cyan-400/40 bg-cyan-400/[0.06] flex items-center justify-center shrink-0">
          <TrendingUp size={16} className="text-cyan-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-2xl md:text-3xl mb-1">Microsoft Ads ROAS</h2>
          <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed max-w-2xl">
            Attributed revenue / ad spend, last {days} days. Revenue auto-tracked via the{" "}
            <code className="text-cyan-300">msclkid</code> URL param on Bing-Ads landings.
            Spend entered manually — copy/paste from your Bing Ads dashboard.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-2.5 py-1.5 border border-[#262626] hover:border-[#525252] text-[#a3a3a3] hover:text-[#e5e5e5] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5 disabled:opacity-40 shrink-0"
          data-testid="msft-roas-refresh"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Window selector */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373]">Window:</span>
        {[7, 14, 30].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-2.5 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
              days === d
                ? "border-cyan-400 text-cyan-300 bg-cyan-400/[0.06]"
                : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
            }`}
            data-testid={`msft-roas-window-${d}`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* KPI grid */}
      <div className="grid sm:grid-cols-4 gap-3" data-testid="msft-roas-kpis">
        <Kpi label="Attributed orders" value={data?.attributed_orders ?? "—"} />
        <Kpi label="Attributed revenue" value={data?.attributed_revenue != null ? `$${data.attributed_revenue.toFixed(2)}` : "—"} />
        <Kpi label="Ad spend" value={data?.ad_spend_usd ? `$${data.ad_spend_usd.toFixed(2)}` : "—"} sub={data?.ad_spend_recorded_at ? `Updated ${new Date(data.ad_spend_recorded_at).toLocaleDateString()}` : "Not recorded"} />
        <Kpi label="ROAS" value={data?.roas != null ? `${data.roas.toFixed(2)}×` : "—"} accent={roasColor} />
      </div>

      {/* Spend editor */}
      <div className="border border-[#262626] bg-[#0a0a0a] px-4 py-3">
        {editing ? (
          <div className="flex items-center gap-3">
            <DollarSign size={14} className="text-[#737373] shrink-0" />
            <input
              type="number"
              step="0.01"
              min="0"
              value={spendInput}
              onChange={(e) => setSpendInput(e.target.value)}
              className="flex-1 bg-[#0a0a0a] border border-[#262626] focus:border-cyan-400 outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
              placeholder={`Bing Ads spend, last ${days} days (USD)`}
              autoFocus
              data-testid="msft-roas-spend-input"
            />
            <button
              onClick={saveSpend}
              className="px-3 py-2 bg-cyan-400 hover:bg-cyan-300 text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] font-bold"
              data-testid="msft-roas-spend-save"
            >
              Save
            </button>
            <button
              onClick={() => { setEditing(false); setSpendInput(data?.ad_spend_usd ? String(data.ad_spend_usd) : ""); }}
              className="px-3 py-2 border border-[#262626] text-[#a3a3a3] hover:text-[#e5e5e5] font-mono text-[10px] uppercase tracking-[0.22em]"
              data-testid="msft-roas-spend-cancel"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] text-[#a3a3a3]">
              {data?.ad_spend_usd
                ? <>Recorded spend: <strong className="text-[#e5e5e5]">${data.ad_spend_usd.toFixed(2)}</strong></>
                : <>No spend recorded yet — enter your Bing Ads {days}-day spend to compute ROAS.</>}
            </p>
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-2 border border-cyan-400/40 hover:border-cyan-300 text-cyan-300 font-mono text-[10px] uppercase tracking-[0.22em]"
              data-testid="msft-roas-spend-edit"
            >
              {data?.ad_spend_usd ? "Update" : "Enter spend"}
            </button>
          </div>
        )}
      </div>

      {/* Sample list */}
      {data?.sample?.length > 0 && (
        <details className="border border-[#262626] bg-[#0a0a0a] px-4 py-3">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#e5e5e5]">
            ◆ Recent attributed orders ({data.sample.length})
          </summary>
          <table className="w-full font-mono text-[10px] mt-2">
            <thead className="text-[9px] uppercase tracking-[0.22em] text-[#737373]">
              <tr>
                <th className="text-left py-2">When</th>
                <th className="text-left py-2">msclkid</th>
                <th className="text-right py-2">Items</th>
                <th className="text-right py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.sample.map((s, i) => (
                <tr key={i} className="border-t border-[#1a1a1a]">
                  <td className="py-1.5 text-[#a3a3a3]">{s.created_at?.slice(0, 16)?.replace("T", " ") || "—"}</td>
                  <td className="py-1.5 text-[#737373]">{s.msclkid}</td>
                  <td className="py-1.5 text-right text-[#a3a3a3]">{s.item_count}</td>
                  <td className="py-1.5 text-right text-[#e5e5e5]">${s.amount.toFixed(2)}</td>
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
    <div className="border border-[#262626] p-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#737373]">{label}</div>
      <div className={`font-display text-2xl mt-1 ${accent || "text-[#e5e5e5]"}`}>{value}</div>
      {sub && <div className="font-mono text-[9px] text-[#525252] mt-1">{sub}</div>}
    </div>
  );
}
