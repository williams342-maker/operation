/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState } from "react";
import { fetchShowcaseAnalytics } from "../../lib/api";
import { StatsSkeleton, RowsSkeleton } from "../Skeleton";

// iter117 — Showcase analytics tab.
// Shows top-N showcase posts by views in a configurable rolling window
// (1, 7, or 30 days), with their click count + computed CTR + per-source
// attribution split (home vs. product vs. maker). Closes the loop on
// whether the discovery strip from iter116 is actually pulling its weight.

const WINDOW_OPTIONS = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
];

export default function ShowcaseAnalyticsTab() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const refresh = async (windowDays) => {
    setErr("");
    setData(null);
    try {
      const r = await fetchShowcaseAnalytics({ days: windowDays, limit: 10 });
      setData(r);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Load failed");
    }
  };

  useEffect(() => { refresh(days); }, [days]);

  return (
    <div className="space-y-6" data-testid="admin-showcase-analytics-tab">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl text-ink">Showcase analytics</h2>
          <p className="font-mono text-xs text-ink-muted mt-2 max-w-2xl">
            Top buyer-posted showcases by views in the rolling window, with click
            count and click-through rate. Source split tells you which strip
            placement (homepage vs. product page) is doing the heavy lifting.
          </p>
        </div>
        <div className="flex gap-2" data-testid="showcase-analytics-window">
          {WINDOW_OPTIONS.map((w) => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              data-testid={`showcase-analytics-window-${w.days}d`}
              className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] border transition ${
                days === w.days
                  ? "border-brand text-brand bg-brand/5"
                  : "border-line text-ink-muted hover:border-ink-muted"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </header>

      {err && <div className="font-mono text-sm text-red-400" data-testid="showcase-analytics-err">{err}</div>}
      {!err && !data && (
        <div className="space-y-4" data-testid="showcase-analytics-loading">
          <StatsSkeleton count={3} />
          <RowsSkeleton count={5} />
        </div>
      )}

      {data && (
        <>
          {/* Totals strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="showcase-analytics-totals">
            <DiagStat label={`Views · ${days}d`} value={data.totals.views.toLocaleString()} />
            <DiagStat label={`Clicks · ${days}d`} value={data.totals.clicks.toLocaleString()} />
            <DiagStat
              label="Aggregate CTR"
              value={
                data.totals.views
                  ? `${((data.totals.clicks / data.totals.views) * 100).toFixed(1)}%`
                  : "—"
              }
            />
          </div>

          {/* Per-post leaderboard */}
          {data.rows.length === 0 ? (
            <div className="border border-line p-6 font-mono text-xs text-ink-muted">
              No tracked views in this window yet. Strip impressions start logging
              the moment iter117 ships to prod and a buyer scrolls past one.
            </div>
          ) : (
            <table className="w-full font-mono text-xs" data-testid="showcase-analytics-table">
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th className="text-left pb-2 font-bold uppercase tracking-[0.22em] text-[10px] w-12">#</th>
                  <th className="text-left pb-2 font-bold uppercase tracking-[0.22em] text-[10px]">Post</th>
                  <th className="text-right pb-2 font-bold uppercase tracking-[0.22em] text-[10px]">Views</th>
                  <th className="text-right pb-2 font-bold uppercase tracking-[0.22em] text-[10px]">Clicks</th>
                  <th className="text-right pb-2 font-bold uppercase tracking-[0.22em] text-[10px]">CTR</th>
                  <th className="text-left pb-2 font-bold uppercase tracking-[0.22em] text-[10px]">Source split</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr
                    key={r.post_id}
                    className="border-b border-line hover:bg-paper transition"
                    data-testid={`showcase-analytics-row-${r.post_id}`}
                  >
                    <td className="py-2 pr-2 text-ink-muted">{i + 1}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-3">
                        {r.image_url ? (
                          <img
                            src={r.image_url} alt=""
                            className="w-10 h-10 object-cover border border-line"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-paper border border-line" />
                        )}
                        <div className="min-w-0">
                          <div className="text-ink truncate">{r.title || "(untitled)"}</div>
                          <div className="text-[10px] text-ink-muted truncate">
                            {r.user_name || "buyer"}
                            {r.product_slug ? ` · → ${r.product_slug}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 text-right text-ink font-bold">{r.views.toLocaleString()}</td>
                    <td className="py-2 text-right text-brand font-bold">{r.clicks.toLocaleString()}</td>
                    <td className="py-2 text-right text-ink-muted">{r.ctr}%</td>
                    <td className="py-2 text-ink-muted">
                      {Object.keys(r.by_source).length === 0
                        ? <span className="opacity-50">—</span>
                        : Object.entries(r.by_source)
                            .sort((a, b) => b[1] - a[1])
                            .map(([k, v]) => (
                              <span
                                key={k}
                                className="inline-block mr-2 px-1.5 py-0.5 border border-line text-ink-muted"
                              >
                                {k}: <b className="text-ink">{v}</b>
                              </span>
                            ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function DiagStat({ label, value }) {
  return (
    <div className="border border-line p-3 text-center">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">{label}</div>
      <div className="font-display text-2xl text-ink">{value}</div>
    </div>
  );
}
