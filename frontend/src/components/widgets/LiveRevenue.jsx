/*
 * LiveRevenue widget (iter420)
 * Data: GET /api/admin/command/live-revenue
 */
import { WidgetShell, useAdminFetch, registerWidget } from "./framework";

function money(n) { return `$${Number(n || 0).toFixed(0)}`; }

function Spark({ values }) {
  if (!values || values.length === 0) return null;
  const max = Math.max(1, ...values);
  return (
    <svg viewBox="0 0 240 30" className="w-full h-8 mt-2" aria-hidden data-testid="live-revenue-spark">
      {values.map((v, i) => {
        const h = Math.round((v / max) * 26);
        const x = i * 10 + 1;
        return (
          <rect
            key={i}
            x={x} y={30 - h} width={8} height={Math.max(1, h)}
            className="fill-brand/60"
          />
        );
      })}
    </svg>
  );
}

export function LiveRevenue() {
  const { data, loading, error, refresh } = useAdminFetch("/api/admin/command/live-revenue", { autoRefreshMs: 30_000 });
  return (
    <WidgetShell
      eyebrow="Commerce · Live"
      title="Live Revenue"
      loading={loading}
      error={error}
      onRefresh={refresh}
      refreshMs={30_000}
      testId="widget-live-revenue"
    >
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[data.last_15m, data.last_60m, data.today].map((b, i) => (
              <div key={i} className="border border-line p-2 bg-paper" data-testid={`live-rev-b${i}`}>
                <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">{b.label}</div>
                <div className="font-display text-xl text-ink">{money(b.revenue)}</div>
                <div className="font-mono text-[10px] text-ink-muted">{b.orders} order{b.orders === 1 ? "" : "s"}</div>
              </div>
            ))}
          </div>
          <div className="flex items-baseline gap-2 pt-2 border-t border-line">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Live conversion</div>
            <div className="font-display text-lg text-brand" data-testid="live-rev-conv">
              {data.live_conversion_rate.toFixed(2)}%
            </div>
            <div className="font-mono text-[10px] text-ink-muted ml-auto">last hour</div>
          </div>
          <Spark values={data.hourly_sparkline} />
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">Revenue · past 24h</div>
        </div>
      )}
    </WidgetShell>
  );
}

registerWidget("LiveRevenue", { component: LiveRevenue });
