import React, { useEffect, useState } from "react";
import { fetchAdminAnalytics } from "../../lib/api";
import { Sparkline } from "../Charts";
import { Stat } from "./_shared";
import { StatsSkeleton, RowsSkeleton } from "../Skeleton";
import GA4LiveCard from "./GA4LiveCard";
import MsftRoasCard from "./MsftRoasCard";
import GoogleRoasCard from "./GoogleRoasCard";

// ===================== ANALYTICS =====================
export default function AnalyticsTab() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetchAdminAnalytics().then(setData).catch(() => setData(null));
  }, []);
  if (!data) {
    return (
      <div className="space-y-8" data-testid="analytics-loading">
        <StatsSkeleton count={8} />
        <div className="grid md:grid-cols-2 gap-6">
          <RowsSkeleton count={5} />
          <RowsSkeleton count={5} />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-8" data-testid="analytics-tab">
      {/* iter226 — GA4 live traffic widget. Renders at the top so it's the
          first thing the admin sees when opening the Analytics tab. Falls
          back to a friendly setup card if GA4 isn't wired yet. */}
      <GA4LiveCard />
      {/* iter334l — Microsoft Ads ROAS tile right below GA4. Both are
          ad-platform attribution surfaces so they pair naturally. */}
      <MsftRoasCard />
      {/* iter334u — Google Ads ROAS tile (live spend from synced campaigns). */}
      <GoogleRoasCard />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="GMV (all-time)" value={`$${data.gmv.toFixed(0)}`} testId="an-gmv" />
        <Stat label="GMV · 30d" value={`$${data.gmv_30d.toFixed(0)}`} testId="an-gmv-30" />
        <Stat label="GMV · 7d" value={`$${data.gmv_7d.toFixed(0)}`} testId="an-gmv-7" />
        <Stat label="Avg Order" value={`$${data.avg_order.toFixed(0)}`} testId="an-avg-order" />
        <Stat label="Paid Orders" value={data.paid_orders} testId="an-orders" />
        <Stat label="Community" value={data.community_users} testId="an-users" />
        <Stat label="Showcase" value={data.showcase_posts} testId="an-showcase" />
        <Stat label="Forum" value={data.forum_threads} testId="an-forum" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-display text-2xl mb-4">Top Products</h3>
          {!data.top_products.length ? (
            <div
              className="border border-[#262626] bg-[#0a0a0a] p-6 text-center"
              data-testid="an-top-products-empty"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#525252] mb-2">◇ No revenue yet</div>
              <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
                Once paid orders land, the top-grossing listings will rank here.
              </p>
            </div>
          ) : (
            <ul className="space-y-2" data-testid="an-top-products">
              {data.top_products.map((p) => (
                <li key={p.slug} className="border border-[#262626] p-3 flex justify-between items-center">
                  <div>
                    <div className="font-display text-base">{p.title}</div>
                    <div className="font-mono text-[10px] text-[#a3a3a3] uppercase tracking-[0.22em]">
                      by {p.maker_slug}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-xl text-[#ff4500]">${p.revenue.toFixed(0)}</div>
                    <div className="font-mono text-[10px] text-[#525252]">{p.units} sold</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="font-display text-2xl mb-4">Top Makers</h3>
          {!data.top_makers.length ? (
            <div
              className="border border-[#262626] bg-[#0a0a0a] p-6 text-center"
              data-testid="an-top-makers-empty"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#525252] mb-2">◇ No revenue yet</div>
              <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
                Once paid orders land, the highest-grossing makers will surface here.
              </p>
            </div>
          ) : (
            <ul className="space-y-2" data-testid="an-top-makers">
              {data.top_makers.map((m) => (
                <li key={m.slug} className="border border-[#262626] p-3 flex justify-between items-center">
                  <div className="font-display text-base">{m.name}</div>
                  <div className="font-display text-xl text-[#ff4500]">${m.revenue.toFixed(0)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-6 border-t border-[#262626]">
        <Stat label="Pending Apps" value={data.applications_pending} testId="an-pending-apps" />
        <Stat label="Open Briefs" value={data.custom_orders_open} testId="an-pending-custom" />
        <Stat label="Listings" value={data.products_count} testId="an-listings" />
        <Stat label="Files" value={data.design_files} testId="an-files" />
      </div>

      {data.weekly_gmv && (
        <Sparkline data={data.weekly_gmv} label="Marketplace" testId="an-weekly-gmv" />
      )}
    </div>
  );
}
