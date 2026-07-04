/*
 * FounderOperations widget (iter419) — reuses iter418 endpoint.
 * Data: GET /api/admin/founders/slots-detail
 */
import { WidgetShell, useAdminFetch, registerWidget } from "./framework";
import { Link } from "react-router-dom";

export function FounderOperations() {
  const { data, loading, error, refresh } = useAdminFetch("/api/admin/founders/slots-detail", { autoRefreshMs: 60_000 });
  return (
    <WidgetShell
      eyebrow="Command · Founders"
      title="Founder Operations"
      loading={loading}
      error={error}
      onRefresh={refresh}
      refreshMs={60_000}
      testId="widget-founder-ops"
      actions={
        <Link
          to="/admin/dashboard?tab=founder-review"
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand px-2 py-1 border border-line"
          data-testid="widget-founder-ops-review"
        >
          Review →
        </Link>
      }
    >
      {data && (
        <div className="space-y-4">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-4xl text-ink" data-testid="founder-ops-active">
              {data.active}
            </span>
            <span className="font-mono text-sm text-ink-muted">/ {data.cap} active founders</span>
          </div>
          <div className="grid grid-cols-3 gap-3" data-testid="founder-ops-breakdown">
            <div className="border border-line p-2 text-center">
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">Needs Review</div>
              <div className={`font-display text-xl ${data.needs_review > 0 ? "text-amber-500" : "text-ink"}`}>
                {data.needs_review}
              </div>
            </div>
            <div className="border border-line p-2 text-center">
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">Slots Available</div>
              <div className="font-display text-xl text-ink">{Math.max(0, data.cap - data.active)}</div>
            </div>
            <div className="border border-line p-2 text-center">
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">Applications</div>
              <div
                className={`font-mono text-[10px] uppercase tracking-[0.18em] mt-1 ${
                  data.applications_open ? "text-emerald-500" : "text-amber-500"
                }`}
              >
                {data.applications_open ? "Open" : "Closed"}
              </div>
            </div>
          </div>
        </div>
      )}
    </WidgetShell>
  );
}

registerWidget("FounderOperations", { component: FounderOperations });
