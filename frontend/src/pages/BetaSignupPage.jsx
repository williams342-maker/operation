/**
 * iter433 — Public beta-tester collection pages.
 * /app-testing/android and /app-testing/ios (platform via prop from App.js).
 * Stores the signup and emails ops; store/TestFlight links come later once
 * the apps are approved.
 */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, ArrowLeft } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;

const COPY = {
  android: {
    title: "Android App Beta Testing",
    blurb:
      "Sign up to help test the Crafters Market Android app. We'll review your request and email you setup instructions when you're added.",
    accent: "#3ddc84",
  },
  ios: {
    title: "iOS App Beta Testing",
    blurb:
      "Sign up to help test the Crafters Market iPhone app through TestFlight. We'll review your request and email you setup instructions when you're added.",
    accent: "#0a0a0a",
  },
};

const ROLES = [
  { value: "shopper", label: "Shopper" },
  { value: "maker", label: "Maker / Seller" },
  { value: "both", label: "Both" },
];

export default function BetaSignupPage({ platform = "android" }) {
  const copy = COPY[platform] || COPY.android;
  const [form, setForm] = useState({ name: "", email: "", phone_model: "", role: "shopper", notes: "" });
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Please enter your name and email.");
      return;
    }
    if (!ack) {
      toast.error("Please confirm you understand this is a beta app.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/beta-program/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          platform,
          phone_model: form.phone_model.trim() || null,
          role: form.role,
          notes: form.notes.trim() || null,
          ack: true,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setDone(true);
    } catch (err) {
      toast.error(err.message || "Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "mt-1 w-full border border-line bg-paper px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-brand";
  const labelCls = "font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted";

  return (
    <div className="min-h-screen bg-paper text-ink" data-testid={`beta-signup-page-${platform}`}>
      <div className="max-w-xl mx-auto px-6 pt-14 pb-36 sm:pb-28">
        <Link
          to="/app-testing"
          className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition mb-8"
          data-testid="beta-back-link"
        >
          <ArrowLeft size={12} /> App Testing Program
        </Link>

        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-3">
          ◆ Beta · {platform === "ios" ? "iPhone / TestFlight" : "Android / Google Play"}
        </div>
        <h1 className="font-display text-4xl sm:text-5xl leading-tight mb-4">{copy.title}</h1>
        <p className="text-ink-muted text-base mb-10 max-w-lg">{copy.blurb}</p>

        {done ? (
          <div className="border border-line p-8 text-center" data-testid="beta-signup-confirmation">
            <CheckCircle2 size={36} className="mx-auto mb-4 text-brand" aria-hidden />
            <h2 className="font-display text-2xl mb-3">Request received</h2>
            <p className="text-ink-muted text-sm leading-relaxed">
              Thanks — your beta testing request has been received. If selected, we&apos;ll email you
              setup instructions.
            </p>
            <Link
              to="/"
              className="inline-block mt-6 font-mono text-xs uppercase tracking-[0.22em] text-brand hover:underline"
              data-testid="beta-confirmation-home"
            >
              Back to Crafters Market →
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="border border-line p-6 sm:p-8" data-testid="beta-signup-form">
            <label className="block mb-4">
              <span className={labelCls}>Name *</span>
              <input value={form.name} onChange={set("name")} required maxLength={80}
                     className={inputCls} data-testid="beta-form-name" />
            </label>
            <label className="block mb-4">
              <span className={labelCls}>Email *</span>
              <input type="email" value={form.email} onChange={set("email")} required
                     className={inputCls} data-testid="beta-form-email" />
            </label>
            <label className="block mb-4">
              <span className={labelCls}>Phone model (optional)</span>
              <input value={form.phone_model} onChange={set("phone_model")} maxLength={80}
                     placeholder={platform === "ios" ? "e.g. iPhone 15 Pro" : "e.g. Pixel 8, Galaxy S24"}
                     className={inputCls} data-testid="beta-form-phone" />
            </label>
            <div className="mb-4">
              <span className={labelCls}>I&apos;m a…</span>
              <div className="mt-2 flex gap-2">
                {ROLES.map((r) => (
                  <button
                    type="button"
                    key={r.value}
                    onClick={() => setForm({ ...form, role: r.value })}
                    className={`flex-1 border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] transition ${
                      form.role === r.value
                        ? "border-brand text-brand bg-brand/5"
                        : "border-line text-ink-muted hover:border-ink"
                    }`}
                    data-testid={`beta-form-role-${r.value}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="block mb-5">
              <span className={labelCls}>Notes (optional)</span>
              <textarea value={form.notes} onChange={set("notes")} maxLength={1000} rows={3}
                        placeholder="Anything we should know — devices, testing experience, what you'd love to see…"
                        className={inputCls} data-testid="beta-form-notes" />
            </label>
            <label className="flex items-start gap-3 mb-6 cursor-pointer">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)}
                     required className="mt-0.5 accent-brand" data-testid="beta-form-ack" />
              <span className="text-sm text-ink-muted">
                I understand this is a beta app and may contain bugs. *
              </span>
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-brand hover:bg-brand-hover text-ink font-mono text-xs uppercase tracking-[0.22em] py-3 disabled:opacity-40 transition"
              data-testid="beta-form-submit"
            >
              {busy ? "Submitting…" : "Request beta access"}
            </button>
            <p className="mt-4 text-[11px] text-ink-muted text-center">
              We only use your email for beta-program communication. No spam, ever.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
