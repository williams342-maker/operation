import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  fetchAuthFlags, fetchCommunityEua,
  communityRequestMagic, requestMakerLink, requestAdminLink,
  passwordLogin, passwordForgot, passwordReset,
} from "../lib/api";

const googleSignIn = () => {
  const redirectUrl = window.location.origin + "/community/auth/callback";
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
};

const EUA_KEY = "cm_eua_accepted_version";

// Persist last sign-in identity so /signin can show "Welcome back, Name"
// on next visit. localStorage (not cookie) — same-device only, never sent
// to the server, simple to clear on sign-out.
function rememberSignedIn({ email, name }) {
  try {
    if (email) localStorage.setItem("cm_last_email", email);
    if (name) localStorage.setItem("cm_last_name", name);
    localStorage.setItem("cm_last_signin_at", new Date().toISOString());
  } catch { /* localStorage disabled — ignore */ }
}

const ROLE_OPTS = [
  { id: "buyer", label: "Buyer", blurb: "Shop, save makers, post in community" },
  { id: "maker", label: "Maker", blurb: "Manage your shop & payouts" },
];

/**
 * Unified sign-in page — magic link first (the default for everyone),
 * Google OAuth for buyers (most reliable when email is flaky), and an
 * optional collapsible password form as a fallback.
 *
 * Routes here from the new Nav "Sign in" button; replaces /community/login
 * for buyers and complements /maker/login + /admin/login.
 */
export default function SignInPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // If anyone hits /signin?as=admin (e.g. an old bookmark or a guess),
  // silently route them to the dedicated, unlabeled admin entry.
  useEffect(() => {
    if (params.get("as") === "admin") {
      navigate("/admin/login", { replace: true });
    }
  }, [params, navigate]);
  const initialRole = params.get("as") === "maker" ? "maker" : "buyer";
  const [role, setRole] = useState(initialRole);
  const [email, setEmail] = useState(() => {
    // Pre-fill the email on landing if a returning user — saves them the typing
    // and signals "we remember you" before they even read the welcome line.
    try { return localStorage.getItem("cm_last_email") || ""; } catch { return ""; }
  });
  const [returningName] = useState(() => {
    try { return localStorage.getItem("cm_last_name") || ""; } catch { return ""; }
  });
  const [returningEmail] = useState(() => {
    try { return localStorage.getItem("cm_last_email") || ""; } catch { return ""; }
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [eua, setEua] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [flags, setFlags] = useState({ buyer_enabled: true, maker_enabled: true, admin_enabled: true });
  const [state, setState] = useState({ status: "idle", message: "" });

  useEffect(() => { fetchCommunityEua().then(setEua).catch(() => {}); }, []);
  useEffect(() => { fetchAuthFlags().then(setFlags).catch(() => {}); }, []);

  const passwordEnabledForRole = {
    buyer: flags.buyer_enabled, maker: flags.maker_enabled, admin: flags.admin_enabled,
  }[role];

  const sendMagic = async (e) => {
    e?.preventDefault?.();
    if (!email) return;
    if (role === "buyer" && !accepted && eua) {
      setState({ status: "error", message: "Please accept the Community Terms to continue." });
      return;
    }
    setState({ status: "loading", message: "" });
    try {
      if (role === "buyer") {
        const v = eua?.version || "";
        if (v) sessionStorage.setItem(EUA_KEY, v);
        const r = await communityRequestMagic(email.trim(), window.location.origin, v);
        setState({ status: "sent", message: r.message });
      } else if (role === "maker") {
        const r = await requestMakerLink(email.trim(), window.location.origin);
        setState({ status: "sent", message: r.message });
      } else {
        const r = await requestAdminLink(email.trim(), window.location.origin);
        setState({ status: "sent", message: r.message });
      }
    } catch (err) {
      setState({ status: "error", message: err?.response?.data?.detail || "Could not send the link." });
    }
  };

  const tryPassword = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setState({ status: "loading", message: "" });
    try {
      const r = await passwordLogin(email.trim(), password, role);
      // Store JWT under the keys the rest of the app already uses — must
      // match MakerVerify, AdminVerify, CommunityVerify exactly so the
      // dashboards recognise the session.
      if (role === "buyer") {
        localStorage.setItem("cm_buyer_jwt", r.token);
        if (r.user?.email) localStorage.setItem("cm_buyer_email", r.user.email);
      } else if (role === "maker") {
        localStorage.setItem("cm_maker_jwt", r.token);
        if (r.user?.slug) localStorage.setItem("cm_maker_slug", r.user.slug);
      } else {
        localStorage.setItem("cm_admin_jwt", r.token);
      }
      // Remember the user for next visit's welcome banner (buyer + maker only —
      // admin sign-ins intentionally don't stamp this, see /admin/login)
      if (role !== "admin") {
        rememberSignedIn({
          email: r.user?.email || email.trim(),
          name: r.user?.name || r.user?.display_name || "",
        });
      }
      const dest = { buyer: "/community", maker: "/maker/dashboard", admin: "/admin/dashboard" }[role];
      navigate(dest);
    } catch (err) {
      const code = err?.response?.status;
      const msg = err?.response?.data?.detail
        || (code === 429
              ? "Too many attempts. Use the magic link instead."
              : "Sign-in failed. Check your password or use the magic link.");
      setState({ status: "error", message: msg });
    }
  };

  return (
    <div className="pt-40 pb-24 min-h-screen grain px-4" data-testid="signin-page">
      <div className="max-w-xl mx-auto">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
          ◆ Sign In
        </div>
        <h1 className="font-display text-[56px] md:text-[88px] leading-[0.88] mb-6 uppercase">
          {returningName || returningEmail ? "Welcome back." : "Welcome back."}
        </h1>

        {/* Personalised greeting on second+ visit. Only shown when we
            actually remember a previous sign-in identity. Pure UX touch:
            doesn't gate anything, just reduces cognitive load by signalling
            "you have an account here, just sign in." */}
        {(returningName || returningEmail) && (
          <div
            className="mb-8 px-4 py-3 border border-[#ff4500] bg-[#ff4500]/5 flex items-center gap-3"
            data-testid="signin-welcome-banner"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">◆</div>
            <div className="font-mono text-xs text-[#e5e5e5] leading-relaxed flex-1">
              {returningName ? (
                <>Welcome back, <span className="text-[#ff4500]">{returningName}</span>.</>
              ) : (
                <>We remember <span className="text-[#ff4500]">{returningEmail}</span>.</>
              )}
              {" "}Sign in to pick up where you left off.
            </div>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.removeItem("cm_last_email");
                  localStorage.removeItem("cm_last_name");
                  localStorage.removeItem("cm_last_signin_at");
                } catch {}
                window.location.reload();
              }}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition shrink-0"
              data-testid="signin-not-you-btn"
              title="Forget this device — clears the remembered email/name"
            >
              Not you?
            </button>
          </div>
        )}

        <p className="font-mono text-sm text-[#a3a3a3] mb-8">
          Sign in to shop, manage your shop, or moderate the marketplace.
        </p>

        {/* Role tabs */}
        <div className="grid grid-cols-3 gap-2 mb-8" data-testid="role-tabs">
          {ROLE_OPTS.map((r) => (
            <button
              key={r.id}
              onClick={() => { setRole(r.id); setState({ status: "idle", message: "" }); }}
              className={`p-3 border text-left transition ${
                role === r.id
                  ? "border-[#ff4500] bg-[#ff4500]/5"
                  : "border-[#262626] hover:border-[#525252]"
              }`}
              data-testid={`role-tab-${r.id}`}
            >
              <div className={`font-mono text-[11px] uppercase tracking-[0.18em] ${
                role === r.id ? "text-[#ff4500]" : "text-[#e5e5e5]"
              }`}>{r.label}</div>
              <div className="font-mono text-[10px] text-[#a3a3a3] mt-1 leading-snug">{r.blurb}</div>
            </button>
          ))}
        </div>

        {/* EUA — buyer only */}
        {role === "buyer" && eua && (
          <label
            className={`flex items-start gap-3 mb-6 p-4 border cursor-pointer transition ${
              accepted ? "border-[#ff4500]" : "border-[#262626] hover:border-[#525252]"
            }`}
            data-testid="signin-eua"
          >
            <input
              type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 accent-[#ff4500]" data-testid="signin-eua-checkbox"
            />
            <span className="font-mono text-[11px] text-[#a3a3a3] leading-relaxed">
              I agree to the <Link to="/community/terms" target="_blank" className="text-[#ff4500] hover:underline">Community Terms</Link>
              {eua?.version ? ` (v${eua.version})` : ""}.
            </span>
          </label>
        )}

        {/* Google — buyer only (most reliable, no email needed) */}
        {role === "buyer" && (
          <button
            onClick={() => { if (eua && !accepted) { setState({ status: "error", message: "Please accept the Community Terms to continue." }); return; } googleSignIn(); }}
            className="w-full flex items-center justify-center gap-3 px-5 py-3 border border-[#262626] hover:border-[#ff4500] bg-[#0a0a0a] font-mono text-xs uppercase tracking-[0.22em] text-[#e5e5e5] mb-6 transition"
            data-testid="signin-google-btn"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        )}

        <div className="flex items-center gap-3 my-6 font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
          <div className="flex-1 border-t border-[#262626]" />
          {role === "buyer" ? "or with email" : "with email"}
          <div className="flex-1 border-t border-[#262626]" />
        </div>

        {/* Email magic-link form (default) */}
        <form onSubmit={sendMagic} className="space-y-4 mb-6" data-testid="signin-magic-form">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-4 py-3 font-mono text-sm outline-none"
            data-testid="signin-email"
          />
          <button
            type="submit"
            disabled={state.status === "loading"}
            className="w-full btn-industrial btn-primary disabled:opacity-50"
            data-testid="signin-magic-submit"
          >
            {state.status === "loading" ? "Sending…" : "Send magic link →"}
          </button>
        </form>

        {/* Optional password fallback */}
        {passwordEnabledForRole && (
          <div className="border-t border-[#262626] pt-6" data-testid="signin-password-block">
            <button
              onClick={() => setShowPassword((s) => !s)}
              className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition"
              data-testid="signin-password-toggle"
            >
              {showPassword ? "− Hide password sign-in" : "+ Or use a password instead"}
            </button>
            {showPassword && (
              <form onSubmit={tryPassword} className="space-y-3 mt-4" data-testid="signin-password-form">
                <input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password" required minLength={1}
                  className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-4 py-3 font-mono text-sm outline-none"
                  data-testid="signin-password-input"
                />
                <button
                  type="submit" disabled={state.status === "loading"}
                  className="w-full btn-industrial disabled:opacity-50"
                  data-testid="signin-password-submit"
                >
                  Sign in with password
                </button>
                <Link
                  to={`/forgot-password?as=${role}&email=${encodeURIComponent(email)}`}
                  className="block text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
                  data-testid="signin-forgot-link"
                >
                  Forgot password?
                </Link>
                <p className="font-mono text-[10px] text-[#525252] text-center pt-2 leading-relaxed">
                  Email not arriving? Use your password — or{" "}
                  <a href="mailto:team@craftersmarket.org" className="text-[#ff4500] hover:underline">contact support</a>.
                </p>
              </form>
            )}
          </div>
        )}

        {/* Status messages */}
        {state.message && (
          <div
            className={`mt-6 p-4 border font-mono text-xs leading-relaxed ${
              state.status === "error"
                ? "border-red-700 bg-red-950/20 text-red-300"
                : "border-[#ff4500] bg-[#ff4500]/5 text-[#ff4500]"
            }`}
            data-testid={`signin-${state.status}-msg`}
          >
            {state.message}
          </div>
        )}
      </div>
    </div>
  );
}

/** Forgot password page — sends a reset link via email. */
export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const [role, setRole] = useState(params.get("as") || "buyer");
  const [email, setEmail] = useState(params.get("email") || "");
  const [state, setState] = useState({ status: "idle", message: "" });

  const submit = async (e) => {
    e.preventDefault();
    if (!email) return;
    setState({ status: "loading", message: "" });
    try {
      const r = await passwordForgot(email.trim(), role, window.location.origin);
      setState({ status: "sent", message: r.message });
    } catch (err) {
      setState({ status: "error", message: err?.response?.data?.detail || "Could not send the link." });
    }
  };

  return (
    <div className="pt-40 pb-24 min-h-screen grain px-4" data-testid="forgot-page">
      <div className="max-w-xl mx-auto">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ Forgot Password</div>
        <h1 className="font-display text-[44px] md:text-[64px] leading-[0.88] mb-6 uppercase">Reset Link.</h1>
        <p className="font-mono text-sm text-[#a3a3a3] mb-10">
          Enter the email tied to your account and we'll send a 30-minute, single-use reset link.
          Your existing password keeps working until you complete the reset.
        </p>
        <form onSubmit={submit} className="space-y-4" data-testid="forgot-form">
          <select
            value={role} onChange={(e) => setRole(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-4 py-3 font-mono text-sm outline-none"
            data-testid="forgot-role"
          >
            <option value="buyer">Buyer account</option>
            <option value="maker">Maker account</option>
            <option value="admin">Admin account</option>
          </select>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" required
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-4 py-3 font-mono text-sm outline-none"
            data-testid="forgot-email"
          />
          <button
            type="submit" disabled={state.status === "loading"}
            className="w-full btn-industrial btn-primary disabled:opacity-50"
            data-testid="forgot-submit"
          >
            {state.status === "loading" ? "Sending…" : "Send reset link →"}
          </button>
        </form>
        {state.message && (
          <div
            className={`mt-6 p-4 border font-mono text-xs leading-relaxed ${
              state.status === "error"
                ? "border-red-700 bg-red-950/20 text-red-300"
                : "border-[#ff4500] bg-[#ff4500]/5 text-[#ff4500]"
            }`}
            data-testid={`forgot-${state.status}-msg`}
          >
            {state.message}
          </div>
        )}
        <Link to="/signin" className="block mt-6 font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]" data-testid="forgot-back">← Back to sign in</Link>
      </div>
    </div>
  );
}

/** Reset password landing — consumed from the email link with token + nonce. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";
  const nonce = params.get("n") || "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [state, setState] = useState({ status: "idle", message: "" });

  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 10) {
      setState({ status: "error", message: "Password must be at least 10 characters." });
      return;
    }
    if (pw !== pw2) {
      setState({ status: "error", message: "Passwords don't match." });
      return;
    }
    setState({ status: "loading", message: "" });
    try {
      await passwordReset(token, nonce, pw);
      setState({ status: "sent", message: "Password updated. Redirecting to sign in…" });
      setTimeout(() => navigate("/signin"), 1500);
    } catch (err) {
      setState({ status: "error", message: err?.response?.data?.detail || "Reset failed." });
    }
  };

  if (!token || !nonce) {
    return (
      <div className="pt-40 pb-24 min-h-screen grain px-4 max-w-xl mx-auto" data-testid="reset-page-invalid">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-red-500 mb-4">◆ Invalid link</div>
        <h1 className="font-display text-4xl mb-4">This reset link is broken.</h1>
        <p className="font-mono text-sm text-[#a3a3a3]">
          Request a fresh link from the <Link to="/forgot-password" className="text-[#ff4500] hover:underline">forgot-password page</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="pt-40 pb-24 min-h-screen grain px-4" data-testid="reset-page">
      <div className="max-w-xl mx-auto">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ Reset Password</div>
        <h1 className="font-display text-[44px] md:text-[64px] leading-[0.88] mb-6 uppercase">New Password.</h1>
        <p className="font-mono text-sm text-[#a3a3a3] mb-10">
          Pick a new password — at least 10 characters, no other restrictions.
          This link can only be used once and expires 30 minutes after we sent it.
        </p>
        <form onSubmit={submit} className="space-y-4" data-testid="reset-form">
          <input
            type="password" value={pw} onChange={(e) => setPw(e.target.value)}
            placeholder="New password (min 10 chars)" required minLength={10}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-4 py-3 font-mono text-sm outline-none"
            data-testid="reset-pw1"
          />
          <input
            type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
            placeholder="Confirm new password" required minLength={10}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-4 py-3 font-mono text-sm outline-none"
            data-testid="reset-pw2"
          />
          <button
            type="submit" disabled={state.status === "loading"}
            className="w-full btn-industrial btn-primary disabled:opacity-50"
            data-testid="reset-submit"
          >
            {state.status === "loading" ? "Updating…" : "Update password →"}
          </button>
        </form>
        {state.message && (
          <div
            className={`mt-6 p-4 border font-mono text-xs leading-relaxed ${
              state.status === "error"
                ? "border-red-700 bg-red-950/20 text-red-300"
                : "border-[#ff4500] bg-[#ff4500]/5 text-[#ff4500]"
            }`}
            data-testid={`reset-${state.status}-msg`}
          >
            {state.message}
          </div>
        )}
      </div>
    </div>
  );
}
