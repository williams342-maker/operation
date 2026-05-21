import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Calendar as CalIcon, RefreshCw, AlertCircle } from "lucide-react";
import { fetchMakerRenewalsSummary } from "../../lib/api";

/**
 * Renewal Summary widget + Calendar widget — both fed by a single
 * GET /api/maker/renewals/summary call so the dashboard takes one
 * round-trip even with both visible.
 *
 * Why combine them in one file? They share the data fetch, both live
 * under the same dashboard section, and neither is large enough to
 * justify its own file. If either grows beyond ~150 lines, split.
 */
export default function RenewalSummary() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMakerRenewalsSummary()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.detail || "Could not load renewal summary."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="grid lg:grid-cols-[1fr_1.4fr] gap-4" data-testid="renewal-summary-loading">
        <div className="border border-[#262626] bg-[#0d0d0d] p-5 animate-pulse">
          <div className="h-3 w-24 bg-[#1a1a1a] mb-2" />
          <div className="h-6 w-32 bg-[#1a1a1a] mb-4" />
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="border border-[#262626] bg-[#0a0a0a] p-3">
                <div className="h-7 w-8 mx-auto bg-[#1a1a1a] mb-2" />
                <div className="h-2 w-12 mx-auto bg-[#1a1a1a]" />
              </div>
            ))}
          </div>
        </div>
        <div className="border border-[#262626] bg-[#0d0d0d] p-5 animate-pulse">
          <div className="h-3 w-24 bg-[#1a1a1a] mb-4" />
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 21 }).map((_, i) => (
              <div key={i} className="aspect-square bg-[#1a1a1a]" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (err) {
    return (
      <div
        className="border border-amber-500/40 bg-amber-500/5 p-5 flex items-start gap-3"
        data-testid="renewal-summary-error"
      >
        <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
        <div className="font-mono text-xs text-amber-200">{err}</div>
      </div>
    );
  }
  if (!data) return null;

  const { counts, calendar } = data;
  const noListings = !counts || (counts.total_auto + counts.total_manual) === 0;

  if (noListings) return null;  // no widget noise when shop is empty

  return (
    <div className="grid lg:grid-cols-[1fr_1.4fr] gap-4" data-testid="renewal-summary">
      <SummaryCard counts={counts} />
      <CalendarWidget calendar={calendar} />
    </div>
  );
}


function SummaryCard({ counts }) {
  return (
    <div className="border border-[#262626] bg-[#0d0d0d] p-5" data-testid="renewal-summary-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500]">◆ Renewals</div>
          <h3 className="font-display text-xl uppercase mt-1">Next 30 days</h3>
        </div>
        <RefreshCw size={16} className="text-[#525252]" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Next 7d", n: counts.next_7d, tone: counts.next_7d > 0 ? "text-[#ff4500]" : "text-[#525252]" },
          { label: "Next 14d", n: counts.next_14d, tone: "text-[#e5e5e5]" },
          { label: "Next 30d", n: counts.next_30d, tone: "text-[#e5e5e5]" },
        ].map((c) => (
          <div key={c.label} className="border border-[#262626] bg-[#0a0a0a] p-3 text-center">
            <div className={`font-display text-3xl ${c.tone}`} data-testid={`renewal-count-${c.label.toLowerCase().replace(/\s+/g,'-')}`}>{c.n}</div>
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-1">
              {c.label}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-[0.22em]">
        <span className="text-[#a3a3a3]">
          <span className="text-emerald-400">●</span> {counts.total_auto} auto-renew
          <span className="mx-2 text-[#262626]">·</span>
          <span className="text-amber-400">●</span> {counts.total_manual} manual
        </span>
        <Link
          to="/maker/renewals"
          className="text-[#ff4500] hover:underline"
          data-testid="renewal-manage-link"
        >
          Manage →
        </Link>
      </div>
    </div>
  );
}


function CalendarWidget({ calendar }) {
  const max = useMemo(() => Math.max(1, ...calendar.map((d) => d.count)), [calendar]);
  // Group into weeks (chunks of 7) for a clean grid
  const weeks = [];
  for (let i = 0; i < calendar.length; i += 7) weeks.push(calendar.slice(i, i + 7));
  const [openDay, setOpenDay] = useState(null);

  return (
    <div className="border border-[#262626] bg-[#0d0d0d] p-5" data-testid="renewal-calendar">
      <div className="flex items-center gap-2 mb-4">
        <CalIcon size={14} className="text-[#ff4500]" />
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500]">◆ Calendar</div>
        <div className="ml-auto font-mono text-[10px] text-[#525252]">next 30 days · click a day</div>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {weeks.flat().map((d) => {
          const intensity = d.count === 0 ? 0 : Math.min(1, d.count / max);
          const dt = new Date(d.date + "T00:00:00");
          const day = dt.getDate();
          const isOpen = openDay === d.date;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setOpenDay(isOpen ? null : (d.count > 0 ? d.date : null))}
              disabled={d.count === 0}
              className={`aspect-square border flex flex-col items-center justify-center transition ${
                d.count === 0
                  ? "border-[#1a1a1a] bg-[#0a0a0a] cursor-default"
                  : isOpen
                  ? "border-[#ff4500] bg-[#ff4500]/20"
                  : "border-[#262626] hover:border-[#ff4500] cursor-pointer"
              }`}
              style={{
                backgroundColor: d.count > 0 && !isOpen
                  ? `rgba(255, 69, 0, ${0.06 + intensity * 0.32})`
                  : undefined,
              }}
              data-testid={`renewal-cal-day-${d.date}`}
              title={d.count === 0 ? `${d.date} — no renewals` : `${d.date} — ${d.count} listing${d.count===1?'':'s'}`}
            >
              <span className={`font-display text-base leading-none ${d.count === 0 ? "text-[#404040]" : "text-[#e5e5e5]"}`}>
                {day}
              </span>
              {d.count > 0 && (
                <span className="font-mono text-[9px] mt-0.5 text-[#ff4500]">{d.count}</span>
              )}
            </button>
          );
        })}
      </div>
      {openDay && (
        <div
          className="mt-4 border border-[#ff4500]/40 bg-[#ff4500]/5 p-3"
          data-testid="renewal-cal-day-detail"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-2">
            ◆ {new Date(openDay + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <ul className="space-y-1">
            {(calendar.find((d) => d.date === openDay)?.listings || []).map((l) => (
              <li key={l.slug} className="font-mono text-xs text-[#e5e5e5]">
                <Link to={`/maker/listings/${l.slug}/edit`} className="hover:text-[#ff4500]">
                  → {l.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
