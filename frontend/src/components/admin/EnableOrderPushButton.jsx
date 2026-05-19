import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff, BellRing } from "lucide-react";
import {
  isPushSupported,
  getCurrentPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "../../lib/push";

/**
 * EnableOrderPushButton
 * ----------------------
 * Admin-only opt-in card. One tap subscribes this device (laptop or
 * phone) to Web Push and tags the subscription as role="admin" so
 * the checkout flow's `notify_admins_new_order` helper can fan-out
 * to it whenever a live order lands.
 *
 * UX:
 *   - Hidden entirely when the browser doesn't support Web Push (Safari
 *     iOS < 16.4 etc.). Better to not advertise than to render a
 *     non-functional CTA.
 *   - States: unsupported · idle · subscribing · enabled · denied
 *   - "Disable" path is also exposed so an admin can revoke from the
 *     same surface without digging through browser settings.
 *   - Posting role="admin" is critical — without it the backend
 *     would tag this device as `anon` and never broadcast to it.
 *
 * Placed in the dashboard header rail beside the other admin tools.
 */
const STORE_KEY = "admin_email";

export default function EnableOrderPushButton() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) return;
    setSupported(true);
    if (typeof Notification !== "undefined" && Notification.permission === "denied") {
      setDenied(true);
    }
    getCurrentPushSubscription()
      .then((s) => setSubscribed(!!s))
      .catch(() => {});
  }, []);

  if (!supported) return null;

  const enable = async () => {
    setBusy(true);
    try {
      const email = (localStorage.getItem(STORE_KEY) || "").trim() || undefined;
      await subscribeToPush({ role: "admin", email });
      setSubscribed(true);
      setDenied(false);
      toast.success("Order notifications enabled", {
        description: "We'll ping this device the moment a real buyer checks out.",
      });
    } catch (e) {
      if (String(e?.message || "").toLowerCase().includes("denied")) {
        setDenied(true);
        toast.error("Notifications blocked", {
          description: "Re-enable in browser site settings → Notifications.",
        });
      } else {
        toast.error("Could not enable notifications", {
          description: e?.message || "Try again in a moment.",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      setSubscribed(false);
      toast.message("Order notifications disabled on this device");
    } catch (e) {
      toast.error("Could not disable", { description: e?.message || "" });
    } finally {
      setBusy(false);
    }
  };

  if (denied) {
    return (
      <div
        className="inline-flex items-center gap-2 px-3 py-1.5 border border-amber-700/40 bg-amber-900/10 text-amber-300/90 font-mono text-[10px] uppercase tracking-[0.22em]"
        data-testid="order-push-denied"
        title="Notifications were blocked. Re-enable in browser site settings."
      >
        <BellOff size={12} />
        Push blocked
      </div>
    );
  }

  if (subscribed) {
    return (
      <button
        type="button"
        onClick={disable}
        disabled={busy}
        data-testid="order-push-disable-btn"
        className="inline-flex items-center gap-2 px-3 py-1.5 border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 transition-colors"
        title="Click to stop receiving order notifications on this device"
      >
        <BellRing size={12} />
        {busy ? "Saving…" : "Order pings on"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={enable}
      disabled={busy}
      data-testid="order-push-enable-btn"
      className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 transition-colors"
      title="Send a 💰 ping to this device when a real order lands"
    >
      <Bell size={12} />
      {busy ? "Connecting…" : "Notify me on new orders"}
    </button>
  );
}
