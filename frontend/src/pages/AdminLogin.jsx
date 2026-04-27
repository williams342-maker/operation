import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { requestAdminLink, fetchAuthFlags, passwordLogin } from "../lib/api";

/**
 * Dedicated admin sign-in page. Reached only via the unlabeled ◆ glyph in
 * the footer — no marketing surface, no public link, no Google OAuth.
 *
 * Hardening defaults vs the buyer/maker /signin page:
 *   - No email pre-fill from cm_last_email (admins always type fresh —
 *     protects against shared computers and shoulder-surfers).
 *   - No "Welcome back" banner (don't leak admin identity to onlookers).
 *   - No Google OAuth (admin auth is email-only by policy).
 *   - Password sign-in is gated behind the ENABLE_ADMIN_PASSWORD_AUTH flag
 *     — flip OFF when transactional email is reliable and you want admins
 *     forced through magic-links again (one .env edit, no code change).
 */
export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");                    // intentionally never pre-filled
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [adminPasswordEnabled, setAdminPasswordEnabled] = useState(false);
  const [state, setState] = useState({ status: "idle", message: "" });

  useEffect(() => {
    fetchAuthFlags()
      .then((f) => setAdminPasswordEnabled(!!f?.admin_enabled))
      .catch(() => {});
  }, []);

  const onMagic = async (e) => {
    e.preventDefault();
    if (!email) return;
    setState({ status: "loading", message: "" });
    try {
      const res = await requestAdminLink(email.trim(), window.location.origin);
      setState({ status: "sent", message: res.message });
    } catch (err) {
      setState({
        status: "error",
        message: err?.response?.data?.detail || "Could not send the link.",
      });
    }
  };

  const onPassword = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setState({ status: "loading", message: "" });
    try {
      const r = await passwordLogin(email.trim(), password, "admin");
      localStorage.setItem("admin_jwt", r.token);
      // Intentionally do NOT stamp cm_last_email / cm_last_name for admin
      // sign-ins — keeps the "Welcome back" banner free of admin identity.
      navigate("/admin/dashboard");
    } catch (err) {
      const code = err?.response?.status;
      const msg = err?.response?.data?.detail
        || (code === 429 ? "Too many attempts. Try the magic link instead." : "Sign-in failed.");
      setState({ status: "error", message: msg });
    }
  };

  return (
    <div className="pt-40 pb-24 min-h-screen grain px-4" data-testid="admin-login">
      <div className="max-w-xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
            ◆ Operator Console
          </div>
          <h1 className="font-display text-[56px] md:text-[88px] leading-[0.88] mb-6 uppercase">
            Admin In.
          </h1>
          <p className="font-mono text-sm text-[#a3a3a3] leading-relaxed mb-10">
            Authorized operators only. We'll send a one-click sign-in link
            (15-min expiry) — or use a password if your inbox is unreliable.
          </p>

          <form onSubmit={onMagic} className="space-y-4" data-testid="admin-login-form">
            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                Operator email
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={state.status === "loading" || state.status === "sent"}
                placeholder="you@craftersmarket.org"
                className="mt-2 w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5] transition"
                data-testid="admin-login-email"
              />
            </label>

            <button
              type="submit"
              disabled={state.status === "loading" || state.status === "sent"}
              className="btn-industrial btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
              data-testid="admin-login-submit"
            >
              {state.status === "loading"
                ? "Sending…"
                : state.status === "sent"
                ? "Link Sent ✓"
                : "Send Sign-In Link →"}
            </button>
          </form>

          {/* Password fallback — only when the env flag is on. */}
          {adminPasswordEnabled && (
            <div className="border-t border-[#262626] pt-6 mt-8" data-testid="admin-password-block">
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition"
                data-testid="admin-password-toggle"
              >
                {showPassword ? "− Hide password sign-in" : "+ Or use a password"}
              </button>
              {showPassword && (
                <form onSubmit={onPassword} className="space-y-3 mt-4" data-testid="admin-password-form">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    autoComplete="current-password"
                    className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-4 py-3 font-mono text-sm outline-none"
                    data-testid="admin-password-input"
                  />
                  <button
                    type="submit"
                    disabled={state.status === "loading"}
                    className="w-full btn-industrial disabled:opacity-50"
                    data-testid="admin-password-submit"
                  >
                    Sign in with password
                  </button>
                  <a
                    href={`/forgot-password?as=admin&email=${encodeURIComponent(email)}`}
                    className="block text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
                    data-testid="admin-forgot-link"
                  >
                    Forgot password?
                  </a>
                </form>
              )}
            </div>
          )}

          {state.status === "sent" && (
            <div
              className="mt-8 border border-[#ff4500]/40 bg-[#ff4500]/5 p-5"
              data-testid="admin-login-sent"
            >
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500] mb-2">
                ◆ Check your inbox
              </div>
              <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">{state.message}</p>
            </div>
          )}
          {state.status === "error" && (
            <div className="mt-6 border border-red-500/40 bg-red-500/5 p-4">
              <p className="font-mono text-xs text-red-400" data-testid="admin-login-error">
                {state.message}
              </p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
