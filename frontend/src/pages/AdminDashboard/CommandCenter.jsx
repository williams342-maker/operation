/*
 * Marketplace Command Center (iter419) — the new /admin landing view.
 *
 * Renders a widget-based layout that answers the daily founder
 * questions in order:
 *   1. Marketplace Growth — "Is the marketplace growing today?"
 *   2. Founder Operations — "Do we have enough active founders?"
 *   3. Marketplace Activity — "What's happening right now?"
 *   4. Recruitment Opportunities — "Which makers should I recruit next?"
 *
 * Layout is config-driven via the widget framework — swap the array
 * to reconfigure the dashboard for CortexViral / Williams Innovation.
 */
import "../../components/widgets/MarketplaceGrowth";
import "../../components/widgets/FounderOperations";
import "../../components/widgets/MarketplaceActivity";
import "../../components/widgets/RecruitmentOpportunities";
// iter420 — Commerce Pulse strip
import "../../components/widgets/LiveRevenue";
import "../../components/widgets/CartAbandonment";
import "../../components/widgets/TrendingProducts";
import "../../components/widgets/TopSearches";
import { Dashboard } from "../../components/widgets/framework";

const CRAFTERS_LAYOUT = [
  { key: "MarketplaceGrowth", span: 2 },
  "FounderOperations",
  "RecruitmentOpportunities",
  { key: "MarketplaceActivity", span: 2 },
];

const CRAFTERS_COMMERCE_LAYOUT = [
  "LiveRevenue",
  "CartAbandonment",
  "TrendingProducts",
  "TopSearches",
];

export default function CommandCenter() {
  return (
    <div className="space-y-6" data-testid="command-center">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-1">
          ◆ Marketplace Command Center
        </div>
        <h2 className="font-display text-3xl">Today.</h2>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted mt-1">
          Growth · Founders · Activity · Recruitment
        </p>
      </div>
      <Dashboard layout={CRAFTERS_LAYOUT} />

      {/* iter420 — Commerce Pulse: live revenue, abandonment, momentum, intent */}
      <div className="pt-6 border-t border-line">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-1">
          ◆ Commerce Pulse
        </div>
        <h2 className="font-display text-2xl mb-1">Live money & momentum.</h2>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted mb-4">
          Revenue · Recovery · Momentum · Intent
        </p>
        <Dashboard
          layout={CRAFTERS_COMMERCE_LAYOUT}
          className="grid grid-cols-1 md:grid-cols-2 gap-6"
        />
      </div>
    </div>
  );
}
