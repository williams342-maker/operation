import React, { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { fetchMakerSubscription, openMakerSubscriptionPortal } from "../../lib/api";

/**
 * Sticky trial-progress banner for makers on their free 3-month Crafters
 * Plus trial. Shows days remaining and a one-click path into the Stripe
 * billing portal so they can confirm or update their card before the
 * automatic conversion.
 *
 * Renders nothing for makers who:
 *   - Aren't currently in trial (`is_in_trial=false`)
 *   - Have dismissed it this session
 *   - Have no subscription data yet
 *
 * The component owns its own fetch — that way every tab in the dashboard
 * gets the same banner without each tab having to plumb the same data.
 */
export default function TrialBanner() {
  const [sub, setSub] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("cm_maker_jwt")) return;
    fetchMakerSubscription().then(setSub).catch(() => {});
    // Hide for the rest of this tab session if the maker closed it.
    try {
      if (sessionStorage.getItem("cm_trial_banner_dismissed") === "1") {
        setDismissed(true);
      }
    } catch {/* sessionStorage may be unavailable */}
  }, []);

  if (!sub || !sub.is_in_trial || dismissed) return null;

  const days = sub.trial_days_remaining;
  const endDate = sub.trial_end_at
    ? new Date(sub.trial_end_at).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "numeric",
      })
    : null;

  // Color shifts as the trial gets closer to ending — gentle nudge, not
  // a panic banner.
  const urgent = typeof days === "number" && days <= 7;

  const handleManage = async () => {
    setBusy(true);
    try {
      const { url } = await openMakerSubscriptionPortal();
      if (url) window.location.href = url;
    } catch {
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem("cm_trial_banner_dismissed", "1"); } catch {/* noop */}
  };

  return (
    <div
      className={`mb-5 border ${
        urgent ? "border-[#ff4500] bg-[#ff4500]/10" : "border-emerald-700/60 bg-emerald-900/15"
      } px-4 py-3 md:px-5 md:py-4 flex items-center gap-3 flex-wrap`}
      data-testid="plus-trial-banner"
    >
      <div className={`shrink-0 ${urgent ? "text-[#ff4500]" : "text-emerald-300"}`}>
        <Sparkles size={18} />
      </div>
      <div className="flex-1 min-w-[200px]">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
          ◆ Crafters Plus · free trial
        </div>
        <div className="font-mono text-xs md:text-sm text-[#e5e5e5] leading-relaxed">
          {typeof days === "number" ? (
            <>
              <strong className={urgent ? "text-[#ff4500]" : "text-emerald-300"}>
                {days} day{days === 1 ? "" : "s"} left
              </strong>{" "}
              on your 3-month trial.{" "}
              {endDate && (
                <span className="text-[#a3a3a3]">
                  Converts to $12/mo on <span className="text-[#e5e5e5]">{endDate}</span>.
                </span>
              )}
            </>
          ) : (
            <>Your 3-month free trial is active. {endDate && <>Converts to $12/mo on {endDate}.</>}</>
          )}
        </div>
      </div>
      <button
        onClick={handleManage}
        disabled={busy}
        className={`btn-industrial ${urgent ? "btn-primary" : "btn-outline"} text-[11px] disabled:opacity-50`}
        data-testid="plus-trial-manage-btn"
      >
        {busy ? "Opening…" : "Manage billing"} →
      </button>
      <button
        onClick={handleDismiss}
        className="text-[#737373] hover:text-[#e5e5e5] transition shrink-0"
        aria-label="Dismiss trial reminder"
        data-testid="plus-trial-dismiss-btn"
      >
        <X size={16} />
      </button>
    </div>
  );
}
