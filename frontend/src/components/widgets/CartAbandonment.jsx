/*
 * CartAbandonment widget (iter420)
 * Data: GET /api/admin/command/cart-abandonment
 */
import { WidgetShell, useAdminFetch, registerWidget } from "./framework";

function money(n) { return `$${Number(n || 0).toFixed(0)}`; }

export function CartAbandonment() {
  const { data, loading, error, refresh } = useAdminFetch("/api/admin/command/cart-abandonment", { autoRefreshMs: 60_000 });
  return (
    <WidgetShell
      eyebrow="Commerce · Recovery"
      title="Cart Abandonment"
      loading={loading}
      error={error}
      onRefresh={refresh}
      refreshMs={60_000}
      testId="widget-cart-abandonment"
    >
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2" data-testid="cart-splits">
            <div className="border border-emerald-600/40 bg-emerald-500/5 p-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-emerald-500">Active</div>
              <div className="font-display text-2xl text-ink">{data.active}</div>
              <div className="font-mono text-[9px] text-ink-muted">&lt; 15 min</div>
            </div>
            <div className="border border-amber-500/50 bg-amber-500/5 p-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-amber-500">Abandoning</div>
              <div className="font-display text-2xl text-ink">{data.abandoning}</div>
              <div className="font-mono text-[9px] text-ink-muted">15–60 min</div>
            </div>
            <div className="border border-red-500/50 bg-red-500/5 p-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-red-400">Abandoned</div>
              <div className="font-display text-2xl text-ink">{data.abandoned}</div>
              <div className="font-mono text-[9px] text-ink-muted">1–24h</div>
            </div>
          </div>
          <div className="flex items-baseline gap-2 pt-2 border-t border-line">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Dollars at risk</div>
            <div className="font-display text-lg text-red-400" data-testid="cart-at-risk">
              {money(data.dollars_at_risk)}
            </div>
          </div>
          {data.top_abandoned_products && data.top_abandoned_products.length > 0 && (
            <div className="pt-2 border-t border-line">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
                Most-abandoned products
              </div>
              <ul className="space-y-1">
                {data.top_abandoned_products.map((p) => (
                  <li key={p.product_slug} className="flex justify-between font-mono text-xs" data-testid={`cart-top-${p.product_slug}`}>
                    <span className="text-ink truncate">{p.title || p.product_slug}</span>
                    <span className="text-red-400">×{p.abandoned_units}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}

registerWidget("CartAbandonment", { component: CartAbandonment });
