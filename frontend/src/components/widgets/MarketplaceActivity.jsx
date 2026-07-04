/*
 * MarketplaceActivity widget (iter419)
 * Data: GET /api/admin/command/activity
 */
import { WidgetShell, useAdminFetch, registerWidget } from "./framework";

const KIND_LABEL = {
  founder_application: "New Founder Application",
  email_verified: "Email Verified",
  maker_approved: "Maker Approved",
  shop_published: "Shop Published",
  product_listed: "New Product Listed",
  first_product_listed: "First Product Listed",
  first_sale: "First Sale for Maker",
  custom_order_brief: "Custom-Order Brief Submitted",
};

const KIND_TINT = {
  founder_application: "text-brand",
  email_verified: "text-emerald-500",
  maker_approved: "text-emerald-500",
  shop_published: "text-emerald-500",
  product_listed: "text-ink",
  first_product_listed: "text-brand",
  first_sale: "text-brand",
  custom_order_brief: "text-amber-500",
};

function fmtTs(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const same = d.toDateString() === now.toDateString();
    if (same) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return ""; }
}

export function MarketplaceActivity() {
  const { data, loading, error, refresh } = useAdminFetch("/api/admin/command/activity?limit=25", { autoRefreshMs: 45_000 });
  return (
    <WidgetShell
      eyebrow="Command · Live"
      title="Marketplace Activity"
      loading={loading}
      error={error}
      onRefresh={refresh}
      refreshMs={45_000}
      testId="widget-activity"
    >
      {data && (
        data.items.length === 0 ? (
          <p className="font-mono text-xs text-ink-muted" data-testid="activity-empty">
            No momentum events in the last 3 days.
          </p>
        ) : (
          <ol className="divide-y divide-line" data-testid="activity-list">
            {data.items.map((it) => (
              <li key={it.id} className="py-2 flex items-start gap-3" data-testid={`activity-item-${it.kind}`}>
                <span className="font-mono text-[10px] text-ink-muted min-w-[3.2rem]">
                  {fmtTs(it.ts)}
                </span>
                <span className={`font-mono text-[10px] uppercase tracking-[0.18em] ${KIND_TINT[it.kind] || "text-ink"} min-w-[9rem]`}>
                  ◆ {KIND_LABEL[it.kind] || it.kind}
                </span>
                <span className="text-ink text-sm truncate">{it.text}</span>
              </li>
            ))}
          </ol>
        )
      )}
    </WidgetShell>
  );
}

registerWidget("MarketplaceActivity", { component: MarketplaceActivity });
