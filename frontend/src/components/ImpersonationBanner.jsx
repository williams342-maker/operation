// iter413ca/cb — Impersonation banner + Report Bug flow.
// ──────────────────────────────────────────────────────
// Renders a high-contrast warning strip on every page when the current
// tab is operating under an admin-minted impersonation JWT. Clicking
// "Exit" wipes the impersonation JWT + meta and lands the admin back on
// the admin console. Clicking "Report Bug" opens a modal that ships the
// current URL + admin note + recent console errors to the Contact Inbox.
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { readImpersonation, stopImpersonation } from "../lib/impersonate";
import { recentErrors } from "../lib/consoleCapture";
import { filImpersonationBugReport } from "../lib/api";

export default function ImpersonationBanner() {
  const [meta, setMeta] = useState(() => readImpersonation());
  const [showBug, setShowBug] = useState(false);

  useEffect(() => {
    const sync = () => setMeta(readImpersonation());
    const onStorage = (e) => { if (!e.key || e.key === "cm_impersonating") sync(); };
    const onFocus = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    const tick = setInterval(sync, 30_000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      clearInterval(tick);
    };
  }, []);

  if (!meta) return null;

  const minsLeft = Math.max(0, Math.round((meta.expires_at - Date.now()) / 60_000));
  const onExit = () => {
    stopImpersonation();
    setMeta(null);
    window.location.href = "/";
  };

  return (
    <>
      <div
        role="alert"
        data-testid="impersonation-banner"
        className="sticky top-0 z-[60] w-full border-b-2 border-brand bg-brand text-[#0a0a0a] font-mono text-xs"
      >
        <div className="max-w-7xl mx-auto px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold uppercase tracking-[0.22em] text-[10px] shrink-0">◆ Impersonating</span>
            <span className="truncate">
              Viewing as <strong data-testid="impersonation-target-name">{meta.target_name || meta.target_email}</strong>
              <span className="opacity-70"> · {meta.target_type === "maker" ? `/${meta.target_sub}` : meta.target_email}</span>
              <span className="opacity-70"> · {minsLeft}m left</span>
              <span className="opacity-70"> · by {meta.imp_by}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowBug(true)}
              data-testid="impersonation-report-bug"
              className="px-3 py-1 border border-[#0a0a0a] hover:bg-[#0a0a0a] hover:text-brand font-bold text-[10px] uppercase tracking-[0.22em] transition"
            >
              ◆ Report Bug
            </button>
            <button
              onClick={onExit}
              data-testid="impersonation-exit"
              className="px-3 py-1 border border-[#0a0a0a] hover:bg-[#0a0a0a] hover:text-brand font-bold text-[10px] uppercase tracking-[0.22em] transition"
            >
              Exit Impersonation
            </button>
          </div>
        </div>
      </div>
      {showBug && <BugReportModal meta={meta} onClose={() => setShowBug(false)} />}
    </>
  );
}

function BugReportModal({ meta, onClose }) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const errs = recentErrors();

  const submit = async () => {
    const trimmed = note.trim();
    if (trimmed.length < 4) {
      toast.error("Add a few words about what's broken.");
      return;
    }
    setSubmitting(true);
    try {
      await filImpersonationBugReport({
        target_type: meta.target_type,
        target_sub: meta.target_sub,
        target_email: meta.target_email,
        target_name: meta.target_name,
        current_url: window.location.href,
        admin_note: trimmed,
        console_errors: errs,
      });
      toast.success("Bug filed to Contact Inbox — Ops notified.");
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to file bug report.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-paper/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="impersonation-bug-modal"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="imp-bug-headline"
        className="bg-paper border border-brand max-w-lg w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand">◆ Impersonation · Bug Report</div>
        <h3 id="imp-bug-headline" className="font-display text-2xl uppercase">What&apos;s broken?</h3>
        <div className="border border-line p-3 space-y-1 font-mono text-[10px] text-ink-muted">
          <div>Target: <span className="text-ink">{meta.target_type}={meta.target_sub}</span></div>
          <div>URL: <span className="text-ink break-all">{window.location.href}</span></div>
          <div>Captured console errors: <span className="text-ink">{errs.length}</span></div>
        </div>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            Describe the issue <span className="text-brand">(required)</span>
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={5}
            autoFocus
            placeholder="e.g. Checkout 'Continue' button does nothing after I add a coupon — no toast, no network call."
            className="mt-1 w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
            data-testid="impersonation-bug-note"
          />
        </label>
        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 border border-line hover:border-brand font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="impersonation-bug-cancel"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || note.trim().length < 4}
            className="px-4 py-2 border border-brand bg-brand text-[#0a0a0a] hover:bg-brand/90 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="impersonation-bug-submit"
          >
            {submitting ? "Filing…" : "File Bug Report"}
          </button>
        </div>
      </div>
    </div>
  );
}
