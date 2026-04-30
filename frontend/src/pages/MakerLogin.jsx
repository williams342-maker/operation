import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { requestMakerLink } from "../lib/api";

export default function MakerLogin() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ status: "idle", message: "" });

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;
    setState({ status: "loading", message: "" });
    try {
      const res = await requestMakerLink(email.trim(), window.location.origin);
      setState({ status: "sent", message: res.message });
    } catch (err) {
      setState({
        status: "error",
        message: err?.response?.data?.detail || "Could not send the link. Try again.",
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
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                Email
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
        </motion.div>
      </div>
    </div>
  );
}
