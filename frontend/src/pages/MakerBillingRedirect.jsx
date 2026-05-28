import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
 *
 * iter275 — surfaced the real backend `detail` + HTTP status when
 * checkout fails. Previously the catch fell straight through to a
 * generic "Could not start the upgrade. Please try again." which made
 * stale-JWT and Stripe-config bugs invisible. Now the user sees the
 * specific reason (e.g. "Maker not found.", "Stripe is not
 * configured.", "Maker access required.") and we also log the full
 * error to the console for debugging.
 */
function explainError(e) {
  // axios populates `e.response` only when the server responded.
  // Network errors / CORS rejection / DNS failure leave e.response = undefined.
  if (e?.response) {
    const detail = e.response.data?.detail;
    const status = e.response.status;
    if (detail) return `${detail} (HTTP ${status})`;
    return `Server returned HTTP ${status} with no error detail.`;
  }
  if (e?.message) return `Network error: ${e.message}`;
  return "Could not start the upgrade. Please try again.";
}

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
        } catch (meErr) {
          // If /me returns 401/404, the stored maker JWT is stale —
          // probably from a deleted/renamed shop or a backend secret
          // rotation. Force a re-login instead of staggering through
          // checkout with a doomed token.
          if (meErr?.response?.status === 401 || meErr?.response?.status === 404) {
            try {
              localStorage.removeItem("cm_maker_jwt");
              localStorage.removeItem("cm_maker_jwt_exp");
            } catch {}
            navigate("/maker/login?from=billing-stale", { replace: true });
            return;
          }
        }
        const { checkout_url } = await startMakerSubscription();
        if (checkout_url) {
          window.location.href = checkout_url;
          return;
        }
        setErr("Stripe did not return a checkout URL. Please try again.");
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[MakerBilling] start_subscription failed:", e);
        setErr(explainError(e));
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
                  // eslint-disable-next-line no-console
                  console.error("[MakerBilling] retry failed:", e);
                  setErr(explainError(e));
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
            <p className="font-mono text-[10px] text-[#737373] leading-relaxed mb-5">
              If this keeps happening, sign out and back in to refresh your maker
              session, then try the Upgrade button again from your dashboard.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Link
                to="/maker/dashboard"
                className="btn-industrial"
                data-testid="billing-back-dashboard"
              >
                Back to dashboard
              </Link>
              <Link
                to="/maker/login?from=billing-error"
                className="btn-industrial"
                data-testid="billing-re-signin"
              >
                Sign back in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
