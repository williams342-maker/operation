import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { verifyMakerToken } from "../lib/api";

export default function MakerVerify() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get("token");
    if (!token) {
      setError("Missing token in link.");
      return;
    }
    (async () => {
      try {
        const res = await verifyMakerToken(token);
        localStorage.setItem("cm_maker_jwt", res.token);
        localStorage.setItem("cm_maker_slug", res.maker.slug);
        // Honor the "Keep me signed in" preference set on MakerLogin.
        // "1" (default) → persistent session, no expiry key stored.
        // "0"           → ephemeral ~8-hour session; api.js purges on
        //                 every page load / authed request once expired.
        const persist = localStorage.getItem("cm_maker_persist");
        if (persist === "0") {
          const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
          localStorage.setItem("cm_maker_jwt_exp", String(Date.now() + EIGHT_HOURS_MS));
        } else {
          localStorage.removeItem("cm_maker_jwt_exp");
        }
        navigate("/maker/dashboard", { replace: true });
      } catch (err) {
        setError(err?.response?.data?.detail || "Could not verify the link.");
      }
    })();
  }, [params, navigate]);

  return (
    <div className="pt-40 pb-24 min-h-screen grain text-center px-4" data-testid="maker-verify">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
        ◆ {error ? "Link Issue" : "Verifying…"}
      </div>
      <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] mb-6 uppercase">
        {error ? "Try Again." : "One Moment."}
      </h1>
      <p className="font-mono text-sm text-ink-muted max-w-lg mx-auto mb-10">
        {error || "Validating your sign-in link with the workshop."}
      </p>
      {error && (
        <Link
          to="/maker/login"
          className="btn-industrial btn-primary inline-flex"
          data-testid="maker-verify-back"
        >
          Request New Link →
        </Link>
      )}
    </div>
  );
}
