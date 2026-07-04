/*
 * TrendingProducts widget (iter420)
 * Data: GET /api/admin/command/trending-products
 */
import { WidgetShell, useAdminFetch, registerWidget } from "./framework";
import { Link } from "react-router-dom";

export function TrendingProducts() {
  const { data, loading, error, refresh } = useAdminFetch("/api/admin/command/trending-products?limit=8", { autoRefreshMs: 60_000 });
  return (
    <WidgetShell
      eyebrow="Commerce · Momentum"
      title="Trending Products"
      loading={loading}
      error={error}
      onRefresh={refresh}
      refreshMs={60_000}
      testId="widget-trending"
    >
      {data && (
        data.rows.length === 0 ? (
          <p className="font-mono text-xs text-ink-muted" data-testid="trending-empty">
            No products spiking in the last hour.
          </p>
        ) : (
          <ul className="divide-y divide-line" data-testid="trending-list">
            {data.rows.map((r) => {
              const hot = r.velocity >= 3;
              return (
                <li
                  key={r.product_slug}
                  className="py-2 flex items-center justify-between gap-3"
                  data-testid={`trending-${r.product_slug}`}
                >
                  <Link
                    to={`/shop/${r.product_slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 text-ink hover:text-brand truncate font-mono text-sm"
                    title={r.title}
                  >
                    {r.title || r.product_slug}
                  </Link>
                  <div className="flex items-baseline gap-2 flex-shrink-0">
                    <span className="font-mono text-[10px] text-ink-muted">
                      {r.views_last_hour} view{r.views_last_hour === 1 ? "" : "s"}/hr
                    </span>
                    <span
                      className={`font-mono text-[11px] font-bold ${hot ? "text-red-400" : "text-brand"}`}
                    >
                      {hot && "🔥 "}×{r.velocity.toFixed(1)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}
      <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
        Velocity = views last hour ÷ 24h hourly average. 🔥 = spiking ≥ 3×.
      </p>
    </WidgetShell>
  );
}

registerWidget("TrendingProducts", { component: TrendingProducts });
