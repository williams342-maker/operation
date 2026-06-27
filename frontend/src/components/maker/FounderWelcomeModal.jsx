import React, { useEffect } from "react";
import confetti from "canvas-confetti";
import { Sparkles, X } from "lucide-react";
import { ackFounderWelcome } from "../../lib/api";
import { isFounder, isInauguralFounder } from "../../lib/founderTier";
import useModalA11y from "../../hooks/useModalA11y";

/**
 * iter413dd — One-time Founder welcome modal.
 *
 * Fires on the maker's FIRST dashboard load after promotion. Same identity
 * payload as the elevated welcome email (iter413dc), second touchpoint
 * inside the product. Visually mirrors the email's Founder banner so the
 * recipient gets a coherent moment: opens email → "You're Inaugural
 * Founder #015 of 100" → clicks portal CTA → lands in dashboard → SAME
 * "Founder #015 of 100" moment in-product with confetti, then dismisses
 * to the standard dashboard.
 *
 * Once dismissed, the backend flag `founder_welcome_seen=true` is set so
 * this modal NEVER re-appears for that maker. Standard makers (`tier !==
 * "founder"`) never see it.
 */
export default function FounderWelcomeModal({ maker, onSeen }) {
  const eligible = isFounder(maker) && !maker?.founder_welcome_seen;
  const dismiss = async () => {
    try { await ackFounderWelcome(); } catch (_e) { /* non-blocking */ }
    onSeen?.();
  };
  // iter413dd+ — Deep-link variant: ack the modal AND route the user
  // into Settings → Account & Plan, then scroll the Vanity URL card
  // into view. Turns the celebration moment into the first real act
  // of ownership (claiming /makers/<name>) instead of a passive teaser.
  const dismissAndClaimVanity = async () => {
    await dismiss();
    // Open Settings → Account section via the existing event the
    // dashboard already listens for (`cm:open-settings`).
    window.dispatchEvent(new CustomEvent("cm:open-settings", {
      detail: { section: "account" },
    }));
    // The dashboard also reads `?tab=settings` to switch tabs when
    // already mounted — set both so direct deep-links survive any
    // route remount.
    const url = "/maker/dashboard?tab=settings&section=account";
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
    // Scroll into view after the section paints. Two RAFs cover the
    // worst case where SettingsTab re-renders after the event.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector('[data-testid="custom-url-section"]')
              || document.querySelector('[data-testid="custom-url-locked"]');
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  };
  // Esc-to-dismiss + focus-trap. Hook returns a ref the dialog mounts on.
  const dialogRef = useModalA11y(dismiss);

  // Fire confetti once when the modal opens — small, classy, top-down,
  // brand-orange. Skipped on reduced-motion preference.
  useEffect(() => {
    if (!eligible) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => {
      try {
        confetti({
          particleCount: 60, spread: 70, startVelocity: 32,
          origin: { y: 0.18 },
          colors: ["#ff4500", "#e8a87c", "#fafafa", "#737373"],
          scalar: 0.9,
        });
      } catch (_e) { /* canvas-confetti is a best-effort flourish */ }
    }, 220);
    return () => clearTimeout(t);
  }, [eligible]);

  if (!eligible) return null;

  const inaugural = isInauguralFounder(maker);
  const num = maker.founder_number;
  const numLabel = num ? `#${String(num).padStart(3, "0")}` : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={dismiss}
      data-testid="founder-welcome-modal"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="founder-welcome-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-paper border-2 border-brand shadow-2xl"
      >
        <div className="bg-brand text-paper p-5 flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] flex items-center gap-1.5 opacity-90">
              <Sparkles size={12} />
              {inaugural ? "Inaugural Founder · Lifetime" : "Founder · 12-month"}
            </div>
            <h2
              id="founder-welcome-title"
              className="font-display text-4xl uppercase mt-1 leading-none"
              data-testid="founder-welcome-title"
            >
              {inaugural
                ? <>You're Inaugural Founder<br/><span className="text-paper">{numLabel} of 100.</span></>
                : <>You're Founder<br/><span className="text-paper">{numLabel}.</span></>
              }
            </h2>
          </div>
          <button
            onClick={dismiss}
            data-testid="founder-welcome-close"
            aria-label="Close welcome"
            className="text-paper hover:opacity-80 transition shrink-0 mt-1"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <p className="font-mono text-sm text-ink leading-relaxed">
            {inaugural ? (
              <>
                You've claimed one of the <b>100 inaugural Founder slots</b>.
                Lifetime tier — your rate never changes.
              </>
            ) : (
              <>
                You've earned the Founder tier for the next <b>12 months</b>.
                We'll email you before it auto-rolls so there are no surprises.
              </>
            )}
          </p>

          <div className="border border-line bg-surface p-4 space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
              ◆ What you get
            </div>
            <ul className="font-mono text-xs text-ink leading-relaxed space-y-1.5 list-none m-0 p-0">
              <li>· <b>3% platform commission</b> (Standard pays 5%)</li>
              <li>· <b>50 free listings every month</b> (Standard gets 10 lifetime)</li>
              <li>· <b>$0 subscription</b> — no monthly fee, ever</li>
              <li>· <b>◆ Founding Maker badge</b> on every product card + shop page</li>
              <li>· <b>Vanity shop URL</b> — claim <span className="text-brand">/makers/your-name</span></li>
            </ul>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={dismiss}
              data-testid="founder-welcome-continue"
              className="flex-1 btn-industrial btn-primary text-xs"
            >
              Open my Workshop →
            </button>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted text-center">
            This greeting won't appear again.
          </p>
        </div>
      </div>
    </div>
  );
}
