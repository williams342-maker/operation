import React, { useEffect, useState } from "react";
import { Sparkles, Check } from "lucide-react";
import { fetchFeePolicy, fetchMakerSubscription } from "../../lib/api";

/** Upgrade tab — promotes Crafters Plus ($12/mo) with a clear fee comparison.
 *  Shows the 3-month free trial badge prominently to first-time signups
 *  (server-driven via `trial_eligible`). Re-subscribers don't see the
 *  trial badge — they go straight to paid. */
export default function UpgradeTab({ maker }) {
  const [policy, setPolicy] = useState(null);
  const [sub, setSub] = useState(null);
  const isPlus = (maker?.subscription_status || "") === "active";
  const isInTrial = !!sub?.is_in_trial;
  const trialEligible = !!sub?.trial_eligible;
  const trialDays = sub?.trial_days || 90;

  useEffect(() => {
    fetchFeePolicy().then(setPolicy).catch(() => {});
    fetchMakerSubscription().then(setSub).catch(() => {});
  }, []);

  const free = {
    listings: policy?.listing_free_quota || 10,
    commission: ((policy?.platform_fee_bps || 500) / 100).toFixed(0),
    processing: ((policy?.processing_fee_bps || 300) / 100).toFixed(0),
    total: (((policy?.platform_fee_bps || 500) + (policy?.processing_fee_bps || 300)) / 100).toFixed(0),
  };
  const plus = {
    listings: policy?.plus_monthly_listing_quota || 15,
    commission: ((policy?.plus_platform_fee_bps || 400) / 100).toFixed(0),
    total: (((policy?.plus_platform_fee_bps || 400) + (policy?.processing_fee_bps || 300)) / 100).toFixed(0),
    price: policy?.plus_price_usd || 12,
  };
  const trialMonths = Math.round(trialDays / 30);

  return (
    <div className="space-y-8" data-testid="upgrade-tab">
      <header className="pb-6 border-b border-[#262626]">
        <h2 className="font-display text-3xl md:text-4xl uppercase">Upgrade.</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-xl">
          Crafters Plus pays for itself the moment you sell three $400 pieces in a month.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Free tier */}
        <div className="border border-[#1f1f1f] bg-[#0d0d0d] p-6" data-testid="upgrade-free">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
            Current plan {!isPlus && <span className="text-[#ff4500]">· you are here</span>}
          </div>
          <h3 className="font-display text-3xl uppercase mb-1">Free</h3>
          <div className="font-mono text-sm text-[#737373] mb-6">$0 / month</div>
          <ul className="space-y-2.5 font-mono text-xs text-[#e5e5e5]">
            <li className="flex gap-2"><Check size={14} className="text-[#a3a3a3] shrink-0 mt-0.5" /> First {free.listings} listings free for life · $0.20 each after</li>
            <li className="flex gap-2"><Check size={14} className="text-[#a3a3a3] shrink-0 mt-0.5" /> {free.commission}% commission + {free.processing}% processing = <b className="text-[#ff4500]">{free.total}% deducted per sale</b></li>
            <li className="flex gap-2"><Check size={14} className="text-[#a3a3a3] shrink-0 mt-0.5" /> Stripe Connect payouts</li>
            <li className="flex gap-2"><Check size={14} className="text-[#a3a3a3] shrink-0 mt-0.5" /> Standard placement in feeds</li>
          </ul>
        </div>

        {/* Plus tier */}
        <div className="border-2 border-[#ff4500] bg-[#ff4500]/5 p-6 relative" data-testid="upgrade-plus">
          <div className="absolute top-0 right-4 -translate-y-1/2 bg-[#ff4500] text-[#0a0a0a] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em]">
            {trialEligible && !isPlus ? `◆ ${trialMonths} months free` : "◆ Most popular"}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-2">
            {isInTrial
              ? "Trial active"
              : isPlus
              ? "Active subscription"
              : "Recommended for active sellers"}
          </div>
          <h3 className="font-display text-3xl uppercase mb-1 flex items-center gap-2">
            <Sparkles size={22} className="text-[#ff4500]" /> Crafters Plus
          </h3>
          <div className="font-mono text-sm text-[#e5e5e5] mb-2">
            ${plus.price} / month
            {trialEligible && !isPlus && (
              <span className="ml-2 text-[#ff4500]">· {trialMonths}-month free trial</span>
            )}
          </div>
          {trialEligible && !isPlus && (
            <div
              className="font-mono text-[10px] text-[#a3a3a3] mb-4 leading-relaxed"
              data-testid="upgrade-trial-explainer"
            >
              No charge for {trialDays} days. Cancel anytime before it ends and
              pay nothing. Card on file required to start.
            </div>
          )}
          <ul className="space-y-2.5 font-mono text-xs text-[#e5e5e5]">
            <li className="flex gap-2"><Check size={14} className="text-[#ff4500] shrink-0 mt-0.5" /> {plus.listings} new listings every month, free</li>
            <li className="flex gap-2"><Check size={14} className="text-[#ff4500] shrink-0 mt-0.5" /> {plus.commission}% commission (vs {free.commission}%) + {free.processing}% processing = <b className="text-[#ff4500]">{plus.total}% deducted per sale</b></li>
            <li className="flex gap-2"><Check size={14} className="text-[#ff4500] shrink-0 mt-0.5" /> Custom shop banner image</li>
            <li className="flex gap-2"><Check size={14} className="text-[#ff4500] shrink-0 mt-0.5" /> Priority placement in homepage rotations</li>
            <li className="flex gap-2"><Check size={14} className="text-[#ff4500] shrink-0 mt-0.5" /> Plus-only "Maker Spotlight" features</li>
            <li className="flex gap-2"><Check size={14} className="text-[#ff4500] shrink-0 mt-0.5" /> Cancel anytime — takes effect end of cycle</li>
          </ul>
          <div className="mt-6 pt-6 border-t border-[#ff4500]/30">
            {isPlus ? (
              <div className="text-center font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-300" data-testid="upgrade-active-status">
                {isInTrial ? "✓ Trial active — Plus benefits unlocked" : "✓ You're a Plus subscriber"}
              </div>
            ) : (
              <a
                href="/maker/billing"
                className="block w-full text-center btn-industrial btn-primary"
                data-testid="upgrade-cta"
              >
                {trialEligible ? `Start ${trialMonths}-month free trial →` : "Upgrade to Plus →"}
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 text-center">
        <p className="font-mono text-[11px] text-[#a3a3a3] leading-relaxed">
          Plus pays for itself with about <b className="text-[#ff4500]">$1,200/mo</b> in sales —
          the 1% commission saving covers the subscription cost.
        </p>
      </div>
    </div>
  );
}
