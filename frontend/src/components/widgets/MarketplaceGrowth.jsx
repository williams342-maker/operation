/*
 * MarketplaceGrowth widget (iter419)
 * Data: GET /api/admin/command/growth
 */
import { WidgetShell, useAdminFetch, registerWidget } from "./framework";

function fmtDelta(delta, unit) {
  if (delta == null) return "";
  const sign = delta > 0 ? "+" : delta < 0 ? "" : "±";
  if (unit === "currency") return ` ${sign}$${Math.abs(delta).toFixed(0)}`;
  if (unit === "percent") return ` ${sign}${delta.toFixed(2)}%`;
  return ` ${sign}${delta}`;
}

function fmtValue(v, unit) {
  if (unit === "currency") return `$${Number(v).toFixed(0)}`;
  if (unit === "percent") return `${Number(v).toFixed(2)}%`;
  return String(v);
}

export function MarketplaceGrowth() {
  const { data, loading, error, refresh } = useAdminFetch("/api/admin/command/growth", { autoRefreshMs: 60_000 });
  return (
    <WidgetShell
      eyebrow="Command · Growth"
      title="Marketplace Growth · Today"
      loading={loading}
      error={error}
      onRefresh={refresh}
      refreshMs={60_000}
      testId="widget-growth"
    >
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="growth-metrics">
            {data.metrics.map((m) => {
              const positive = (m.delta_vs_yesterday || 0) >= 0;
              return (
                <div
                  key={m.key}
                  className="border border-line p-3 bg-paper"
                  data-testid={`growth-${m.key}`}
                >
                  <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-ink-muted mb-1">
                    {m.label}
                  </div>
                  <div className="font-display text-2xl text-ink">{fmtValue(m.value_today, m.unit)}</div>
                  <div
                    className={`font-mono text-[10px] mt-1 ${
                      m.delta_vs_yesterday === 0 ? "text-ink-muted" : positive ? "text-emerald-500" : "text-red-400"
                    }`}
                  >
                    vs yday{fmtDelta(m.delta_vs_yesterday, m.unit)}
                  </div>
                </div>
              );
            })}
          </div>

          {data.categories && data.categories.length > 0 && (
            <div className="mt-5 pt-4 border-t border-line" data-testid="growth-categories">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
                Category Growth · today
              </div>
              <ul className="space-y-1">
                {data.categories.map((c) => (
                  <li
                    key={c.category}
                    className="flex items-center justify-between gap-3 font-mono text-xs"
                    data-testid={`growth-category-${c.category}`}
                  >
                    <span className="text-ink">{c.category}</span>
                    <span className="text-brand">+{c.listings_added_today}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </WidgetShell>
  );
}

registerWidget("MarketplaceGrowth", { component: MarketplaceGrowth });
