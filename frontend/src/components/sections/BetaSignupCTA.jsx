import React from "react";
import { Link } from "react-router-dom";
import { useSiteSettings } from "../../hooks/useSiteSettings";

/**
 * BetaSignupCTA
 * --------------
 * Bottom-of-home full-bleed band that recruits Founding Sellers into
 * the beta program. Replaces the old persistent orange pill that lived
 * in the global Nav — moving it here keeps the header lean while still
 * giving the offer a prime, hard-to-miss surface at the end of the
 * homepage scroll.
 *
 * Visibility is gated by the same `beta_signup_enabled` site setting
 * that the Nav and /beta landing page already use, so admins can turn
 * off the entire funnel in one place via Settings → Founding Seller
 * Beta Signup.
 */
export default function BetaSignupCTA() {
  const settings = useSiteSettings();
  const enabled = settings?.beta_signup_enabled !== false;
  if (!enabled) return null;

  return (
    <section
      className="relative bg-[#0a0a0a] border-t border-b border-[#262626] py-20 md:py-28 overflow-hidden"
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
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ Founding Seller Beta · Limited spots
          </div>
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[0.95] text-[#fafafa]">
            Build your shop<br />
            with the founding 100.
          </h2>
          <p className="text-[#a3a3a3] mt-5 max-w-xl text-sm md:text-base leading-relaxed">
            We&apos;re hand-picking 100 CNC, woodworking and laser makers to launch
            CraftersMarket alongside us. Founding Sellers get zero listing fees
            for life, priority placement, and a permanent &quot;Founding Seller&quot;
            badge on every product page.
          </p>
        </div>
        <div className="flex flex-col items-stretch md:items-end gap-3">
          <Link
            to="/beta"
            className="inline-flex items-center justify-center gap-2 px-7 py-4 bg-[#ff4500] hover:bg-[#ff5722] text-black font-mono text-[12px] font-bold uppercase tracking-[0.3em] transition shadow-[0_0_0_2px_rgba(255,69,0,0.18)]"
            data-testid="home-beta-signup-btn"
          >
            ◆ Apply to the Beta
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] text-center md:text-right">
            We review every application personally
          </span>
        </div>
      </div>
    </section>
  );
}
