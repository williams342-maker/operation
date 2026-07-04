/*
 * TopSearches widget (iter420) — top-live search queries (not just
 * zero-result). Complements RecruitmentOpportunities.
 * Data: GET /api/admin/command/top-searches
 */
import { useState } from "react";
import { WidgetShell, useAdminFetch, registerWidget } from "./framework";

export function TopSearches() {
  const [win, setWin] = useState(24);
  const { data, loading, error, refresh } = useAdminFetch(
    `/api/admin/command/top-searches?window_hours=${win}&limit=10`,
    { autoRefreshMs: 60_000 },
  );
  return (
    <WidgetShell
      eyebrow="Commerce · Intent"
      title="Top Search Terms"
      loading={loading}
      error={error}
      onRefresh={refresh}
      refreshMs={60_000}
      testId="widget-top-searches"
      actions={
        <div className="flex gap-1">
          {[1, 24, 168].map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setWin(h)}
              className={`font-mono text-[9px] uppercase tracking-[0.22em] px-2 py-1 border ${
                win === h ? "border-brand text-brand" : "border-line text-ink-muted"
              }`}
              data-testid={`top-searches-win-${h}`}
            >
              {h === 1 ? "1h" : h === 24 ? "24h" : "7d"}
            </button>
          ))}
        </div>
      }
    >
      {data && (
        data.rows.length === 0 ? (
          <p className="font-mono text-xs text-ink-muted" data-testid="top-searches-empty">
            No searches in the last {win}h.
          </p>
        ) : (
          <ul className="divide-y divide-line" data-testid="top-searches-list">
            {data.rows.map((r) => {
              const isDead = r.zero_result_share >= 0.5;
              return (
                <li
                  key={r.normalized_query}
                  className={`py-2 grid grid-cols-[1fr_auto_auto_auto] gap-3 items-baseline ${
                    isDead ? "text-red-400" : "text-ink"
                  }`}
                  data-testid={`top-search-${r.normalized_query}`}
                >
                  <span className="font-mono text-sm truncate" title={r.latest_query}>
                    {r.latest_query || r.normalized_query}
                    {isDead && (
                      <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.2em]">
                        ◆ no results
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] text-ink-muted">×{r.count}</span>
                  <span className="font-mono text-[10px] text-ink-muted min-w-[3rem] text-right">
                    {(r.ctr * 100).toFixed(0)}% CTR
                  </span>
                  <span className="font-mono text-[10px] text-ink-muted min-w-[4rem] text-right">
                    {r.result_count_last} hits
                  </span>
                </li>
              );
            })}
          </ul>
        )
      )}
      <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
        All searches, ranked by volume. Red rows return no results — cross-check with Recruitment Opportunities.
      </p>
    </WidgetShell>
  );
}

registerWidget("TopSearches", { component: TopSearches });
