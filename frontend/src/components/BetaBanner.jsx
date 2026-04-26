import React, { useEffect, useState } from "react";
import { submitBetaFeedback } from "../lib/api";

export default function BetaBanner({ message }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setStatus("sending");
    try {
      await submitBetaFeedback({
        ...form,
        page: typeof window !== "undefined" ? window.location.pathname : "",
      });
      setStatus("done");
    } catch (e2) {
      const d = e2?.response?.data?.detail;
      setErr(typeof d === "string" ? d : "Failed to send. Please try again.");
      setStatus("idle");
    }
  };

  return (
    <>
      <div
        className="sticky top-0 z-40 bg-[#ff4500] text-[#0a0a0a] border-b border-black/20"
        data-testid="beta-banner"
      >
        <div className="max-w-[1800px] mx-auto px-4 md:px-8 py-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.22em] flex items-center gap-2 min-w-0">
            <span className="font-display text-base px-2 border border-black/30 leading-none py-1">BETA</span>
            <span className="truncate">{message || "You're using Crafters Market Beta. Found a bug or have an idea?"}</span>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="px-3 py-1.5 bg-[#0a0a0a] text-[#ff4500] border border-[#0a0a0a] hover:bg-black font-mono text-[10px] uppercase tracking-[0.22em] shrink-0"
            data-testid="beta-feedback-btn"
          >
            Send feedback →
          </button>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
          data-testid="beta-feedback-modal"
        >
          <div
            role="dialog"
            aria-modal="true"
            className="bg-[#0a0a0a] border border-[#262626] max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
              ◆ Beta Feedback
            </div>
            <h3 className="font-display text-2xl uppercase">Tell us what you think.</h3>

            {status === "done" ? (
              <div className="border border-emerald-700/60 bg-emerald-900/20 p-4 font-mono text-sm text-emerald-300" data-testid="beta-feedback-success">
                ◆ Got it — thanks for taking the time. We read every message.
                <button
                  onClick={() => { setOpen(false); setStatus("idle"); setForm({ name: "", email: "", message: "" }); }}
                  className="block mt-3 underline hover:text-emerald-200 font-mono text-xs"
                  data-testid="beta-feedback-close"
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3" data-testid="beta-feedback-form">
                <label className="block">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">Name</span>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
                    data-testid="beta-feedback-name"
                  />
                </label>
                <label className="block">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">Email</span>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
                    data-testid="beta-feedback-email"
                  />
                </label>
                <label className="block">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">Feedback</span>
                  <textarea
                    required
                    rows={5}
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    placeholder="What's broken? What would you change?"
                    className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
                    data-testid="beta-feedback-message"
                  />
                </label>
                {err && <p className="font-mono text-xs text-red-400" data-testid="beta-feedback-error">{err}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em]"
                    data-testid="beta-feedback-cancel"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={status === "sending"}
                    className="px-4 py-2 bg-[#ff4500] hover:bg-[#ff5722] text-[#0a0a0a] border border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
                    data-testid="beta-feedback-submit"
                  >
                    {status === "sending" ? "Sending…" : "Send feedback"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
