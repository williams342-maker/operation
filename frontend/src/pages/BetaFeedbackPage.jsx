/**
 * iter435 — /app-testing/feedback: public beta bug-report / feedback form.
 * Used as the "Feedback URL" for Google Play Console + TestFlight settings.
 * Stores in db.beta_feedback + emails ops; screenshots are downscaled
 * client-side and stored as data URLs.
 */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, ArrowLeft, ImagePlus, X } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;

const PLATFORMS = [
  { value: "android", label: "Android" },
  { value: "ios", label: "iPhone" },
  { value: "web", label: "Website" },
];
const TYPES = [
  { value: "bug", label: "Bug" },
  { value: "suggestion", label: "Suggestion" },
  { value: "other", label: "Other" },
];

// Downscale to max 1600px + JPEG so the payload stays well under the 3 MB cap.
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image.")); };
    img.src = url;
  });
}

export default function BetaFeedbackPage() {
  const [form, setForm] = useState({ name: "", email: "", phone_model: "", platform: "android", type: "bug", message: "" });
  const [shot, setShot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function pickShot(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    try { setShot(await fileToDataUrl(f)); }
    catch (err) { toast.error(err.message); }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.email.trim() || form.message.trim().length < 5) {
      toast.error("Please add your email and a short description.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/beta-program/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim() || null,
          email: form.email.trim(),
          platform: form.platform,
          phone_model: form.phone_model.trim() || null,
          type: form.type,
          message: form.message.trim(),
          screenshot: shot,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setDone(true);
    } catch (err) {
      toast.error(err.message || "Something went wrong — please try again.");
    } finally { setBusy(false); }
  }

  const inputCls =
    "mt-1 w-full border border-line bg-paper px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-brand";
  const labelCls = "font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted";
  const pill = (active) =>
    `flex-1 border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] transition ${
      active ? "border-brand text-brand bg-brand/5" : "border-line text-ink-muted hover:border-ink"
    }`;

  return (
    <div className="min-h-screen bg-paper text-ink" data-testid="beta-feedback-page">
      <div className="max-w-xl mx-auto px-6 pt-14 pb-36 sm:pb-28">
        <Link to="/app-testing"
              className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition mb-8"
              data-testid="feedback-back-link">
          <ArrowLeft size={12} /> App Testing Program
        </Link>

        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-3">◆ Beta · Feedback</div>
        <h1 className="font-display text-4xl sm:text-5xl leading-tight mb-4">Report a Bug or Share Feedback</h1>
        <p className="text-ink-muted text-base mb-10 max-w-lg">
          Found something broken, confusing, or missing in the Crafters Market beta? Tell us here —
          every report goes straight to the team. Screenshots help a lot.
        </p>

        {done ? (
          <div className="border border-line p-8 text-center" data-testid="feedback-confirmation">
            <CheckCircle2 size={36} className="mx-auto mb-4 text-brand" aria-hidden />
            <h2 className="font-display text-2xl mb-3">Feedback received</h2>
            <p className="text-ink-muted text-sm leading-relaxed">
              Thank you — your feedback is in the team&apos;s queue. If we need more detail,
              we&apos;ll reply to your email.
            </p>
            <button onClick={() => { setDone(false); setForm({ ...form, message: "" }); setShot(null); }}
                    className="inline-block mt-6 font-mono text-xs uppercase tracking-[0.22em] text-brand hover:underline"
                    data-testid="feedback-send-another">
              Send another →
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="border border-line p-6 sm:p-8" data-testid="beta-feedback-form">
            <div className="mb-4">
              <span className={labelCls}>Where did it happen? *</span>
              <div className="mt-2 flex gap-2">
                {PLATFORMS.map((p) => (
                  <button type="button" key={p.value} onClick={() => setForm({ ...form, platform: p.value })}
                          className={pill(form.platform === p.value)} data-testid={`feedback-platform-${p.value}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-4">
              <span className={labelCls}>Type *</span>
              <div className="mt-2 flex gap-2">
                {TYPES.map((t) => (
                  <button type="button" key={t.value} onClick={() => setForm({ ...form, type: t.value })}
                          className={pill(form.type === t.value)} data-testid={`feedback-type-${t.value}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="block mb-4">
              <span className={labelCls}>What happened? *</span>
              <textarea value={form.message} onChange={set("message")} required minLength={5} maxLength={4000} rows={5}
                        placeholder="What did you do, what did you expect, and what happened instead?"
                        className={inputCls} data-testid="feedback-message" />
            </label>
            <div className="mb-4">
              <span className={labelCls}>Screenshot (optional)</span>
              {shot ? (
                <div className="mt-2 relative inline-block">
                  <img src={shot} alt="screenshot preview" className="max-h-40 border border-line" data-testid="feedback-shot-preview" />
                  <button type="button" onClick={() => setShot(null)}
                          className="absolute -top-2 -right-2 bg-ink text-paper rounded-full p-1"
                          data-testid="feedback-shot-remove" aria-label="Remove screenshot">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <label className="mt-2 flex items-center gap-2 border border-dashed border-line px-4 py-3 cursor-pointer text-ink-muted hover:border-brand hover:text-brand transition font-mono text-xs"
                       data-testid="feedback-shot-picker">
                  <ImagePlus size={14} /> Attach a screenshot
                  <input type="file" accept="image/*" onChange={pickShot} className="hidden" />
                </label>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <label className="block">
                <span className={labelCls}>Email *</span>
                <input type="email" value={form.email} onChange={set("email")} required
                       className={inputCls} data-testid="feedback-email" />
              </label>
              <label className="block">
                <span className={labelCls}>Name (optional)</span>
                <input value={form.name} onChange={set("name")} maxLength={80}
                       className={inputCls} data-testid="feedback-name" />
              </label>
            </div>
            <label className="block mb-6">
              <span className={labelCls}>Phone model (optional)</span>
              <input value={form.phone_model} onChange={set("phone_model")} maxLength={80}
                     placeholder="e.g. iPhone 15 Pro, Pixel 8" className={inputCls} data-testid="feedback-phone" />
            </label>
            <button type="submit" disabled={busy}
                    className="w-full bg-brand hover:bg-brand-hover text-ink font-mono text-xs uppercase tracking-[0.22em] py-3 disabled:opacity-40 transition"
                    data-testid="feedback-submit">
              {busy ? "Sending…" : "Send feedback"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
