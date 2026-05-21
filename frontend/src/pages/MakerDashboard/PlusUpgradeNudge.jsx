import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Check, ArrowRight } from "lucide-react";
import { fetchFeePolicy, fetchMakerSubscription } from "../../lib/api";

/**
 * Compact Crafters Plus upgrade nudge for the Dashboard tab.
 *
 * Always rendered for Free-tier makers (no dismiss button — surfacing this
 * is the point). Hidden for Plus subscribers since they already have it.
 *
 * Pulls the live fee policy so the savings math reflects current platform
 * fees (5% free → 4% Plus = 1% commission saving), and computes the
 * maker's *actual* monthly savings from their last-30d revenue rather
 * than a generic break-even number. Way more compelling than "Save $$$".
 *
 * Props:
 *   - maker: full Maker doc (uses subscription_status to decide whether to render)
 *   - orders: full orders array (used to compute last-30d revenue)
 *   - onUpgrade: callback to switch the dashboard tab to Settings → Your Subscription
 */
export default function PlusUpgradeNudge({ maker, orders = [], onUpgrade }) {
  const [policy, setPolicy] = useState(null);
  const [sub, setSub] = useState(null);

  useEffect(() => {
    fetchFeePolicy().then(setPolicy).catch(() => {});
    fetchMakerSubscription().then(setSub).catch(() => {});
  }, []);

  // Hide for active subscribers. We want to nudge, not nag the already-converted.
  if ((maker?.subscription_status || "") === "active") return null;

  // Trial-eligible by default — first-time signups. Re-subscribers
  // (sub.trial_eligible=false) shouldn't see the "3 months free" badge.
  const trialEligible = sub ? !!sub.trial_eligible : true;

  const platformFreeBps = policy?.platform_fee_bps ?? 500;     // 5%
  const platformPlusBps = policy?.plus_platform_fee_bps ?? 400; // 4%
  const savingsBps = Math.max(0, platformFreeBps - platformPlusBps);
  const plusPrice = policy?.plus_price_usd ?? 12;
  const plusListings = policy?.plus_monthly_listing_quota ?? 15;

  // Compute the maker's last-30d gross revenue (USD) — drives the
  // "you'd save $X/mo" personalized line. Falls back to 0 if no orders.
  const now = Date.now();
  const last30 = orders
    .filter((o) => {
      const t = Date.parse(o.created_at || "");
      return !Number.isNaN(t) && (now - t) <= 30 * 24 * 60 * 60 * 1000;
    })
    .reduce((s, o) => s + (Number(o.total_cents || 0) / 100), 0);

  const monthlySavings = (last30 * savingsBps) / 10_000;
  const netMonthlySavings = monthlySavings - plusPrice; // negative until break-even
  const wouldBenefit = netMonthlySavings > 0;
  // Break-even revenue per month = plusPrice / (savingsBps/10000)
  const breakEven = savingsBps > 0 ? Math.ceil(plusPrice / (savingsBps / 10_000)) : 0;

  const headline = wouldBenefit
    ? `You'd save ~$${monthlySavings.toFixed(0)}/mo with Plus.`
    : `Crafters Plus pays for itself at $${breakEven}/mo in sales.`;

  const subline = wouldBenefit
    ? `Based on your last 30 days ($${last30.toFixed(0)} in sales). Net of the $${plusPrice}/mo subscription, you'd keep an extra $${netMonthlySavings.toFixed(0)}.`
    : last30 > 0
      ? `Your last 30 days: $${last30.toFixed(0)} in sales — at $${breakEven}/mo Plus starts paying for itself.`
      : `1% lower commission, ${plusListings} free listings/mo, priority placement, and a custom shop banner.`;

  return (
    <section
      className="relative border border-[#ff4500]/60 bg-gradient-to-r from-[#ff4500]/8 via-[#0a0a0a] to-[#0a0a0a] p-5 md:p-6 overflow-hidden"
      data-testid="plus-upgrade-nudge"
    >
      {/* Decorative diagonal accent bar */}
      <div className="absolute top-0 right-0 h-full w-2 bg-[#ff4500]" aria-hidden />

      <div className="grid md:grid-cols-[1fr_auto] gap-5 items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">
            <Sparkles size={12} />
            <span>Crafters Plus · ${plusPrice}/mo</span>
            <span className="px-1.5 py-0.5 bg-[#ff4500] text-black font-bold text-[8px] tracking-[0.18em] ml-1">
              {trialEligible ? "3 MONTHS FREE" : "MOST POPULAR"}
            </span>
          </div>
          <h3 className="font-display text-2xl md:text-3xl uppercase leading-[1.05]" data-testid="plus-nudge-headline">
            {headline}
          </h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 leading-relaxed max-w-2xl" data-testid="plus-nudge-subline">
            {subline}
          </p>

          <ul className="mt-4 grid sm:grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] text-[#e5e5e5]">
            <Feature label={`${(savingsBps / 100).toFixed(0)}% lower commission`} />
            <Feature label={`${plusListings} listings/month free`} />
            <Feature label="Priority placement in feeds" />
            <Feature label="Custom shop banner image" />
          </ul>
        </div>

        <div className="flex md:flex-col items-stretch gap-3 shrink-0 md:min-w-[180px]">
          {/* Direct to /maker/billing — kicks off Stripe Checkout in one
              click. The earlier indirection (event → Settings → Subscription
              tab → Upgrade button) wasted three clicks. */}
          <Link
            to="/maker/billing"
            className="btn-industrial btn-primary inline-flex items-center justify-center gap-2"
            data-testid="plus-nudge-cta"
          >
            {trialEligible ? "Start free trial" : "Upgrade to Plus"}
            <ArrowRight size={14} />
          </Link>
          <button
            onClick={onUpgrade}
            className="px-3 py-2 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition"
            data-testid="plus-nudge-compare"
          >
            See full comparison →
          </button>
        </div>
      </div>
    </section>
  );
}

function Feature({ label }) {
  return (
    <li className="flex items-center gap-2">
      <Check size={12} className="text-[#ff4500] shrink-0" />
      <span>{label}</span>
    </li>
  );
}
