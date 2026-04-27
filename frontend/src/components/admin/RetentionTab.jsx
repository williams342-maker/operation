import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { LineChart, Send, RefreshCw, Mail } from "lucide-react";
import {
  fetchAdminCohorts, fetchDormantBuyers, reengageDormantBuyers,
} from "../../lib/api";
import { Stat } from "./_shared";
import { StatsSkeleton, RowsSkeleton } from "../Skeleton";
import EmptyState from "../EmptyState";

/**
 * Heat-map color from cohort-retention percentage. We bucket so the eye
 * can scan the matrix quickly without staring at exact numbers.
 */
function heatBg(pct) {
  if (pct >= 80) return "#ff4500";
  if (pct >= 50) return "#ff4500cc";
  if (pct >= 30) return "#ff4500aa";
  if (pct >= 15) return "#ff45007a";
  if (pct >= 5)  return "#ff450055";
  if (pct > 0)   return "#ff450033";
  return "transparent";
}
function heatTxt(pct) {
  return pct >= 50 ? "#0a0a0a" : "#e5e5e5";
}

export default function RetentionTab() {
  const [data, setData] = useState(null);
  const [weeks, setWeeks] = useState(12);
  const [loading, setLoading] = useState(true);

  const load = async (n = weeks) => {
    setLoading(true);
    try {
      setData(await fetchAdminCohorts(n));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load cohorts.");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(weeks); /* eslint-disable-next-line */ }, [weeks]);

  const rows = data?.rows || [];

  // Average per column for the bottom summary row
  const colAverages = useMemo(() => {
    if (!rows.length) return [];
    const cols = (rows[0]?.cells || []).map(() => ({ sum: 0, n: 0 }));
    rows.forEach((r) => {
      r.cells.forEach((c, i) => {
        if (cols[i]) { cols[i].sum += c.pct; cols[i].n += 1; }
      });
    });
    return cols.map((c) => (c.n ? +(c.sum / c.n).toFixed(1) : 0));
  }, [rows]);

  if (loading && !data) {
    return (
      <div className="space-y-6" data-testid="retention-loading">
        <StatsSkeleton count={3} />
        <RowsSkeleton count={6} />
      </div>
    );
  }

  if (!data || rows.length === 0) {
    return (
      <div className="space-y-12" data-testid="retention-tab">
        <EmptyState
          icon={LineChart}
          eyebrow="◆ Cohort Retention"
          title="No buyer cohorts yet."
          body="Once buyers start placing paid orders, this view will plot weekly cohorts and show what % return in subsequent weeks. Empty until your first paid order."
          testId="retention-empty"
        />
        <DormantBuyersPanel />
      </div>
    );
  }

  const repeatPct = data.total_buyers
    ? Math.round((100 * data.total_repeat_buyers) / data.total_buyers)
    : 0;

  return (
    <div className="space-y-8" data-testid="retention-tab">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-6">
        <Stat label="Total Buyers" value={data.total_buyers} testId="retention-stat-buyers" />
        <Stat label="Repeat Buyers" value={data.total_repeat_buyers} testId="retention-stat-repeat" />
        <Stat label="Repeat %" value={`${repeatPct}%`} testId="retention-stat-repeat-pct" />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-1">
            ◆ Cohort retention
          </div>
          <div className="font-display text-3xl tracking-[-0.005em]">
            Who comes back?
          </div>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-[60ch] leading-relaxed">
            Each row is a buyer cohort grouped by their first-purchase week.
            Each column shows what % of that cohort placed another paid order
            in week +N. A "10" in column W+4 means 10% of that cohort came
            back four weeks later.
          </p>
        </div>
        <select
          value={weeks}
          onChange={(e) => setWeeks(parseInt(e.target.value, 10))}
          className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
          data-testid="retention-weeks"
        >
          {[8, 12, 16, 20, 26].map((n) => (
            <option key={n} value={n}>{`Last ${n} weeks`}</option>
          ))}
        </select>
      </div>

      <div className="border border-[#262626] overflow-x-auto" data-testid="retention-grid">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-[#262626] bg-[#0f0f0f]">
              <th className="text-left p-3 text-[#a3a3a3] uppercase tracking-[0.22em] text-[10px] sticky left-0 bg-[#0f0f0f]">
                Cohort
              </th>
              <th className="p-3 text-[#a3a3a3] uppercase tracking-[0.22em] text-[10px]">Size</th>
              {(rows[0]?.cells || []).map((_, i) => (
                <th key={i} className="p-2 text-[#525252] tracking-[0.2em] text-[10px]">W+{i}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cohort} className="border-b border-[#1a1a1a]" data-testid={`retention-row-${r.cohort}`}>
                <td className="p-3 text-[#e5e5e5] sticky left-0 bg-[#0a0a0a]">{r.cohort}</td>
                <td className="p-3 text-center text-[#a3a3a3]">{r.size}</td>
                {r.cells.map((c, i) => (
                  <td
                    key={i}
                    className="p-2 text-center"
                    style={{ background: heatBg(c.pct), color: heatTxt(c.pct) }}
                    title={`${c.count} of ${r.size} (${c.pct}%) — week +${c.week_offset}`}
                  >
                    {c.pct === 0 ? "—" : `${c.pct}%`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {colAverages.length > 0 && (
            <tfoot>
              <tr className="border-t border-[#262626] bg-[#0f0f0f]">
                <td className="p-3 text-[10px] uppercase tracking-[0.22em] text-[#ff4500] sticky left-0 bg-[#0f0f0f]">
                  Average
                </td>
                <td />
                {colAverages.map((avg, i) => (
                  <td key={i} className="p-2 text-center text-[10px] text-[#a3a3a3]" data-testid={`retention-avg-${i}`}>
                    {avg ? `${avg}%` : "—"}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
        ◆ W+0 is always 100% by definition (cohort = first purchase week).
        ◆ Empty cells mean no orders in that week from this cohort.
        ◆ Heatmap colour scales with retention % — orange brighter = stickier cohort.
      </p>

      <DormantBuyersPanel />
    </div>
  );
}

// ─────────────────────── Dormant Buyer Re-engagement ───────────────────────
function DormantBuyersPanel() {
  const [days, setDays] = useState(60);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [scanning, setScanning] = useState(false);
  const [sending, setSending] = useState(false);
  const [pct, setPct] = useState(15);
  const [expiry, setExpiry] = useState(21);
  const [scanned, setScanned] = useState(false);

  const scan = async () => {
    setScanning(true);
    try {
      const r = await fetchDormantBuyers(days);
      setRows(r.buyers || []);
      setSelected(new Set());
      setScanned(true);
      toast.success(`${r.count} dormant buyer${r.count === 1 ? "" : "s"} found.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Scan failed.");
    } finally {
      setScanning(false);
    }
  };

  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.email)));
  };
  const toggleOne = (email) => {
    const s = new Set(selected);
    if (s.has(email)) s.delete(email); else s.add(email);
    setSelected(s);
  };

  const send = async () => {
    if (!selected.size) {
      toast.error("Select at least one buyer.");
      return;
    }
    if (!window.confirm(`Send a ${pct}% off code (expires in ${expiry} days) to ${selected.size} buyer${selected.size === 1 ? "" : "s"}?`)) {
      return;
    }
    setSending(true);
    try {
      const r = await reengageDormantBuyers({
        emails: Array.from(selected),
        discount_pct: pct,
        expires_in_days: expiry,
      });
      toast.success(`Sent ${r.sent}${r.skipped ? ` · ${r.skipped} skipped (24h cooldown)` : ""}.`);
      setSelected(new Set());
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-[#262626] pt-12 mt-12" data-testid="dormant-panel">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-1">◆ Win-back</div>
          <h2 className="font-display text-3xl uppercase">Dormant Buyers.</h2>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-[60ch] leading-relaxed">
            Buyers who placed at least one paid order in the past year but have gone quiet.
            Send each one a one-time site-wide discount code; they're tagged in Kit.com automatically.
            24h cooldown so we never email the same buyer twice in a day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Dormant for</label>
          <select
            value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
            data-testid="dormant-days"
          >
            {[30, 60, 90, 120, 180, 365].map((n) => (
              <option key={n} value={n}>{n}+ days</option>
            ))}
          </select>
          <button
            onClick={scan} disabled={scanning}
            className="px-3 py-2 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500]/10 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="dormant-scan-btn"
          >
            <RefreshCw size={12} className={scanning ? "animate-spin" : ""} /> Scan
          </button>
        </div>
      </div>

      {scanned && rows.length === 0 ? (
        <div className="border border-dashed border-[#262626] p-12 text-center" data-testid="dormant-empty">
          <Mail size={32} className="text-[#404040] mx-auto mb-3" />
          <p className="font-mono text-xs text-[#737373]">
            No dormant buyers in the {days}-day window. Either everyone's still active, or there are no paid orders past that threshold yet.
          </p>
        </div>
      ) : !scanned ? (
        <div className="border border-dashed border-[#262626] p-10 text-center font-mono text-xs text-[#737373]" data-testid="dormant-prompt">
          Click <span className="text-[#ff4500]">Scan</span> to find dormant buyers.
        </div>
      ) : (
        <>
          <div className="border border-[#262626]" data-testid="dormant-table">
            <div className="grid grid-cols-[40px_1fr_140px_100px_120px] gap-3 px-4 py-3 border-b border-[#262626] bg-[#0f0f0f] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] items-center">
              <div>
                <input
                  type="checkbox" checked={selected.size === rows.length && rows.length > 0}
                  onChange={toggleAll} className="accent-[#ff4500]"
                  data-testid="dormant-select-all"
                />
              </div>
              <div>Email</div>
              <div>Last order</div>
              <div className="text-right">Orders</div>
              <div className="text-right">LTV</div>
            </div>
            {rows.map((r) => {
              const lastDate = r.last_order_at ? new Date(r.last_order_at) : null;
              return (
                <div key={r.email} className="grid grid-cols-[40px_1fr_140px_100px_120px] gap-3 px-4 py-3 border-b border-[#1a1a1a] items-center" data-testid={`dormant-row-${r.email}`}>
                  <div>
                    <input
                      type="checkbox" checked={selected.has(r.email)}
                      onChange={() => toggleOne(r.email)} className="accent-[#ff4500]"
                    />
                  </div>
                  <div className="font-mono text-xs text-[#e5e5e5] truncate">{r.email}</div>
                  <div className="font-mono text-[11px] text-[#a3a3a3]">
                    {lastDate ? lastDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </div>
                  <div className="font-mono text-[11px] text-[#a3a3a3] text-right">{r.total_orders}</div>
                  <div className="font-mono text-[11px] text-[#ff4500] text-right">${r.lifetime_value.toFixed(0)}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 border border-[#ff4500]/40 bg-[#ff4500]/5 p-5 grid md:grid-cols-[1fr_auto] gap-4 items-center" data-testid="dormant-send-bar">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="font-mono text-xs text-[#e5e5e5]">
                <strong className="text-[#ff4500]">{selected.size}</strong> selected
              </div>
              <div className="flex items-center gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Discount</label>
                <select
                  value={pct} onChange={(e) => setPct(parseInt(e.target.value, 10))}
                  className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-2 py-1 font-mono text-xs"
                  data-testid="dormant-pct"
                >
                  {[10, 15, 20, 25, 30].map((n) => <option key={n} value={n}>{n}%</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Expires</label>
                <select
                  value={expiry} onChange={(e) => setExpiry(parseInt(e.target.value, 10))}
                  className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-2 py-1 font-mono text-xs"
                  data-testid="dormant-expiry"
                >
                  {[7, 14, 21, 30, 45, 60].map((n) => <option key={n} value={n}>{n} days</option>)}
                </select>
              </div>
            </div>
            <button
              onClick={send} disabled={sending || !selected.size}
              className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="dormant-send-btn"
            >
              <Send size={14} /> {sending ? "Sending…" : `Send ${pct}% code`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
