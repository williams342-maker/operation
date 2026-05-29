/**
 * iter287 — WelcomeBackToast
 *
 * Fires a one-shot "Welcome back, {name}" toast on first page-load of
 * a session where the user has a valid JWT. Uses `sessionStorage` for
 * the once-per-session gate (clears on tab close so a returning visitor
 * tomorrow gets greeted again).
 *
 * Lookup path:
 *   • role=maker → GET /api/maker/me  (`name` or `shop_name`)
 *   • role=buyer → GET /api/community/me  (`name` or `display_name`)
 *   • role=admin → no toast (admin flow is task-focused, a welcome would feel chatty)
 *
 * Failure modes are silent — a stale-token 401 is already handled by the
 * iter285 interceptor; we just skip the greeting if the lookup fails.
 *
 * Sits as a hidden sibling next to <Toaster /> in the app root.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import useAuth from "../hooks/useAuth";
import { http } from "../lib/api";


const FLAG = "cm_welcomed_v1";


export default function WelcomeBackToast() {
  const { signedIn, role, token, slug } = useAuth();

  useEffect(() => {
    if (!signedIn || !token) return;
    // Once-per-session gate. Key the flag on the JWT signature segment
    // so signing OUT then back IN with a different account still greets
    // the new user (different JWT → different last-segment → no match).
    const sig = (token.split(".")[2] || "").slice(0, 32);
    let flagged = null;
    try { flagged = sessionStorage.getItem(FLAG); } catch { /* private mode */ }
    if (flagged === sig) return;

    let cancelled = false;
    const endpoint = role === "maker" ? "/maker/me" : "/community/me";
    http
      .get(endpoint, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (cancelled) return;
        const u = r.data || {};
        // Prefer shop_name for makers (their brand), name for buyers.
        const name = role === "maker"
          ? (u.shop_name || u.name || slug)
          : (u.name || u.display_name || u.first_name || slug);
        if (!name) return;  // anonymous-ish — skip rather than say "Welcome back, undefined"
        // Trim to first name only when it's clearly "First Last" — feels
        // friendlier than the full legal name.
        const greet = String(name).trim().split(/\s+/)[0] || name;
        toast.success(`Welcome back, ${greet} 👋`, {
          duration: 3500,
          // No action button — a welcome shouldn't demand a click.
          // Subtle hint about where they were last:
          description: role === "maker"
            ? "Your dashboard is one tap away in the nav."
            : null,
        });
        try { sessionStorage.setItem(FLAG, sig); } catch { /* ignore */ }
      })
      .catch(() => {
        // Token might have been invalidated server-side, or a network
        // hiccup. Either way: don't greet, don't crash, the rest of the
        // app handles 401 via the global interceptor.
      });

    return () => { cancelled = true; };
  }, [signedIn, role, token, slug]);

  return null;
}
