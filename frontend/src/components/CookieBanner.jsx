import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X, ChevronDown } from "lucide-react";
import { readConsent, acceptAll, rejectAll, writeConsent, REOPEN_EVENT } from "../lib/consent";

/**
 * iter334e — GDPR cookie consent banner.
 *
 * - Mounts on every page once via App.js.
 * - Shows only if no valid `cm_consent` record exists in localStorage,
 *   so returning visitors aren't re-prompted.
 * - Footer's "Cookie preferences" link dispatches `cm:reopen-cookie-banner`
 *   to re-show the banner if the user wants to change their mind.
 * - Accept All / Reject All push consent updates to both GA4 + UET via
 *   the helpers in `lib/consent.js`.
 * - iter334g — A "Customize" button expands a sub-panel with two
 *   independent toggles (analytics vs ads). Save Selection writes the
 *   exact combination chosen, so privacy-conscious users can allow
 *   analytics without enabling ad tracking, or vice versa.
 * - iter413cg — Slimmed banner to ~40% of original vertical footprint:
 *   single short sentence, inline 🍪 emoji, no preamble tagline, tighter
 *   button padding. All functionality (Customize / Reject / Accept /
 *   Close) preserved.
 */
export default function CookieBanner() {
  const [open, setOpen] = useState(false);
  // iter334g — Customize panel state.
  const [customize, setCustomize] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(true);
  const [adsOn, setAdsOn] = useState(true);

  // On mount, decide whether to show. Also listen for the footer
  // reopen event so users can revisit their choice any time.
  useEffect(() => {
    if (!readConsent()) setOpen(true);
    const handler = () => {
      // Re-opened from footer → preload toggles from the last saved
      // record so the maker sees their current choice, not the optimistic default.
      const c = readConsent();
      if (c) {
        setAnalyticsOn(c.analytics_storage === "granted");
        setAdsOn(c.ad_storage === "granted");
      }
      setCustomize(false);  // start collapsed even on reopen
      setOpen(true);
    };
    window.addEventListener(REOPEN_EVENT, handler);
    return () => window.removeEventListener(REOPEN_EVENT, handler);
  }, []);

  if (!open) return null;

  const onAccept = () => { acceptAll(); setOpen(false); };
  const onReject = () => { rejectAll(); setOpen(false); };
  const onSaveCustom = () => {
    writeConsent(adsOn ? "granted" : "denied", analyticsOn ? "granted" : "denied");
    setOpen(false);
  };

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-[60] bg-paper/95 backdrop-blur border-t border-line shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.8)]"
      data-testid="cookie-banner"
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
    >
      <div className="max-w-[1300px] mx-auto px-3 md:px-6 py-2 md:py-2.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4">
        <p className="font-mono text-[11px] text-ink leading-snug flex-1 min-w-0">
          <span aria-hidden="true" className="mr-1">🍪</span>
          We use cookies to analyze traffic and ads. Read our{" "}
          <Link to="/policies/privacy" className="text-brand hover:underline" data-testid="cookie-banner-policy-link">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex items-stretch gap-1.5 shrink-0">
          {/* iter334g — Customize toggle button. Expands the inline
              panel below. Independent of Accept/Reject so picking
              "Customize" then "Save Selection" doesn't surprise the
              user with a different consent state than what they set. */}
          <button
            type="button"
            onClick={() => setCustomize((s) => !s)}
            aria-expanded={customize}
            aria-controls="cookie-banner-customize-panel"
            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 border border-line hover:border-brand text-ink-muted hover:text-ink font-mono text-[10px] uppercase tracking-[0.18em] transition"
            data-testid="cookie-banner-customize"
          >
            Customize
            <ChevronDown size={10} className={`transition-transform ${customize ? "rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onReject}
            className="px-3 py-1.5 border border-line hover:border-brand text-ink-muted hover:text-ink font-mono text-[10px] uppercase tracking-[0.18em] transition flex-1 sm:flex-none"
            data-testid="cookie-banner-reject"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="px-3.5 py-1.5 bg-brand hover:bg-brand-hover text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.18em] font-bold transition flex-1 sm:flex-none"
            data-testid="cookie-banner-accept"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={onReject}
            aria-label="Close (treats as reject all)"
            className="hidden md:inline-flex items-center justify-center w-7 border border-line hover:border-brand text-ink-muted hover:text-brand transition"
            data-testid="cookie-banner-close"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* iter334g — Customize panel. Slides open beneath the banner so
          users can pick analytics independently of ads. Toggling the
          checkboxes is local-only until "Save selection" is clicked —
          that way "Accept all" / "Reject all" remain instantaneous. */}
      {customize && (
        <div
          id="cookie-banner-customize-panel"
          className="border-t border-line bg-surface"
          data-testid="cookie-banner-customize-panel"
        >
          <div className="max-w-[1300px] mx-auto px-3 md:px-6 py-3 flex flex-col md:flex-row items-start md:items-center gap-3 md:gap-4">
            <div className="flex-1 grid sm:grid-cols-2 gap-2 w-full">
              <label
                htmlFor="cookie-toggle-analytics"
                className="flex items-start gap-2 p-2 border border-line hover:border-brand cursor-pointer transition"
                data-testid="cookie-customize-analytics-row"
              >
                <input
                  id="cookie-toggle-analytics"
                  type="checkbox"
                  checked={analyticsOn}
                  onChange={(e) => setAnalyticsOn(e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 accent-[#ff4500] cursor-pointer shrink-0"
                  data-testid="cookie-customize-analytics"
                />
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink">Analytics</div>
                  <div className="font-mono text-[10px] text-ink-muted leading-snug">
                    Google Analytics 4. Pageviews + clicks. No ad targeting.
                  </div>
                </div>
              </label>
              <label
                htmlFor="cookie-toggle-ads"
                className="flex items-start gap-2 p-2 border border-line hover:border-brand cursor-pointer transition"
                data-testid="cookie-customize-ads-row"
              >
                <input
                  id="cookie-toggle-ads"
                  type="checkbox"
                  checked={adsOn}
                  onChange={(e) => setAdsOn(e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 accent-[#ff4500] cursor-pointer shrink-0"
                  data-testid="cookie-customize-ads"
                />
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink">Advertising</div>
                  <div className="font-mono text-[10px] text-ink-muted leading-snug">
                    Microsoft Ads (Bing). Conversion tracking + remarketing.
                  </div>
                </div>
              </label>
            </div>
            <button
              type="button"
              onClick={onSaveCustom}
              className="px-3.5 py-1.5 bg-[#22d3ee] hover:bg-[#06b6d4] text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.18em] font-bold transition w-full md:w-auto shrink-0"
              data-testid="cookie-banner-save-custom"
            >
              Save selection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
