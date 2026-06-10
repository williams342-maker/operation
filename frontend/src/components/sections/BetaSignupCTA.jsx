import React from "react";
import { Link } from "react-router-dom";
import { useSiteSettings } from "../../hooks/useSiteSettings";
import FounderSlotCounter from "../FounderSlotCounter";

/**
 * BetaSignupCTA
 * --------------
 * Bottom-of-home full-bleed band that recruits Founders into the
 * Founders Tier. Lives at the end of the homepage scroll so the offer
 * is the last thing a fresh visitor reads before reaching the footer.
 *
 * Visibility is gated by the same `beta_signup_enabled` site setting
 * that the /founders landing page already uses, so admins can turn
 * off the entire funnel in one place via Settings → Founding Seller
 * Beta Signup. The kebab name "beta_signup" is preserved for backward
 * compatibility with existing admin Settings UI even though the
 * user-facing copy now says "Founders" everywhere.
 */
export default function BetaSignupCTA() {
  const settings = useSiteSettings();
  const enabled = settings?.beta_signup_enabled !== false;
  if (!enabled) return null;

  return (
    <section
      className="relative bg-paper border-t border-b border-line py-20 md:py-28 overflow-hidden"
      data-testid="home-beta-signup-cta"
    >
      {/* Diagonal accent strip — picks up the brand orange without
          flooding the section, keeps the band visually distinct from
          neighboring black panels. */}
      <div
        aria-hidden="true"
        className="absolute -top-px left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#ff4500] to-transparent"
      />
      <div className="max-w-6xl mx-auto px-4 md:px-8 grid md:grid-cols-[1.4fr_1fr] gap-10 items-center">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3 flex flex-wrap items-center gap-3">
            <span>◆ Founders Tier · Limited inaugural spots</span>
            <FounderSlotCounter variant="compact" testId="home-cta-slot-counter" />
          </div>
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[0.95] text-ink">
            Build your shop<br />
            with the founding 100.
          </h2>
          <p className="text-ink-muted mt-5 max-w-xl text-sm md:text-base leading-relaxed">
            We&apos;re hand-picking 100 CNC, woodworking and laser makers to launch
            CraftersMarket alongside us. Founders get <span className="text-ink">3%
            commission for life</span>, 50 free listings every month, no subscription,
            and a permanent ◆ Founding Maker badge on every product page.
          </p>
        </div>
        <div className="flex flex-col items-stretch md:items-end gap-3">
          <Link
            to="/founders"
            className="inline-flex items-center justify-center gap-2 px-7 py-4 bg-brand hover:bg-brand-hover text-ink font-mono text-[12px] font-bold uppercase tracking-[0.3em] transition shadow-[0_0_0_2px_rgba(255,69,0,0.18)]"
            data-testid="home-beta-signup-btn"
          >
            ◆ Apply to be a Founder
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted text-center md:text-right">
            We review every application personally
          </span>
        </div>
      </div>
    </section>
  );
}

