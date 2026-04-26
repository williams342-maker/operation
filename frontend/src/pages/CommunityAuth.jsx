import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { communityRequestMagic, communityVerifyMagic, communityGoogleExchange } from "../lib/api";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
const googleSignIn = () => {
  const redirectUrl = window.location.origin + "/community/auth/callback";
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
};

export function CommunityLogin() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ status: "idle", message: "" });

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;
    setState({ status: "loading", message: "" });
    try {
      const r = await communityRequestMagic(email.trim(), window.location.origin);
      setState({ status: "sent", message: r.message });
    } catch {
      setState({ status: "error", message: "Could not send the link." });
    }
  };

  return (
    <div className="pt-40 pb-24 min-h-screen grain px-4" data-testid="community-login">
      <div className="max-w-xl mx-auto">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
          ◆ Community Access
        </div>
        <h1 className="font-display text-[56px] md:text-[88px] leading-[0.88] mb-6 uppercase">
          Sign In.
        </h1>
        <p className="font-mono text-sm text-[#a3a3a3] mb-10">
          Join the conversation — showcase your pieces, swap design files, post in the forum,
          chat live with makers.
        </p>

        <button
          onClick={googleSignIn}
          className="w-full bg-[#fff] text-black border border-[#fff] hover:bg-[#e5e5e5] py-3 px-5 font-mono text-[11px] uppercase tracking-[0.22em] flex items-center justify-center gap-3"
          data-testid="community-google-btn"
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.13 4.13 0 0 1-1.79 2.71v2.26h2.9c1.7-1.57 2.69-3.88 2.69-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.36 0-4.36-1.6-5.07-3.74H.96v2.34A9 9 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.93 10.71A5.4 5.4 0 0 1 3.65 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.97-2.33z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.43 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96l2.97 2.33C4.64 5.15 6.64 3.58 9 3.58z"/>
          </svg>
          Sign in with Google
        </button>

        <div className="my-6 flex items-center gap-3">
          <div className="flex-1 h-px bg-[#262626]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">or magic link</span>
          <div className="flex-1 h-px bg-[#262626]" />
        </div>

        <form onSubmit={onSubmit} className="space-y-3" data-testid="community-magic-form">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={state.status !== "idle" && state.status !== "error"}
            placeholder="you@example.com"
            className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5]"
            data-testid="community-email"
          />
          <button
            type="submit"
            disabled={state.status === "loading" || state.status === "sent"}
            className="btn-industrial btn-primary w-full disabled:opacity-60"
            data-testid="community-magic-submit"
          >
            {state.status === "loading" ? "Sending…" : state.status === "sent" ? "Link Sent ✓" : "Email me a link →"}
          </button>
        </form>
        {state.status === "sent" && (
          <p className="mt-4 font-mono text-xs text-[#a3a3a3]" data-testid="community-magic-sent">
            ◆ Check your inbox: {state.message}
          </p>
        )}
        {state.status === "error" && (
          <p className="mt-4 font-mono text-xs text-red-400">Couldn't send. Try again.</p>
        )}
        <p className="mt-10 font-mono text-[11px] text-[#525252] uppercase tracking-[0.22em]">
          Maker? <Link to="/maker/login" className="text-[#ff4500]">Sign in to your shop →</Link>
        </p>
      </div>
    </div>
  );
}

export function CommunityVerify() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get("token");
    if (!token) { setError("Missing token"); return; }
    (async () => {
      try {
        const r = await communityVerifyMagic(token);
        localStorage.setItem("cm_buyer_jwt", r.token);
        localStorage.setItem("cm_buyer_email", r.user.email);
        navigate("/community", { replace: true });
      } catch (e) { setError(e?.response?.data?.detail || "Could not verify the link."); }
    })();
  }, [params, navigate]);
  return (
    <div className="pt-40 pb-24 min-h-screen grain text-center px-4" data-testid="community-verify">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
        ◆ {error ? "Issue" : "Verifying…"}
      </div>
      <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] mb-6 uppercase">
        {error ? "Try Again." : "Welcome."}
      </h1>
      <p className="font-mono text-sm text-[#a3a3a3] max-w-lg mx-auto">{error || "Validating your link…"}</p>
      {error && (
        <Link to="/community/login" className="btn-industrial btn-primary inline-flex mt-8" data-testid="community-verify-back">
          Try again →
        </Link>
      )}
    </div>
  );
}

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export function CommunityAuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const hash = window.location.hash || "";
    const m = hash.match(/session_id=([^&]+)/);
    if (!m) { setError("Missing session_id from Google"); return; }
    const sid = decodeURIComponent(m[1]);
    (async () => {
      try {
        const r = await communityGoogleExchange(sid);
        localStorage.setItem("cm_buyer_jwt", r.token);
        localStorage.setItem("cm_buyer_email", r.user.email);
        // strip hash and navigate
        window.history.replaceState({}, "", window.location.pathname);
        navigate("/community", { replace: true });
      } catch {
        setError("Sign-in failed. Please try again.");
      }
    })();
  }, [navigate]);
  return (
    <div className="pt-40 pb-24 min-h-screen grain text-center px-4" data-testid="community-auth-callback">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
        ◆ {error ? "Issue" : "Signing you in…"}
      </div>
      <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] mb-6 uppercase">
        {error ? "Try Again." : "One Moment."}
      </h1>
      <p className="font-mono text-sm text-[#a3a3a3] max-w-lg mx-auto">{error || "Talking to Google…"}</p>
      {error && <Link to="/community/login" className="btn-industrial btn-primary inline-flex mt-8">Back to sign-in →</Link>}
    </div>
  );
}
