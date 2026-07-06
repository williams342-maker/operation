/**
 * Report button — reusable UI + backend call for the unified content-report
 * system. Google Play UGC policy requires a report affordance on every
 * surface that displays user-generated content:
 *   • listings          (kind="listing", target_id=slug|id)
 *   • reviews           (kind="review", target_id=review_id)
 *   • journal posts     (kind="journal", target_id=slug|id)
 *   • showcase posts    (kind="showcase", target_id=post_id)
 *   • DM messages       (kind="message", target_id=message_id)
 *
 * Renders as a small "Report" link/button by default; the parent supplies
 * `className` to blend into whatever surface it sits on. Clicking opens a
 * modal with a reason picker + optional detail textarea.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { Flag } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;

const REASONS = [
  { id: "spam",           label: "Spam or scam" },
  { id: "harassment",     label: "Harassment or bullying" },
  { id: "hate_speech",    label: "Hate speech or discrimination" },
  { id: "adult_content",  label: "Adult / sexual content" },
  { id: "violence",       label: "Violence or threats" },
  { id: "self_harm",      label: "Self-harm content" },
  { id: "illegal",        label: "Illegal goods or activity" },
  { id: "counterfeit",    label: "Counterfeit or IP theft" },
  { id: "misinformation", label: "Misinformation" },
  { id: "impersonation",  label: "Impersonation" },
  { id: "csam",           label: "Child sexual abuse material (CSAM)" },
  { id: "other",          label: "Something else" },
];

function _authHeader() {
  // Prefer buyer, then maker, then admin token.
  const t =
    localStorage.getItem("cm_buyer_jwt") ||
    localStorage.getItem("cm_maker_jwt") ||
    localStorage.getItem("cm_admin_jwt");
  return t ? { Authorization: `Bearer ${t}` } : null;
}

export function ReportButton({
  kind,
  targetId,
  className = "",
  label = "Report",
  compact = false,
  testId,
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason) {
      toast.error("Please pick a reason.");
      return;
    }
    const hdr = _authHeader();
    if (!hdr) {
      toast.error("Sign in to submit a report.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...hdr },
        body: JSON.stringify({ kind, target_id: String(targetId), reason,
                               detail: detail.trim() || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      toast.success(d.deduped
        ? "You've already reported this — thanks."
        : "Thanks — our moderators will review this shortly.");
      setOpen(false);
      setReason(""); setDetail("");
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  const btnCls = compact
    ? `inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-ink-muted hover:text-red-500 transition ${className}`
    : `inline-flex items-center gap-1.5 border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-red-500 hover:border-red-500 transition ${className}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={btnCls}
        aria-label={`Report ${kind}`}
        data-testid={testId || `report-${kind}-btn`}
      >
        <Flag size={compact ? 10 : 12} aria-hidden />
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center px-4"
             onClick={(e) => e.target === e.currentTarget && setOpen(false)}
             data-testid="report-modal">
          <div className="max-w-md w-full bg-paper border border-line p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">
              ◆ Report content
            </div>
            <h3 className="font-display text-xl mb-4 text-ink">
              Why are you reporting this {kind === "message" ? "message" : kind}?
            </h3>
            <div className="space-y-1.5 mb-4 max-h-[280px] overflow-y-auto">
              {REASONS.map(r => (
                <label key={r.id}
                       className={`flex items-center gap-3 px-3 py-2 border cursor-pointer transition
                                   ${reason === r.id ? "border-brand bg-brand/5" : "border-line hover:border-ink-muted"}`}>
                  <input type="radio" name="report-reason" value={r.id}
                         checked={reason === r.id}
                         onChange={() => setReason(r.id)}
                         className="accent-brand"
                         data-testid={`report-reason-${r.id}`} />
                  <span className="font-mono text-xs">{r.label}</span>
                </label>
              ))}
            </div>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value.slice(0, 2000))}
              rows={3}
              placeholder="Optional — add context that will help our moderators."
              className="w-full border border-line bg-paper px-3 py-2 font-mono text-xs mb-4 focus:outline-none focus:border-brand"
              data-testid="report-detail-input"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 border border-line px-4 py-2 font-mono text-xs uppercase tracking-[0.22em] hover:bg-surface-2"
                data-testid="report-cancel-btn"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || !reason}
                className="flex-1 bg-brand hover:bg-brand-hover disabled:opacity-40 text-ink font-mono text-xs uppercase tracking-[0.22em] px-4 py-2"
                data-testid="report-submit-btn"
              >
                {busy ? "…" : "Submit report"}
              </button>
            </div>
            <p className="mt-4 text-[10px] text-ink-muted">
              False reports are logged and may result in your account
              being suspended. Reports on child sexual abuse material
              (CSAM) are escalated immediately.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

export default ReportButton;
