import React, { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/**
 * Catch-all 404 page (iter372 · hardened iter413bx).
 *
 * The SPA can't return a real HTTP 404 status, so unknown routes used to
 * render a blank 200 page — which Google flags as a soft-404. We inject
 * `<meta name="robots" content="noindex">` (Google renders JS, sees it,
 * and drops the URL from the index) and give humans clear ways back.
 *
 * iter413bx — Expanded the recovery shortcuts so a maker who hits a
 * stale magic link (common after a JWT-secret-changing deploy or a
 * rollback) lands on something useful instead of bouncing to /shop.
 * The page now exposes: Maker Login · Buyer Login · Apply · Home ·
 * Support email — covering every "I just got logged out" recovery path.
 */
export default function NotFoundPage() {
  const { pathname } = useLocation();

  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex";
    document.head.appendChild(m);

    // iter413bz — Fire a tiny beacon so the admin Ops Dashboard can
    // surface "top stale links this week" and we can pre-empt broken-
    // bookmark clusters within 24h instead of waiting for a maker
    // report. sendBeacon survives a fast back-button bounce; fall back
    // to fetch when it isn't available. Best-effort, never throws.
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const role = localStorage.getItem("cm_maker_jwt")
        ? "maker"
        : localStorage.getItem("cm_admin_jwt")
        ? "admin"
        : localStorage.getItem("cm_buyer_jwt")
        ? "buyer"
        : "anon";
      const payload = JSON.stringify({
        path: pathname || "",
        referer: document.referrer || "",
        signed_in_role: role,
      });
      const url = `${API}/api/not-found/log`;
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      } else {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => { /* best-effort */ });
      }
    } catch { /* never let ops telemetry break the recovery page */ }

    return () => m.remove();
  }, [pathname]);

  // iter413bx — Heuristic: if the URL the user landed on suggests they
  // were trying to log in or access a maker page, show maker-login as
  // the primary CTA. Otherwise default to the marketplace as before.
  const looksLikeMakerPath = /\b(maker|login|signin|dashboard|account|magic|verify|reset)\b/i.test(pathname);

  return (
    <div className="pt-40 pb-32 min-h-screen text-center grain" data-testid="not-found-page">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">◆ 404 · Page</div>
      <h1 className="font-heading uppercase text-4xl sm:text-5xl text-ink mb-4">This page isn&apos;t here.</h1>
      <p className="font-body text-ink-muted mb-2 max-w-md mx-auto">
        The link may be old, mistyped, or the page has moved.
      </p>
      <p className="font-mono text-xs text-ink-muted mb-8 max-w-md mx-auto">
        {looksLikeMakerPath
          ? "If you're a maker trying to sign in, request a fresh magic link below."
          : "The marketplace is one click away."}
      </p>

      <div className="flex items-center justify-center gap-3 flex-wrap mb-6">
        {looksLikeMakerPath ? (
          <>
            <Link
              to="/maker/login"
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand hover:bg-brand-hover text-white font-mono text-xs uppercase tracking-[0.22em]"
              data-testid="not-found-maker-login-link"
            >
              <ArrowLeft size={14} /> Maker login
            </Link>
            <Link
              to="/shop"
              className="inline-flex items-center gap-2 px-6 py-3 border border-line hover:border-brand hover:text-brand font-mono text-xs uppercase tracking-[0.22em]"
              data-testid="not-found-shop-link"
            >
              Browse the marketplace
            </Link>
          </>
        ) : (
          <>
            <Link
              to="/shop"
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand hover:bg-brand-hover text-white font-mono text-xs uppercase tracking-[0.22em]"
              data-testid="not-found-shop-link"
            >
              <ArrowLeft size={14} /> Browse the marketplace
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-6 py-3 border border-line hover:border-brand hover:text-brand font-mono text-xs uppercase tracking-[0.22em]"
              data-testid="not-found-home-link"
            >
              Home
            </Link>
          </>
        )}
      </div>

      {/* iter413bx — Always-on recovery rail. Tiny links to every
          entry point so nobody is stranded regardless of what failed. */}
      <div
        className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted flex items-center justify-center gap-x-4 gap-y-2 flex-wrap"
        data-testid="not-found-recovery-rail"
      >
        <Link to="/maker/login" className="hover:text-brand">Maker login</Link>
        <span aria-hidden>·</span>
        <Link to="/login" className="hover:text-brand">Buyer login</Link>
        <span aria-hidden>·</span>
        <Link to="/apply" className="hover:text-brand">Apply to sell</Link>
        <span aria-hidden>·</span>
        <Link to="/" className="hover:text-brand">Home</Link>
        <span aria-hidden>·</span>
        <a
          href="mailto:hello@craftersmarket.org?subject=Site%20access%20problem"
          className="hover:text-brand"
          data-testid="not-found-support-link"
        >
          Email support
        </a>
      </div>
    </div>
  );
}
