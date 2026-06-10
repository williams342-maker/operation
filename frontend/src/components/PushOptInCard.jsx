import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  getCurrentPushSubscription,
} from "../lib/push";

// Lightweight CTA shoppers see in places like CheckoutSuccess.
// Auto-hides if the browser doesn't support push, the user already
// subscribed on this device, or notifications are blocked.
//
// Props:
//   role     — 'buyer' | 'maker' | null (anon)
//   email    — optional email to tag the subscription
//   compact  — render a small inline pill (vs. full card)
export default function PushOptInCard({ role = null, email = null, compact = false }) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const ok = isPushSupported();
    setSupported(ok);
    if (!ok) return;
    if (typeof Notification !== "undefined" && Notification.permission === "denied") {
      setDenied(true);
      return;
    }
    getCurrentPushSubscription().then((s) => setSubscribed(!!s)).catch(() => setSubscribed(false));
  }, []);

  if (!supported || subscribed || denied) return null;

  const enable = async () => {
    setBusy(true);
    try {
      await subscribeToPush({ role, email });
      setSubscribed(true);
      toast.success("Notifications on. We'll ping you with order updates and drops.");
    } catch (e) {
      toast.error(e?.message || "Could not enable notifications.");
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try { await unsubscribeFromPush(); setSubscribed(false); } catch { /* ignore */ }
    finally { setBusy(false); }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={enable}
        disabled={busy}
        data-testid="push-optin-compact"
        className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
      >
        {busy ? "…" : "◆ Enable notifications"}
      </button>
    );
  }

  return (
    <div
      className="max-w-lg mx-auto border border-line hover:border-brand transition p-6 mb-10 text-left"
      data-testid="push-optin-card"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted mb-2">
        ◆ Order updates · push notifications
      </div>
      <p className="font-mono text-xs text-ink-muted leading-relaxed mb-4">
        Get a ping the moment your maker accepts the brief, ships the package, or posts a photo of your build.
        No spam — only your orders and rare new-drop alerts.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={enable}
          disabled={busy}
          data-testid="push-optin-enable"
          className="btn-industrial btn-primary inline-flex disabled:opacity-50"
        >
          {busy ? "Enabling…" : "Enable notifications →"}
        </button>
        {subscribed && (
          <button
            onClick={disable}
            disabled={busy}
            data-testid="push-optin-disable"
            className="px-3 py-1.5 border border-line hover:border-rose-500 hover:text-rose-400 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          >
            Turn off
          </button>
        )}
      </div>
    </div>
  );
}
