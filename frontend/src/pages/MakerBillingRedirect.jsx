import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { startMakerSubscription, fetchMakerMe } from "../lib/api";

/**
 * Pass-through route that kicks off Crafters Plus checkout.
 *
 * The Upgrade CTA lives in 3 places (SettingsTab, PlusUpgradeNudge,
 * UpgradeTab) and previously pointed at `/maker/billing` — which did not
 * exist, resulting in a 404 / blank screen. This page is the canonical
 * redirect target: it hits `POST /api/maker/subscription/start`, swaps
 * the window for the Stripe Checkout URL, and never actually renders a
 * dashboard. On error it shows a friendly fallback with a Back link so
 * the maker isn't stranded.
 *
 * If the maker is already active/trialing on Plus, we skip Stripe and
 * send them back to the dashboard Settings tab where the "active
 * subscription" card lives.
 */
export default function MakerBillingRedirect() {
  const navigate = useNavigate();
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!localStorage.getItem("cm_maker_jwt")) {
      navigate("/maker/login", { replace: true });
      return;
    }
    (async () => {
      try {
        // If the maker is already on Plus, don't run checkout — just
        // return them to the dashboard where the cancel/manage controls
        // live.
        try {
          const me = await fetchMakerMe();
          if (["active", "trialing"].includes(me?.subscription_status)) {
            navigate("/maker/dashboard#settings", { replace: true });
            return;
          }
        } catch {
          // If the /me call fails, fall through to checkout — the
          // backend will still validate eligibility.
        }
        const { checkout_url } = await startMakerSubscription();
        if (checkout_url) {
          window.location.href = checkout_url;
          return;
        }
        setErr("Stripe did not return a checkout URL. Please try again.");
      } catch (e) {
        setErr(e?.response?.data?.detail || "Could not start the upgrade. Please try again.");
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16 bg-[#0a0a0a] text-[#e5e5e5]" data-testid="maker-billing-redirect">
      <div className="max-w-md w-full border border-[#262626] p-8 text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-3">
          ◆ Crafters Plus
        </div>
        {!err ? (
          <>
            <h1 className="font-display text-3xl uppercase mb-3">Opening checkout…</h1>
            <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mb-4">
              Redirecting to Stripe to complete your upgrade. If nothing happens in
              a few seconds, try the button below.
            </p>
            <button
              onClick={async () => {
                setErr("");
                try {
                  const { checkout_url } = await startMakerSubscription();
                  if (checkout_url) window.location.href = checkout_url;
                } catch (e) {
                  setErr(e?.response?.data?.detail || "Could not start the upgrade.");
                }
              }}
              className="btn-industrial btn-primary"
              data-testid="billing-retry"
            >
              Continue to Stripe →
            </button>
          </>
        ) : (
          <>
            <h1 className="font-display text-3xl uppercase mb-3">Couldn't start upgrade.</h1>
            <p className="font-mono text-xs text-red-400 leading-relaxed mb-4" data-testid="billing-error">
              {err}
            </p>
            <button
              onClick={() => navigate("/maker/dashboard", { replace: true })}
              className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] transition"
              data-testid="billing-back"
            >
              Back to dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
