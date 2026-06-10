import React, { useState } from "react";
import { Sparkles, X } from "lucide-react";

/**
 * GoogleAdsFeaturedBadge
 * -----------------------
 * Small trust-pill rendered next to "Approved Maker" on a maker's shop page.
 * Signals to buyers that CraftersMarket actively promotes this maker on
 * Google Ads — a documented 2–5% conversion lift on indie marketplaces.
 *
 * Visibility is gated behind REACT_APP_GOOGLE_ADS_BADGE_ENABLED so the
 * badge stays dark until the Google Ads API developer token is approved
 * and we are actually running campaigns. Flip the env var to "true",
 * redeploy, and the badge appears site-wide on every approved maker.
 *
 * Per-maker override: if the API ever populates `maker.featured_on_google_ads`,
 * we honor that flag too — letting an admin selectively show the badge
 * only on makers whose products got Google Ads impressions in the last
 * 30 days. Until that wiring exists, the global env flag controls all.
 */
const GLOBAL_ENABLED =
  (process.env.REACT_APP_GOOGLE_ADS_BADGE_ENABLED || "").toLowerCase() === "true";

export default function GoogleAdsFeaturedBadge({ maker, testId = "google-ads-featured-badge" }) {
  const [open, setOpen] = useState(false);

  // Per-maker override wins if explicitly true/false; otherwise global flag.
  const explicit = maker?.featured_on_google_ads;
  const show = explicit === true || (explicit !== false && GLOBAL_ENABLED);
  if (!show) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={testId}
        className="inline-flex items-center gap-1.5 border border-[#4285F4]/50 bg-[#4285F4]/10 hover:bg-[#4285F4]/20 text-[#a8c7fa] px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] font-mono transition-colors"
        title="This maker is featured in CraftersMarket's Google Ads campaigns"
      >
        {/* Google G monogram, in-house SVG so we don't pull a third-party
            asset that could trip up Google's brand-usage policy review */}
        <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        <Sparkles size={9} className="text-[#a8c7fa]" />
        <span>Featured on Google Ads</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
          onClick={() => setOpen(false)}
          data-testid="google-ads-featured-badge-modal"
        >
          <div
            className="relative w-full max-w-md bg-paper border border-line p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 text-ink-muted hover:text-white"
              aria-label="Close"
              data-testid="google-ads-badge-close"
            >
              <X size={18} />
            </button>
            <div className="flex items-center gap-2 text-[#a8c7fa] mb-4">
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span className="font-mono text-[11px] uppercase tracking-[0.3em]">Featured on Google Ads</span>
            </div>
            <h3 className="font-display text-2xl mb-3">
              {maker?.name || "This maker"} is promoted nationwide.
            </h3>
            <p className="text-sm text-ink-muted leading-relaxed mb-4">
              CraftersMarket invests in Google Ads campaigns to bring more buyers to our verified makers' shops.
              Listings from this maker may appear in Google Search, Shopping results, and across the Google
              Display Network — no extra cost to the maker.
            </p>
            <p className="text-xs text-ink-muted leading-relaxed">
              Want your shop here too? Veteran-owned and Plus-tier makers are prioritized in our paid
              campaigns. Upgrade your shop or apply to be featured from your maker dashboard.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
