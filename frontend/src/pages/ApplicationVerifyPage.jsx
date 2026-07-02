import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";

/**
 * ApplicationVerifyPage
 *
 * Landing target for the confirm-email link we send after a /apply or
 * /founders application. The signed token lives in the URL query
 * (?token=…); we POST it to /api/applications/verify-email on mount and
 * render one of four states: pending, success, already-verified, error.
 *
 * Not authenticated — the token is single-purpose (7-day expiry, dedicated
 * salt) and only mutates the ``email_verified`` flag on the target
 * application row.
 */
const API = process.env.REACT_APP_BACKEND_URL;

export default function ApplicationVerifyPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState(token ? "pending" : "missing");
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const url = `${API}/api/applications/verify-email?token=${encodeURIComponent(token)}`;
    fetch(url, { method: "GET" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!alive) return;
        if (r.ok && body.ok) {
          setPayload(body);
          setState(body.already_verified ? "already" : "verified");
        } else {
          setError(body.detail || `Verification failed (HTTP ${r.status})`);
          setState("error");
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message || "Network error");
        setState("error");
      });
    return () => { alive = false; };
  }, [token]);

  const label = payload?.is_beta ? "Founding Access" : "Maker";
  return (
    <div className="pt-40 pb-24 min-h-screen text-center grain px-4" data-testid="application-verify-page">
      <div className="inline-flex items-center gap-3 mb-4">
        <span className="h-px w-8 bg-brand" />
        <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand"
              data-testid="verify-status-label">
          {state === "pending" && "Confirming\u2026"}
          {state === "verified" && `${label} \u00b7 Email Confirmed`}
          {state === "already" && `${label} \u00b7 Already Confirmed`}
          {state === "error" && "Confirmation Failed"}
          {state === "missing" && "Confirmation Link Missing"}
        </span>
        <span className="h-px w-8 bg-brand" />
      </div>

      {(state === "verified" || state === "already") && (
        <>
          <h1 className="font-heading uppercase text-5xl sm:text-7xl lg:text-8xl leading-[0.92] tracking-tight text-ink mb-6">
            You&rsquo;re <span className="text-brand">confirmed</span><span className="text-ink">.</span>
          </h1>
          <p className="font-body text-base sm:text-lg text-ink-muted max-w-md mx-auto leading-relaxed mb-6"
             data-testid="verify-success-body">
            {payload?.studio_name ? (
              <>Thanks &mdash; we&rsquo;ve confirmed the email on your <b className="text-ink">{payload.studio_name}</b> application.</>
            ) : (
              <>Thanks &mdash; your application email is confirmed.</>
            )}
            {" "}A founding-team member will review it within 3&ndash;5 business days and email you with a decision.
          </p>
          <div className="mt-8">
            <Link
              to="/"
              className="inline-block px-5 py-3 border border-brand bg-brand/5 text-brand hover:bg-brand hover:text-[#0a0a0a] font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
              data-testid="verify-back-home"
            >
              ← Back to Crafters Market
            </Link>
          </div>
        </>
      )}

      {state === "pending" && (
        <p className="font-mono text-sm text-ink-muted max-w-md mx-auto"
           data-testid="verify-pending-body">
          Hang on &mdash; confirming your application email&hellip;
        </p>
      )}

      {(state === "error" || state === "missing") && (
        <>
          <h1 className="font-heading uppercase text-5xl sm:text-7xl lg:text-8xl leading-[0.92] tracking-tight text-ink mb-6">
            Link <span className="text-brand">not valid</span><span className="text-ink">.</span>
          </h1>
          <p className="font-mono text-sm text-ink-muted max-w-md mx-auto leading-relaxed mb-6"
             data-testid="verify-error-body">
            {state === "missing"
              ? "This URL is missing its confirmation token. Please click the button in the email we sent you."
              : error}
          </p>
          <p className="font-mono text-xs text-ink-muted max-w-md mx-auto mb-8">
            If the link expired, contact us at{" "}
            <a href="mailto:team@craftersmarket.org" className="text-brand hover:underline">
              team@craftersmarket.org
            </a>{" "}
            and we&rsquo;ll re-send a fresh one.
          </p>
          <Link
            to="/apply"
            className="inline-block px-5 py-3 border border-line hover:border-brand text-ink font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
            data-testid="verify-reapply"
          >
            Start a new application
          </Link>
        </>
      )}
    </div>
  );
}
