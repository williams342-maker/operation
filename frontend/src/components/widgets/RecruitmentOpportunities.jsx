/*
 * RecruitmentOpportunities widget (iter419)
 * Data: GET /api/admin/command/recruitment  (compact — reads
 *       the same zero-result search stream instrumented in iter419)
 */
import { useState } from "react";
import { WidgetShell, useAdminFetch, registerWidget } from "./framework";
import { toast } from "sonner";

const API = process.env.REACT_APP_BACKEND_URL;

function fmtRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function RecruitmentOpportunities() {
  const [window, setWindow] = useState(7);
  const { data, loading, error, refresh } = useAdminFetch(
    `/api/admin/command/recruitment?window_days=${window}&limit=10`,
    { autoRefreshMs: 120_000 },
  );

  async function annotate(nq, action) {
    try {
      const tok = localStorage.getItem("cm_admin_jwt") || "";
      const r = await fetch(`${API}/api/admin/search/annotate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ normalized_query: nq, action }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success(`Marked "${nq}" (${action})`);
      refresh();
    } catch (e) {
      toast.error(`Annotate failed: ${e.message}`);
    }
  }

  return (
    <WidgetShell
      eyebrow="Command · Demand"
      title="Recruitment Opportunities"
      loading={loading}
      error={error}
      onRefresh={refresh}
      refreshMs={120_000}
      testId="widget-recruitment"
      actions={
        <div className="flex gap-1">
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setWindow(d)}
              className={`font-mono text-[9px] uppercase tracking-[0.22em] px-2 py-1 border ${
                window === d ? "border-brand text-brand" : "border-line text-ink-muted"
              }`}
              data-testid={`recruit-window-${d}`}
            >
              {d}d
            </button>
          ))}
        </div>
      }
    >
      {data && (
        data.rows.length === 0 ? (
          <p className="font-mono text-xs text-ink-muted" data-testid="recruitment-empty">
            No zero-result searches in the last {window}d. Once buyers search for
            things you don&rsquo;t carry, they surface here.
          </p>
        ) : (
          <>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted mb-3">
              Buyer searches with zero results — your product roadmap in real time.
            </p>
            <ul className="divide-y divide-line" data-testid="recruitment-list">
              {data.rows.map((r) => (
                <li
                  key={r.normalized_query}
                  className="py-2 flex items-center justify-between gap-3"
                  data-testid={`recruit-row-${r.normalized_query}`}
                >
                  <div className="min-w-0">
                    <div className="font-mono text-sm text-ink truncate">
                      {r.latest_query || r.normalized_query}
                      {r.marked_opportunity && (
                        <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.2em] text-brand">
                          ◆ opportunity
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-ink-muted">
                      {r.count} search{r.count === 1 ? "" : "es"} · last {fmtRelative(r.last_searched_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!r.marked_opportunity && (
                      <button
                        type="button"
                        onClick={() => annotate(r.normalized_query, "mark_opportunity")}
                        className="font-mono text-[9px] uppercase tracking-[0.2em] px-2 py-1 border border-brand text-brand hover:bg-brand hover:text-white"
                        title="Flag for maker recruitment outreach"
                        data-testid={`recruit-mark-${r.normalized_query}`}
                      >
                        Recruit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => annotate(r.normalized_query, "hide")}
                      className="font-mono text-[9px] uppercase tracking-[0.2em] px-2 py-1 border border-line text-ink-muted hover:border-red-400 hover:text-red-400"
                      title="Hide from the queue (typos / bad queries)"
                      data-testid={`recruit-hide-${r.normalized_query}`}
                    >
                      Hide
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )
      )}
    </WidgetShell>
  );
}

registerWidget("RecruitmentOpportunities", { component: RecruitmentOpportunities });
