import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Cookie, X, ChevronDown } from "lucide-react";
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
 * - Bottom-fixed strip (not a modal overlay) — non-blocking, dismissible.
 * - Industrial dark palette matching the rest of the site.
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
      <div className="max-w-[1300px] mx-auto px-4 md:px-8 py-4 md:py-5 flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6">
        <Cookie size={22} className="text-brand shrink-0 hidden sm:block" />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand mb-1.5">
            ◆ Cookies & Privacy
          </p>
          <p className="font-mono text-[12px] text-ink leading-relaxed">
            We use cookies for analytics (Google Analytics) and advertising (Microsoft Ads).
            You can accept all, reject all, customize, or read our{" "}
            <Link to="/policy#privacy" className="text-brand hover:underline" data-testid="cookie-banner-policy-link">
              privacy policy
            </Link>
            . You can change this any time via the footer's{" "}
            <em className="text-ink-muted not-italic">Cookie preferences</em> link.
          </p>
        </div>
        <div className="flex items-stretch gap-2 shrink-0 w-full md:w-auto">
          {/* iter334g — Customize toggle button. Expands the inline
              panel below. Independent of Accept/Reject so picking
              "Customize" then "Save Selection" doesn't surprise the
              user with a different consent state than what they set. */}
          <button
            type="button"
            onClick={() => setCustomize((s) => !s)}
            aria-expanded={customize}
            aria-controls="cookie-banner-customize-panel"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2.5 border border-line hover:border-[#525252] text-ink-muted hover:text-ink font-mono text-[10px] uppercase tracking-[0.22em] transition"
            data-testid="cookie-banner-customize"
          >
            Customize
            <ChevronDown size={11} className={`transition-transform ${customize ? "rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onReject}
            className="px-4 py-2.5 border border-line hover:border-[#525252] text-ink-muted hover:text-ink font-mono text-[10px] uppercase tracking-[0.22em] transition flex-1 md:flex-none"
            data-testid="cookie-banner-reject"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="px-5 py-2.5 bg-brand hover:bg-[#cc3700] text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition flex-1 md:flex-none"
            data-testid="cookie-banner-accept"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={onReject}
            aria-label="Close (treats as reject all)"
            className="hidden md:inline-flex items-center justify-center w-9 px-0 border border-line hover:border-brand text-ink-muted hover:text-brand transition"
            data-testid="cookie-banner-close"
          >
            <X size={14} />
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
          className="border-t border-line bg-[#0d0d0d]"
          data-testid="cookie-banner-customize-panel"
        >
          <div className="max-w-[1300px] mx-auto px-4 md:px-8 py-4 md:py-5 flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6">
            <div className="flex-1 grid sm:grid-cols-2 gap-3 w-full">
              <label
                htmlFor="cookie-toggle-analytics"
                className="flex items-start gap-3 p-3 border border-line hover:border-[#525252] cursor-pointer transition"
                data-testid="cookie-customize-analytics-row"
              >
                <input
                  id="cookie-toggle-analytics"
                  type="checkbox"
                  checked={analyticsOn}
                  onChange={(e) => setAnalyticsOn(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#ff4500] cursor-pointer shrink-0"
                  data-testid="cookie-customize-analytics"
                />
                <div className="min-w-0">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink mb-0.5">
                    Analytics
                  </div>
                  <div className="font-mono text-[10px] text-ink-muted leading-relaxed">
                    Google Analytics 4. Pageviews + clicks. No ad targeting.
                  </div>
                </div>
              </label>
              <label
                htmlFor="cookie-toggle-ads"
                className="flex items-start gap-3 p-3 border border-line hover:border-[#525252] cursor-pointer transition"
                data-testid="cookie-customize-ads-row"
              >
                <input
                  id="cookie-toggle-ads"
                  type="checkbox"
                  checked={adsOn}
                  onChange={(e) => setAdsOn(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#ff4500] cursor-pointer shrink-0"
                  data-testid="cookie-customize-ads"
                />
                <div className="min-w-0">
                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink mb-0.5">
                    Advertising
                  </div>
                  <div className="font-mono text-[10px] text-ink-muted leading-relaxed">
                    Microsoft Ads (Bing). Conversion tracking + remarketing.
                  </div>
                </div>
              </label>
            </div>
            <button
              type="button"
              onClick={onSaveCustom}
              className="px-5 py-2.5 bg-[#22d3ee] hover:bg-[#06b6d4] text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition w-full md:w-auto shrink-0"
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
