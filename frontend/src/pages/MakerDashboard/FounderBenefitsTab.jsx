import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchFeePolicy, fetchMakerMe } from "../../lib/api";
import {
  isFounder, isInauguralFounder, listingsThisMonth,
  foundingAccessDaysLeft, regularFounderDaysLeft,
  FOUNDER_MONTHLY_LISTING_QUOTA, TIER_LABELS, effectiveTier,
} from "../../lib/founderTier";

/**
 * iter413cl — Founder Benefits tab.
 *
 * Visible only to makers on the Founder tier. Surfaces what they
 * already have so they STOP getting nudged to "upgrade" to a worse plan
 * (Plus at 4% vs their 3%). The single most common founder support
 * ticket — "is Plus better than what I have?" — gets answered visually
 * before they have to ask.
 *
 * Sections:
 *   1. Hero pill: tier + founder number
 *   2. Commission tile (live rate, comparison to other tiers)
 *   3. Monthly quota meter (X / 50 free listings used this month)
 *   4. Status detail (lifetime vs window expiring, Founding Access
 *      countdown if still inside the 90-day promo)
 *   5. Perks list (commission, quota, badge, marketing kit links)
 *   6. Downloadable founder card link
 */
export default function FounderBenefitsTab() {
  const [maker, setMaker] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([fetchMakerMe(), fetchFeePolicy()])
      .then(([m, p]) => { setMaker(m); setPolicy(p); })
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load founder data."));
  }, []);

  if (err) {
    return (
      <p className="font-mono text-sm text-red-400" data-testid="founder-tab-error">{err}</p>
    );
  }
  if (!maker) {
    return (
      <div className="font-mono text-xs text-ink-muted" data-testid="founder-tab-loading">
        Loading your founder benefits…
      </div>
    );
  }
  if (!isFounder(maker)) {
    // Defensive — the nav filter should hide this tab for non-founders,
    // but if someone deep-links directly we redirect gracefully.
    return (
      <div className="font-mono text-xs text-ink-muted" data-testid="founder-tab-not-founder">
        Founder benefits aren&apos;t available on your current tier.
      </div>
    );
  }

  // iter413cm — Display the COMMISSION rate only (3% / 4% / 5%). The
  // combined "platform + processing" number was confusing founders into
  // thinking their rate was higher than it really is — processing is the
  // same for every tier so showing it adds no comparison value, just
  // visual noise. Plain "3%" / "4%" / "5%" reads as the commission tier.

  const founderCommission = 3;
  const plusCommission = (policy?.plus_platform_fee_bps || 400) / 100;
  const standardCommission = (policy?.platform_fee_bps || 500) / 100;
  const procRate = (policy?.processing_fee_bps || 300) / 100;

  const inaugural = isInauguralFounder(maker);
  const tierKey = effectiveTier(maker);
  const tierLabel = TIER_LABELS[tierKey];
  const founderNumber = maker.founder_number ? String(maker.founder_number).padStart(3, "0") : null;

  const used = listingsThisMonth(maker);
  const quota = FOUNDER_MONTHLY_LISTING_QUOTA;
  const pct = Math.min(100, Math.round((used / quota) * 100));
  const remaining = Math.max(0, quota - used);

  const fa = foundingAccessDaysLeft(maker);
  const fd = regularFounderDaysLeft(maker);

  return (
    <div className="space-y-8" data-testid="founder-benefits-tab">
      <header className="pb-6 border-b border-line">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-2">
          ◆ Your Tier
        </div>
        <h2 className="font-display text-3xl md:text-4xl uppercase flex items-baseline flex-wrap gap-3">
          {tierLabel}
          {founderNumber && (
            <span className="font-mono text-base text-ink-muted">· #{founderNumber}</span>
          )}
        </h2>
        <p className="font-mono text-xs text-ink-muted mt-3 max-w-xl">
          {inaugural
            ? "Lifetime. Inaugural Founders never expire."
            : fd != null
              ? `${fd} day${fd === 1 ? "" : "s"} left in your 12-month Founder window.`
              : "12-month Founder window."}
          {fa != null && fa > 0 && (
            <> · Founding Access · day {90 - fa} / 90</>
          )}
        </p>
      </header>

      {/* Commission rate tile */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-5">
        <div className="border-2 border-brand bg-brand/5 p-5" data-testid="founder-rate-tile">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-2">
            Your commission
          </div>
          <div className="font-display text-3xl">{founderCommission}%</div>
          <div className="font-mono text-[10px] text-ink-muted mt-2 leading-relaxed">
            Lowest on the platform. Processing ({procRate.toFixed(0)}%) is the same for everyone.
          </div>
        </div>
        <div className="border border-line bg-paper p-5 opacity-60" data-testid="founder-rate-plus">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
            Plus commission
          </div>
          <div className="font-display text-3xl">{plusCommission.toFixed(0)}%</div>
          <div className="font-mono text-[10px] text-ink-muted mt-2 leading-relaxed">
            Higher than yours. You keep the Founder rate.
          </div>
        </div>
        <div className="border border-line bg-paper p-5 opacity-60" data-testid="founder-rate-standard">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
            Standard commission
          </div>
          <div className="font-display text-3xl">{standardCommission.toFixed(0)}%</div>
          <div className="font-mono text-[10px] text-ink-muted mt-2 leading-relaxed">
            What most sellers pay. You&apos;re saving the difference.
          </div>
        </div>
      </section>

      {/* Monthly quota meter */}
      <section className="border border-line bg-paper p-5" data-testid="founder-quota">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            ◆ This month&apos;s free listings
          </div>
          <div className="font-mono text-xs text-ink">
            <span className="text-brand font-bold">{used}</span>
            <span className="text-ink-muted"> / {quota}</span>
          </div>
        </div>
        <div className="h-2 bg-surface border border-line overflow-hidden" aria-hidden>
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${pct}%` }}
            data-testid="founder-quota-bar"
          />
        </div>
        <p className="font-mono text-[10px] text-ink-muted mt-3 leading-relaxed">
          {remaining > 0
            ? `${remaining} free listing${remaining === 1 ? "" : "s"} left this month. Resets the 1st.`
            : `You&apos;ve used all ${quota} this month — extras are $0.20 each. Resets the 1st.`}
        </p>
      </section>

      {/* Perks list */}
      <section className="border border-line bg-paper p-5 md:p-6" data-testid="founder-perks">
        <h3 className="font-display text-xl uppercase mb-4">What you get</h3>
        <ul className="space-y-2.5 font-mono text-xs text-ink">
          <li className="flex gap-2">
            <span className="text-brand shrink-0">◆</span>
            <span>
              <b>3% commission</b> on every sale — lower than every other tier on the platform.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-brand shrink-0">◆</span>
            <span>
              <b>{quota} free listings every month</b>, not lifetime — your quota resets on the 1st.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-brand shrink-0">◆</span>
            <span>
              <b>Custom shop URL</b> — claim a memorable vanity URL like
              <code className="ml-1 text-brand">/makers/your-name</code>.
              Set yours in Settings → Account.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-brand shrink-0">◆</span>
            <span>
              <b>Founder badge + emblem SVG</b> — download from your Marketing tab,
              use in print materials, email signatures, social.
            </span>
          </li>
          {inaugural && (
            <li className="flex gap-2">
              <span className="text-brand shrink-0">◆</span>
              <span>
                <b>Lifetime status</b> — Inaugural Founders never roll back to Standard.
                Your 3% rate is locked forever.
              </span>
            </li>
          )}
        </ul>
      </section>

      {/* Marketing kit shortcut */}
      <section className="border border-dashed border-brand/40 bg-brand/5 p-5" data-testid="founder-marketing-cta">
        <h3 className="font-display text-lg uppercase mb-1">Show off your status.</h3>
        <p className="font-mono text-xs text-ink-muted mb-3 max-w-xl">
          We auto-generated a founder card, email signature, and shareable
          posts you can use today. They&apos;re already in your Marketing tab.
        </p>
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("cm:open-marketing-section", { detail: { section: "founder" } }));
            // Defer hash change so the dispatch lands first.
            setTimeout(() => { window.location.hash = "marketing"; }, 0);
          }}
          className="px-4 py-2 border border-brand bg-brand text-[#0a0a0a] hover:bg-brand-hover font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition"
          data-testid="founder-marketing-open"
        >
          Open Marketing tab →
        </button>
      </section>

      {/* Quiet status footer */}
      <div className="border-t border-line pt-4 font-mono text-[10px] text-ink-muted leading-relaxed" data-testid="founder-status-footer">
        Joined as <b className="text-ink">Founder #{founderNumber || "?"}</b>
        {inaugural ? " — Inaugural cohort (lifetime perks)." : " — Regular cohort."}
        {" "}Status questions? Email
        {" "}
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText("founders@craftersmarket.org");
            toast.success("founders@craftersmarket.org copied.");
          }}
          className="text-brand hover:underline"
        >
          founders@craftersmarket.org
        </button>.
      </div>
    </div>
  );
}
