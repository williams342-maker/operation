import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { stripeConnectStatus } from "../lib/api";

/**
 * Landing page after Stripe-hosted Express onboarding redirects back.
 * If the maker's account is fully ready, we celebrate and bounce them to
 * the dashboard. If not, we explain what's still needed and offer to resume.
 */
export default function MakerStripeReturn() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!localStorage.getItem("cm_maker_jwt")) {
      navigate("/maker/login", { replace: true });
      return;
    }
    (async () => {
      try {
        const s = await stripeConnectStatus();
        setStatus(s);
      } catch (e) {
        setErr(e?.response?.data?.detail || "Could not verify Stripe status.");
      }
    })();
  }, [navigate]);

  const ready = status?.connected && status?.charges_enabled && status?.payouts_enabled;

  return (
    <div className="pt-40 pb-24 min-h-screen grain text-center px-4" data-testid="stripe-return">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
        ◆ Stripe Connect
      </div>
      <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] mb-6 uppercase">
        {ready ? "You're In." : status ? "Almost There." : "Checking…"}
      </h1>
      <p className="font-mono text-sm text-[#a3a3a3] max-w-lg mx-auto mb-10">
        {ready
          ? "Your Stripe account is fully connected. Future paid orders will transfer your share automatically (10% platform fee retained)."
          : status
            ? "Stripe still needs a few more details before payouts can be enabled. Head back to your dashboard to resume — it'll only take a minute."
            : "Verifying your account status with Stripe…"}
      </p>
      {err && <p className="font-mono text-[11px] text-red-400 mb-6">{err}</p>}
      <Link
        to="/maker/dashboard"
        className="btn-industrial btn-primary inline-flex"
        data-testid="stripe-return-back-btn"
      >
        Back to dashboard →
      </Link>
    </div>
  );
}
