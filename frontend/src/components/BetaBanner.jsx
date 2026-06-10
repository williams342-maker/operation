import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { submitBetaFeedback } from "../lib/api";
import useModalA11y from "../hooks/useModalA11y";

export default function BetaBanner({ message, position = "top" }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState("");
  const dialogRef = useModalA11y(() => setOpen(false));
  const isTop = position === "top";

  // Expose the banner's height as a CSS variable so the fixed <Nav>
  // (which is `fixed top-0 z-50`) and other top-pinned elements can shift
  // down by exactly this amount instead of being covered by the banner.
  // Only the top banner controls the offset — the bottom banner is in
  // normal flow at the end of the page so it doesn't affect layout.
  useEffect(() => {
    if (!isTop) return;
    document.documentElement.style.setProperty("--beta-banner-h", "40px");
    return () => {
      document.documentElement.style.removeProperty("--beta-banner-h");
    };
  }, [isTop]);

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
      toast.success("Feedback received — thanks for helping us improve.");
    } catch (e2) {
      const d = e2?.response?.data?.detail;
      const msg = typeof d === "string" ? d : "Failed to send. Please try again.";
      setErr(msg);
      toast.error(msg);
      setStatus("idle");
    }
  };

  return (
    <>
      <div
        className={
          isTop
            ? "fixed top-0 left-0 right-0 z-[60] bg-brand text-[#0a0a0a] border-b border-line/20 h-10 flex items-center"
            : "relative w-full bg-brand text-[#0a0a0a] border-t border-line/20 h-10 flex items-center"
        }
        data-testid={isTop ? "beta-banner" : "beta-banner-bottom"}
      >
        <div className="max-w-[1800px] mx-auto px-4 md:px-8 py-2 flex items-center justify-between gap-3 flex-wrap w-full">
          <div className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.22em] flex items-center gap-2 min-w-0">
            <span className="font-display text-base px-2 border border-line/30 leading-none py-1">BETA</span>
            <span className="truncate">{message || "You're using Crafters Market Beta. Found a bug or have an idea?"}</span>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="px-3 py-1.5 bg-paper text-brand border border-line hover:bg-paper font-mono text-[10px] uppercase tracking-[0.22em] shrink-0"
            data-testid={isTop ? "beta-feedback-btn" : "beta-feedback-btn-bottom"}
          >
            Send feedback →
          </button>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-paper/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
          data-testid="beta-feedback-modal"
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="beta-feedback-headline"
            className="bg-paper border border-line max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand">
              ◆ Beta Feedback
            </div>
            <h3 id="beta-feedback-headline" className="font-display text-2xl uppercase">Tell us what you think.</h3>

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
              <form onSubmit={submit} className="space-y-3" data-testid="beta-feedback-form" autoComplete="on">
                <label className="block">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">Name</span>
                  <input
                    required
                    name="name"
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => { const v = e.target.value; setForm((c) => ({ ...c, name: v })); }}
                    className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm text-ink"
                    data-testid="beta-feedback-name"
                  />
                </label>
                <label className="block">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">Email</span>
                  <input
                    required
                    type="email"
                    name="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={(e) => { const v = e.target.value; setForm((c) => ({ ...c, email: v })); }}
                    className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm text-ink"
                    data-testid="beta-feedback-email"
                  />
                </label>
                <label className="block">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1">Feedback</span>
                  <textarea
                    required
                    rows={5}
                    name="message"
                    autoComplete="off"
                    value={form.message}
                    onChange={(e) => { const v = e.target.value; setForm((c) => ({ ...c, message: v })); }}
                    placeholder="What's broken? What would you change?"
                    className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm text-ink"
                    data-testid="beta-feedback-message"
                  />
                </label>
                {err && <p className="font-mono text-xs text-red-400" data-testid="beta-feedback-error">{err}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 border border-line hover:border-brand font-mono text-[11px] uppercase tracking-[0.22em]"
                    data-testid="beta-feedback-cancel"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={status === "sending"}
                    className="px-4 py-2 bg-brand hover:bg-[#ff5722] text-[#0a0a0a] border border-brand font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
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
