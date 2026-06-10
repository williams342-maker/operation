import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { emailMakerApplicant } from "../../lib/api";

// Single-recipient email composer. Opens from the ✉ Email button on any
// application row (pending, approved, or rejected) so the admin can follow
// up or clarify without leaving the dashboard.
export default function AdminEmailModal({
  applicationId, recipientEmail, recipientName, onClose,
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const send = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error("Subject and message are required.");
      return;
    }
    setBusy(true);
    try {
      await emailMakerApplicant(applicationId, { subject, message });
      toast.success(`Email sent to ${recipientEmail}.`);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to send email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-paper/80 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="admin-email-modal"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="w-full max-w-xl bg-paper border border-brand p-6 md:p-8">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-line">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Direct Message</div>
            <h3 className="font-display text-2xl mt-1">Email applicant</h3>
            <p className="font-mono text-xs text-ink-muted mt-1 break-all">
              To: {recipientName} · <span className="text-ink">{recipientEmail}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            data-testid="admin-email-close"
            className="font-mono text-xl text-ink-muted hover:text-brand disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 mt-5">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={180}
              autoFocus
              placeholder="Quick question about your application"
              data-testid="admin-email-subject"
              className="w-full mt-2 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm text-ink"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              placeholder="Hi — thanks for applying. We had one quick follow-up..."
              data-testid="admin-email-message"
              className="w-full mt-2 bg-transparent border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm text-ink resize-none leading-relaxed"
            />
            <div className="font-mono text-[10px] text-ink-muted mt-1">{message.length} chars</div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-line">
          <button
            onClick={onClose}
            disabled={busy}
            data-testid="admin-email-cancel"
            className="px-4 py-2 border border-line hover:border-ink-muted font-mono text-xs uppercase tracking-[0.22em] transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={busy || !subject.trim() || !message.trim()}
            data-testid="admin-email-send"
            className="btn-industrial btn-primary disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send email →"}
          </button>
        </div>
      </div>
    </div>
  );
}
