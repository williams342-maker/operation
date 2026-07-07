import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { fetchAuthFlags as fetchFlagsForApple, appleSignInStartUrl as appleStartUrl } from "../lib/api";
import {
  communityRequestMagic, communityVerifyMagic, communityGoogleExchange,
  fetchCommunityEua,
} from "../lib/api";
import { trackConversion } from "../lib/googleAdsConversions";
import { trackMeta } from "../lib/metaPixel";
import { tiktokTrack } from "../lib/tiktokPixel";
import { uetSetPII } from "../lib/consent";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
const googleSignIn = () => {
  const redirectUrl = window.location.origin + "/community/auth/callback";
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
};

const EUA_KEY = "cm_eua_accepted_version";

export function CommunityLogin() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ status: "idle", message: "" });
  const [eua, setEua] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [appleEnabled, setAppleEnabled] = useState(false);

  useEffect(() => {
    fetchCommunityEua().then(setEua).catch(() => {});
    fetchFlagsForApple().then((f) => setAppleEnabled(!!f.apple_enabled)).catch(() => {});
  }, []);

  const stampAndPersist = () => {
    if (!eua?.version) return "";
    sessionStorage.setItem(EUA_KEY, eua.version);
    return eua.version;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;
    if (!accepted) {
      setState({ status: "error", message: "Please accept the Community Terms to continue." });
      return;
    }
    setState({ status: "loading", message: "" });
    try {
      const v = stampAndPersist();
      const r = await communityRequestMagic(email.trim(), window.location.origin, v);
      setState({ status: "sent", message: r.message });
      // iter413av — Bing Enhanced Conversion: pass email at the moment
      // the visitor identifies. Subsequent UET events (sign_up after
      // they click the magic link) inherit this PII for offline match.
      try { uetSetPII({ email: email.trim() }); } catch {}
    } catch (e2) {
      setState({
        status: "error",
        message: e2?.response?.data?.detail || "Could not send the link.",
      });
    }
  };

  const onApple = () => {
    if (!accepted) {
      setState({ status: "error", message: "Please accept the Community Terms to continue." });
      return;
    }
    stampAndPersist();
    window.location.href = appleStartUrl(eua?.version);
  };

  const onGoogle = () => {
    if (!accepted) {
      setState({ status: "error", message: "Please accept the Community Terms to continue." });
      return;
    }
    stampAndPersist();
    googleSignIn();
  };

  return (
    <div className="pt-40 pb-24 min-h-screen grain px-4" data-testid="community-login">
      <div className="max-w-xl mx-auto">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
          ◆ Community Access
        </div>
        <h1 className="font-display text-[56px] md:text-[88px] leading-[0.88] mb-6 uppercase">
          Sign In.
        </h1>
        <p className="font-mono text-sm text-ink-muted mb-10">
          Join the conversation — showcase your pieces, swap design files, post in the forum,
          chat live with makers.
        </p>

        {/* EUA acceptance — required gate before either auth path. */}
        {eua && (
          <label
            className={`flex items-start gap-3 mb-6 p-4 border cursor-pointer transition ${
              accepted ? "border-brand" : "border-line hover:border-ink-muted"
            }`}
            data-testid="community-eua-row"
          >
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 accent-[#ff4500]"
              data-testid="community-eua-checkbox"
            />
            <div className="font-mono text-xs text-ink leading-relaxed">
              I agree to the{" "}
              <Link to={eua.links?.policy || "/policies"} target="_blank" className="text-brand underline">
                {eua.title}
              </Link>{" "}
              <span className="text-ink-muted">(v{eua.version})</span>.
              <div className="mt-1 text-[10px] text-ink-muted leading-snug">{eua.summary}</div>
            </div>
          </label>
        )}

        {appleEnabled && (
          <button
            onClick={onApple}
            disabled={!accepted}
            className="w-full bg-black text-white border border-black hover:opacity-85 py-3 px-5 font-mono text-[11px] uppercase tracking-[0.22em] flex items-center justify-center gap-3 mb-3 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="community-apple-btn"
          >
            <svg width="15" height="15" viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true">
              <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/>
            </svg>
            Sign in with Apple
          </button>
        )}

        <button
          onClick={onGoogle}
          disabled={!accepted}
          className="w-full bg-white text-[#1f1f1f] border border-line hover:bg-[#f5f5f5] py-3 px-5 font-mono text-[11px] uppercase tracking-[0.22em] flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
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

        <p
          className="font-mono text-[10px] text-ink-muted mt-3 leading-relaxed"
          data-testid="community-any-email-hint"
        >
          Google is optional — any email works (Outlook, Yahoo, ProtonMail, your own domain).
        </p>

        <div className="my-6 flex items-center gap-3">
          <div className="flex-1 h-px bg-line" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">or use any email</span>
          <div className="flex-1 h-px bg-line" />
        </div>

        <form onSubmit={onSubmit} className="space-y-3" data-testid="community-magic-form">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={state.status !== "idle" && state.status !== "error"}
            placeholder="you@example.com"
            className="w-full bg-transparent border border-line focus:border-brand outline-none px-4 py-3 font-mono text-sm text-ink"
            data-testid="community-email"
          />
          <button
            type="submit"
            disabled={state.status === "loading" || state.status === "sent" || !accepted}
            className="btn-industrial btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="community-magic-submit"
          >
            {state.status === "loading" ? "Sending…" : state.status === "sent" ? "Link Sent ✓" : "Email me a link →"}
          </button>
        </form>
        {state.status === "sent" && (
          <p className="mt-4 font-mono text-xs text-ink-muted" data-testid="community-magic-sent">
            ◆ Check your inbox: {state.message}
          </p>
        )}
        {state.status === "error" && (
          <p className="mt-4 font-mono text-xs text-red-400" data-testid="community-magic-error">
            {state.message || "Couldn't send. Try again."}
          </p>
        )}
        <p className="mt-10 font-mono text-[11px] text-ink-muted uppercase tracking-[0.22em]">
          Maker? <Link to="/maker/login" className="text-brand">Sign in to your shop →</Link>
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
        const v = sessionStorage.getItem("cm_eua_accepted_version") || "";
        const r = await communityVerifyMagic(token, v);
        sessionStorage.removeItem("cm_eua_accepted_version");
        localStorage.setItem("cm_buyer_jwt", r.token);
        localStorage.setItem("cm_buyer_email", r.user.email);
        // Stamp returning-user identity for the /signin "Welcome back" banner
        localStorage.setItem("cm_last_email", r.user.email);
        if (r.user.name) localStorage.setItem("cm_last_name", r.user.name);
        localStorage.setItem("cm_last_signin_at", new Date().toISOString());
        // iter413al — Google Ads `signup_buyer` conversion fires on
        // first-time community signups only (returning sign-ins don't
        // count toward the customer-acquisition target). Wrapped in
        // try/catch so analytics can never block the welcome redirect.
        if (r.is_new_signup) {
          try {
            // iter413cj — Pass the backend-minted event_id into ALL
            // three pixels so Meta + TikTok server-side mirrors dedup
            // with these browser fires into a single attributed conversion.
            const eid = r.signup_event_id || undefined;
            trackConversion("signup_buyer", { event_label: "magic_link", event_id: eid });
            trackMeta("signup_buyer", { event_label: "magic_link", event_id: eid });
            tiktokTrack("signup_buyer", { event_label: "magic_link", event_id: eid });
          }
          catch { /* noop */ }
        }
        // iter249 — first-time community signups go through the welcome flow.
        navigate(r.is_new_signup ? "/welcome" : "/community", { replace: true });
      } catch (e) { setError(e?.response?.data?.detail || "Could not verify the link."); }
    })();
  }, [params, navigate]);
  return (
    <div className="pt-40 pb-24 min-h-screen grain text-center px-4" data-testid="community-verify">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
        ◆ {error ? "Issue" : "Verifying…"}
      </div>
      <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] mb-6 uppercase">
        {error ? "Try Again." : "Welcome."}
      </h1>
      <p className="font-mono text-sm text-ink-muted max-w-lg mx-auto">{error || "Validating your link…"}</p>
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
        const v = sessionStorage.getItem("cm_eua_accepted_version") || "";
        const r = await communityGoogleExchange(sid, v);
        sessionStorage.removeItem("cm_eua_accepted_version");
        localStorage.setItem("cm_buyer_jwt", r.token);
        localStorage.setItem("cm_buyer_email", r.user.email);
        // Stamp returning-user identity for the /signin "Welcome back" banner
        localStorage.setItem("cm_last_email", r.user.email);
        if (r.user.name) localStorage.setItem("cm_last_name", r.user.name);
        localStorage.setItem("cm_last_signin_at", new Date().toISOString());
        // strip hash and navigate
        window.history.replaceState({}, "", window.location.pathname);
        // iter413al — Google Ads `signup_buyer` conversion for the
        // Google OAuth signup path. Mirrors the magic-link branch so
        // both auth paths are attributed to paid keywords.
        if (r.is_new_signup) {
          try {
            // iter413cj — Pass the backend-minted event_id for dedup.
            const eid = r.signup_event_id || undefined;
            trackConversion("signup_buyer", { event_label: "google_oauth", event_id: eid });
            trackMeta("signup_buyer", { event_label: "google_oauth", event_id: eid });
            tiktokTrack("signup_buyer", { event_label: "google_oauth", event_id: eid });
          }
          catch { /* noop */ }
        }
        // iter249 — first-time community signups go through the welcome flow.
        navigate(r.is_new_signup ? "/welcome" : "/community", { replace: true });
      } catch (e) {
        setError(e?.response?.data?.detail || "Sign-in failed. Please try again.");
      }
    })();
  }, [navigate]);
  return (
    <div className="pt-40 pb-24 min-h-screen grain text-center px-4" data-testid="community-auth-callback">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
        ◆ {error ? "Issue" : "Signing you in…"}
      </div>
      <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] mb-6 uppercase">
        {error ? "Try Again." : "One Moment."}
      </h1>
      <p className="font-mono text-sm text-ink-muted max-w-lg mx-auto">{error || "Talking to Google…"}</p>
      {error && <Link to="/community/login" className="btn-industrial btn-primary inline-flex mt-8">Back to sign-in →</Link>}
    </div>
  );
}
