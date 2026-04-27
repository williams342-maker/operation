import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { LineChart } from "lucide-react";
import { fetchAdminCohorts } from "../../lib/api";
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
      <EmptyState
        icon={LineChart}
        eyebrow="◆ Cohort Retention"
        title="No buyer cohorts yet."
        body="Once buyers start placing paid orders, this view will plot weekly cohorts and show what % return in subsequent weeks. Empty until your first paid order."
        testId="retention-empty"
      />
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
    </div>
  );
}
