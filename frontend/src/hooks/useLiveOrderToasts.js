import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * useLiveOrderToasts
 * -------------------
 * Polls /api/admin/live-orders/recent every 30 seconds and fires a sonner
 * toast for each new "sold" activity event the admin hasn't seen yet.
 *
 * Dopamine ticker — when a buyer pays for real on craftersmarket.org,
 * the admin sitting in the dashboard gets a satisfying
 *
 *     💰 New order — $42 from Sarah · Boulder, CO
 *
 * pop-up. Works in live and test mode equally, but it's only meaningful
 * once Stripe is in live mode (real money) because test-mode purchases
 * never reach this code path through Stripe.
 *
 * First poll on mount is a "calibration" — we record the server time and
 * skip toasting any pre-existing events so the dashboard doesn't get
 * spammed with the last 25 orders every time an admin opens the page.
 *
 * Stops polling when the document is hidden so we don't burn API quota
 * on a background tab.
 */
const POLL_INTERVAL_MS = 30_000;
const API = process.env.REACT_APP_BACKEND_URL;

export default function useLiveOrderToasts() {
  const sinceRef = useRef(null);
  const seenIdsRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const token = localStorage.getItem("admin_token");
    if (!token) return; // not logged in — silent no-op

    const poll = async () => {
      if (cancelled || document.hidden) return;
      try {
        const url = new URL(`${API}/api/admin/live-orders/recent`);
        if (sinceRef.current) url.searchParams.set("since", sinceRef.current);
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();

        // First call: calibrate. Don't toast historical orders — just
        // record the server time and seed the seen-set so subsequent
        // polls only fire toasts for genuinely new events.
        if (sinceRef.current === null) {
          (data.events || []).forEach((e) => {
            const id = e.id || `${e.created_at}-${e.text}`;
            seenIdsRef.current.add(id);
          });
          sinceRef.current = data.server_time;
          return;
        }

        // Subsequent calls: toast any event we haven't already shown.
        // Reverse so oldest fires first (chronological feel).
        const newEvents = (data.events || []).slice().reverse();
        newEvents.forEach((e) => {
          const id = e.id || `${e.created_at}-${e.text}`;
          if (seenIdsRef.current.has(id)) return;
          seenIdsRef.current.add(id);

          const amount = Number(e.amount || 0);
          const amountStr = amount > 0
            ? `$${amount.toFixed(2)}`
            : "";
          const loc = e.location && e.location !== "Crafters Market"
            ? ` · ${e.location}`
            : "";
          // Two-line toast: bold title with amount, dim body with text+loc.
          toast.success(
            amountStr ? `💰 New order — ${amountStr}${loc}` : `💰 New order${loc}`,
            {
              description: e.text || "A buyer just checked out.",
              duration: 8000,
              className: "live-order-toast",
            }
          );
        });

        sinceRef.current = data.server_time;
      } catch (err) {
        // Network blip — silently skip this tick. Next poll will catch up.
      }
    };

    // Kick off immediately to calibrate, then on the interval.
    poll();
    timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);
}
