import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { verifyAdminToken } from "../lib/api";

export default function AdminVerify() {
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
        const res = await verifyAdminToken(token);
        localStorage.setItem("cm_admin_jwt", res.token);
        // iter106 — honor a deep-link target stashed by AdminDashboard
        // before the redirect to /admin/login (e.g. clicking a Slack
        // webhook link to /admin/dashboard?tab=feedback&open=<id> while
        // logged out). Whitelist the path prefix so a tampered
        // localStorage value can't open-redirect us off-domain.
        const after = (() => {
          try { return localStorage.getItem("cm_admin_after") || ""; } catch { return ""; }
        })();
        try { localStorage.removeItem("cm_admin_after"); } catch {}
        navigate(
          after && after.startsWith("/admin/") ? after : "/admin/dashboard",
          { replace: true },
        );
      } catch (err) {
        setError(err?.response?.data?.detail || "Could not verify the link.");
      }
    })();
  }, [params, navigate]);

  return (
    <div className="pt-40 pb-24 min-h-screen grain text-center px-4" data-testid="admin-verify">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
        ◆ {error ? "Link Issue" : "Verifying…"}
      </div>
      <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] mb-6 uppercase">
        {error ? "Try Again." : "One Moment."}
      </h1>
      <p className="font-mono text-sm text-ink-muted max-w-lg mx-auto mb-10">
        {error || "Validating your operator link."}
      </p>
      {error && (
        <Link to="/admin/login" className="btn-industrial btn-primary inline-flex" data-testid="admin-verify-back">
          Request New Link →
        </Link>
      )}
    </div>
  );
}
