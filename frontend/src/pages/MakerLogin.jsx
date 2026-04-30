import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { requestMakerLink } from "../lib/api";

// localStorage key for remembering the last-used sign-in email. The value
// is the raw email, not a token — safe to persist. Gives us a "Not you?"
// affordance on the login screen so a returning user never has to retype.
const LAST_EMAIL_KEY = "cm_maker_last_email";

export default function MakerLogin() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ status: "idle", message: "" });
  const [rememberedEmail, setRememberedEmail] = useState("");

  // On mount, pre-fill with the last email they signed in with (if any).
  // This is passive — the user can still type over it.
  useEffect(() => {
    const prior = localStorage.getItem(LAST_EMAIL_KEY) || "";
    if (prior) {
      setEmail(prior);
      setRememberedEmail(prior);
    }
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;
    setState({ status: "loading", message: "" });
    try {
      const res = await requestMakerLink(email.trim(), window.location.origin);
      localStorage.setItem(LAST_EMAIL_KEY, email.trim());
      setRememberedEmail(email.trim());
      setState({ status: "sent", message: res.message });
    } catch (err) {
      setState({
        status: "error",
        message: err?.response?.data?.detail || "Could not send the link. Try again.",
      });
    }
  };

  // "Not you?" / switch-user — wipes the remembered email and fully
  // resets the form. Also clears any stale JWTs just in case so the
  // next successful magic-link verify issues a fresh session.
  const resetIdentity = () => {
    localStorage.removeItem(LAST_EMAIL_KEY);
    localStorage.removeItem("cm_maker_jwt");
    localStorage.removeItem("cm_maker_slug");
    setEmail("");
    setRememberedEmail("");
    setState({ status: "idle", message: "" });
  };

  // Resend the sign-in link without re-typing the email. Re-uses the
  // submit handler logic but doesn't require the form event.
  const resendLink = async () => {
    if (!email) return;
    setState({ status: "loading", message: "" });
    try {
      const res = await requestMakerLink(email.trim(), window.location.origin);
      setState({ status: "sent", message: res.message });
    } catch (err) {
      setState({
        status: "error",
        message: err?.response?.data?.detail || "Could not resend the link. Try again.",
      });
    }
  };

  return (
    <div className="pt-40 pb-24 min-h-screen grain px-4" data-testid="maker-login">
      <div className="max-w-xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
            ◆ Maker Portal
          </div>
          <h1 className="font-display text-[56px] md:text-[88px] leading-[0.88] mb-6 uppercase">
            Sign In.
          </h1>
          <p className="font-mono text-sm text-[#a3a3a3] leading-relaxed mb-6">
            Enter the email on file with Crafters Market. We'll send you a one-click sign-in link
            — no password, good for 15 minutes.
          </p>

          {/* Founding Seller badge — previously a separate pill in the top Nav.
              Consolidated here so there's a single sign-in entry point: regular
              approved makers AND Founding Sellers both sign in with the same
              magic-link flow. The banner makes the Founding-Seller path
              discoverable without fragmenting the surface. */}
          <div
            className="mb-10 border border-[#ff4500]/40 bg-[#ff4500]/5 px-4 py-3 flex items-start gap-3"
            data-testid="maker-login-founding-banner"
          >
            <span className="font-mono text-[#ff4500] text-lg leading-none shrink-0">◆</span>
            <div className="flex-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">
                Founding Seller?
              </div>
              <p className="font-mono text-[11px] text-[#a3a3a3] leading-relaxed">
                Sign in here with the same email you used when you applied to the beta.
                Not yet a Founding Seller?{" "}
                <Link to="/beta" className="text-[#ff4500] underline hover:no-underline" data-testid="maker-login-beta-link">
                  Claim a spot →
                </Link>
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4" data-testid="maker-login-form">
            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] flex items-center justify-between gap-3">
                <span>Email</span>
                {rememberedEmail && state.status === "idle" && (
                  <button
                    type="button"
                    onClick={resetIdentity}
                    className="normal-case tracking-normal text-[11px] text-[#a3a3a3] hover:text-[#ff4500] underline"
                    data-testid="maker-login-not-you"
                  >
                    Not {rememberedEmail}? Use a different email
                  </button>
                )}
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={state.status === "loading" || state.status === "sent"}
                placeholder="you@studio.com"
                className="mt-2 w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5] transition"
                data-testid="maker-login-email"
              />
            </label>

            <button
              type="submit"
              disabled={state.status === "loading" || state.status === "sent"}
              className="btn-industrial btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
              data-testid="maker-login-submit"
            >
              {state.status === "loading"
                ? "Sending…"
                : state.status === "sent"
                ? "Link Sent ✓"
                : "Send Sign-In Link →"}
            </button>
          </form>

          {state.status === "sent" && (
            <div
              className="mt-8 border border-[#ff4500]/40 bg-[#ff4500]/5 p-5"
              data-testid="maker-login-sent"
            >
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500] mb-2">
                ◆ Check your inbox
              </div>
              <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">{state.message}</p>
              <div className="mt-4 pt-4 border-t border-[#ff4500]/20 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={resendLink}
                  className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500] hover:underline"
                  data-testid="maker-login-resend"
                  title="Re-send the magic link to the same email"
                >
                  ↻ Resend link
                </button>
                <span className="text-[#525252]">·</span>
                <button
                  type="button"
                  onClick={resetIdentity}
                  className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] hover:underline"
                  data-testid="maker-login-switch-user"
                  title="Sign in with a different email"
                >
                  ← Use a different email
                </button>
              </div>
            </div>
          )}

          {state.status === "error" && (
            <div className="mt-6 border border-red-500/40 bg-red-500/5 p-4">
              <p
                className="font-mono text-xs text-red-400"
                data-testid="maker-login-error"
              >
                {state.message}
              </p>
            </div>
          )}

          <p className="mt-12 font-mono text-[11px] text-[#525252] uppercase tracking-[0.22em]">
            Not a maker yet? <Link to="/apply" className="text-[#ff4500]">Apply to the program →</Link>
          </p>

          {/* Trouble-signing-in expander — handles the 3 cases that
              account for ~80% of "I can't log in" support tickets.
              Collapsed by default so it doesn't clutter the happy path. */}
          <details className="mt-6 font-mono text-[11px]" data-testid="maker-login-troubleshoot">
            <summary className="cursor-pointer text-[#a3a3a3] hover:text-[#ff4500] uppercase tracking-[0.22em] list-none inline-flex items-center gap-2">
              <span className="text-[#ff4500]">◆</span> Trouble signing in?
            </summary>
            <div className="mt-3 space-y-3 text-[#a3a3a3] leading-relaxed border-l-2 border-[#262626] pl-4">
              <div>
                <div className="uppercase tracking-[0.22em] text-[#e5e5e5] text-[10px] mb-1">
                  ① Link not arriving?
                </div>
                <p className="normal-case tracking-normal">
                  Check spam / promotions / all-mail folders. Add
                  <code className="text-[#ff4500] mx-1">team@craftersmarket.org</code>
                  to your contacts. Links can take up to 2 minutes to arrive from Mailgun / Postmark.
                </p>
              </div>
              <div>
                <div className="uppercase tracking-[0.22em] text-[#e5e5e5] text-[10px] mb-1">
                  ② "Link expired"?
                </div>
                <p className="normal-case tracking-normal">
                  Magic links last 15 minutes. Just submit your email again — a fresh link replaces any pending one.
                </p>
              </div>
              <div>
                <div className="uppercase tracking-[0.22em] text-[#e5e5e5] text-[10px] mb-1">
                  ③ "We couldn't find an account"?
                </div>
                <p className="normal-case tracking-normal">
                  Make sure you're using the same email you applied with.
                  Approved Founding Sellers received a "Welcome" email — reply-search for it to confirm the right address.
                  Still stuck?{" "}
                  <a href="mailto:team@craftersmarket.org" className="text-[#ff4500] underline hover:no-underline">
                    team@craftersmarket.org
                  </a>.
                </p>
              </div>
            </div>
          </details>
        </motion.div>
      </div>
    </div>
  );
}
