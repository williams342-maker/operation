/**
 * iter286 — useAuth hook.
 *
 * Replaces the codebase-wide "presence check" pattern
 *   `const signedIn = !!localStorage.getItem("cm_maker_jwt")`
 * with a hook that ACTUALLY validates the JWT's `exp` claim client-side.
 *
 * Why bother?
 *   • An expired JWT lingering in localStorage made the UI look signed-
 *     in but every API call 401'd → confusing "Invalid session" toasts.
 *   • The api.js interceptor (iter285) reactively cleans up after a
 *     failed call. This hook is the proactive complement: gated buttons
 *     never even render in their "enabled" state for an expired session.
 *
 * Trust model: We only validate `exp` here — we don't re-verify the
 * signature (impossible without the server's secret). The server
 * remains the source of truth on every request. This hook just stops
 * the UI from offering actions that will definitely 401.
 *
 * Returned shape (stable across renders):
 *   { signedIn:bool, role:"maker"|"buyer"|null, sub:string|null,
 *     slug:string|null, token:string|null, exp:number|null,
 *     prefersMaker:bool, signOut:()=>void }
 */
import { useCallback, useEffect, useState } from "react";


const MAKER_KEY = "cm_maker_jwt";
const BUYER_KEY = "cm_buyer_jwt";


/** Decode `eyJ...payload...` middle segment without verifying signature. */
function decodePayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    // base64url → base64 (replace `-` `_`, pad with `=`)
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch {
    return null;
  }
}


function isExpired(payload) {
  if (!payload || typeof payload.exp !== "number") return false;
  // Compare in seconds (JWT `exp` is unix-seconds). 5s skew for clock drift.
  return Date.now() / 1000 > payload.exp + 5;
}


/** Returns the best available token + which role it belongs to.
 *  Maker wins when both exist (the maker dashboard is the higher-
 *  privilege flow and the cart still works under maker auth too). */
function readBest() {
  if (typeof window === "undefined") return { token: null, role: null };
  let token = null;
  let role = null;
  try {
    token = localStorage.getItem(MAKER_KEY) || null;
    if (token) role = "maker";
    if (!token) {
      token = localStorage.getItem(BUYER_KEY) || null;
      if (token) role = "buyer";
    }
  } catch {
    // private-mode / quota — treat as signed-out
  }
  if (!token) return { token: null, role: null };
  const payload = decodePayload(token);
  if (!payload || isExpired(payload)) {
    // Don't return a doomed-to-401 token. Clean it up here so the next
    // read sees an empty slot.
    try {
      if (role === "maker") {
        localStorage.removeItem(MAKER_KEY);
        localStorage.removeItem("cm_maker_slug");
        localStorage.removeItem("cm_maker_jwt_exp");
      } else {
        localStorage.removeItem(BUYER_KEY);
      }
    } catch { /* ignore */ }
    return { token: null, role: null };
  }
  return { token, role, payload };
}


export function useAuth() {
  // Lazy init so SSR and first paint share the same value.
  const [state, setState] = useState(() => {
    const r = readBest();
    return {
      signedIn: !!r.token,
      role: r.role,
      token: r.token,
      sub: r.payload?.sub || null,
      slug: r.payload?.slug || r.payload?.sub || null,
      exp: r.payload?.exp || null,
      prefersMaker: r.role === "maker",
    };
  });

  const refresh = useCallback(() => {
    const r = readBest();
    setState({
      signedIn: !!r.token,
      role: r.role,
      token: r.token,
      sub: r.payload?.sub || null,
      slug: r.payload?.slug || r.payload?.sub || null,
      exp: r.payload?.exp || null,
      prefersMaker: r.role === "maker",
    });
  }, []);

  useEffect(() => {
    // Cross-tab: another tab signed in/out → reflect it here.
    const onStorage = (e) => {
      if (e.key === MAKER_KEY || e.key === BUYER_KEY) refresh();
    };
    // On window focus: returning to the tab after the JWT expired,
    // re-read so the UI immediately switches to signed-out.
    const onFocus = () => refresh();

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);

    // Schedule a one-shot timer that fires exactly when the JWT
    // expires (capped at 24h for sanity) so a long-open tab catches
    // expiry without needing a user interaction.
    let timer = null;
    if (state.exp) {
      const msUntilExpiry = Math.max(
        1000,
        Math.min(24 * 3600 * 1000, state.exp * 1000 - Date.now() + 1000),
      );
      timer = setTimeout(refresh, msUntilExpiry);
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      if (timer) clearTimeout(timer);
    };
  }, [refresh, state.exp]);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(MAKER_KEY);
      localStorage.removeItem(BUYER_KEY);
      localStorage.removeItem("cm_maker_slug");
      localStorage.removeItem("cm_maker_jwt_exp");
    } catch { /* ignore */ }
    refresh();
  }, [refresh]);

  return { ...state, refresh, signOut };
}


export default useAuth;
