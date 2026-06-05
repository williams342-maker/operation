import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Cookie, X } from "lucide-react";
import { readConsent, acceptAll, rejectAll, REOPEN_EVENT } from "../lib/consent";

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
 * - Bottom-fixed strip (not a modal overlay) — non-blocking, dismissible.
 * - Industrial dark palette matching the rest of the site.
 */
export default function CookieBanner() {
  const [open, setOpen] = useState(false);

  // On mount, decide whether to show. Also listen for the footer
  // reopen event so users can revisit their choice any time.
  useEffect(() => {
    if (!readConsent()) setOpen(true);
    const handler = () => setOpen(true);
    window.addEventListener(REOPEN_EVENT, handler);
    return () => window.removeEventListener(REOPEN_EVENT, handler);
  }, []);

  if (!open) return null;

  const onAccept = () => { acceptAll(); setOpen(false); };
  const onReject = () => { rejectAll(); setOpen(false); };

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-[60] bg-[#0a0a0a]/95 backdrop-blur border-t border-[#262626] shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.8)]"
      data-testid="cookie-banner"
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
    >
      <div className="max-w-[1300px] mx-auto px-4 md:px-8 py-4 md:py-5 flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6">
        <Cookie size={22} className="text-[#ff4500] shrink-0 hidden sm:block" />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500] mb-1.5">
            ◆ Cookies & Privacy
          </p>
          <p className="font-mono text-[12px] text-[#e5e5e5] leading-relaxed">
            We use cookies for analytics (Google Analytics) and advertising (Microsoft Ads).
            You can accept all, reject all, or read our{" "}
            <Link to="/policy#privacy" className="text-[#ff4500] hover:underline" data-testid="cookie-banner-policy-link">
              privacy policy
            </Link>
            . You can change this any time via the footer's{" "}
            <em className="text-[#a3a3a3] not-italic">Cookie preferences</em> link.
          </p>
        </div>
        <div className="flex items-stretch gap-2 shrink-0 w-full md:w-auto">
          <button
            type="button"
            onClick={onReject}
            className="px-4 py-2.5 border border-[#262626] hover:border-[#525252] text-[#a3a3a3] hover:text-[#e5e5e5] font-mono text-[10px] uppercase tracking-[0.22em] transition flex-1 md:flex-none"
            data-testid="cookie-banner-reject"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="px-5 py-2.5 bg-[#ff4500] hover:bg-[#cc3700] text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition flex-1 md:flex-none"
            data-testid="cookie-banner-accept"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={onReject}
            aria-label="Close (treats as reject all)"
            className="hidden md:inline-flex items-center justify-center w-9 px-0 border border-[#262626] hover:border-[#ff4500] text-[#737373] hover:text-[#ff4500] transition"
            data-testid="cookie-banner-close"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
