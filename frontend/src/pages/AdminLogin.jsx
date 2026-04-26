import React, { useState } from "react";
import { motion } from "framer-motion";
import { requestAdminLink } from "../lib/api";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ status: "idle", message: "" });

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;
    setState({ status: "loading", message: "" });
    try {
      const res = await requestAdminLink(email.trim(), window.location.origin);
      setState({ status: "sent", message: res.message });
    } catch (err) {
      setState({
        status: "error",
        message: err?.response?.data?.detail || "Could not send the link. Try again.",
      });
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
            For Crafters Market operators only. Enter your operator email — we'll send a one-click
            sign-in link, good for 15 minutes.
          </p>

          <form onSubmit={onSubmit} className="space-y-4" data-testid="admin-login-form">
            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                Operator email
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={state.status === "loading" || state.status === "sent"}
                placeholder="ops@craftersmarket.org"
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
