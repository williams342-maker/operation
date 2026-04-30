import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { previewApplicationDecisionEmail } from "../../lib/api";

/**
 * Welcome-packet preview — shows admins exactly what the applicant will
 * receive on Approve vs Reject, with the live `note` baked in. No mail
 * is dispatched; this is a pure render preview.
 *
 * Tabs:
 *   • "✦ Approval" — full launch packet (welcome, checklist, fees, etc.)
 *   • "✕ Rejection" — short kind decline copy
 *
 * The `note` textarea inside the modal is local-only; if the parent row
 * already has a note typed in, we seed from there so admins can iterate
 * on copy without losing context.
 */
export default function WelcomePacketPreviewModal({
  applicationId, applicantName, studio, initialNote = "", onClose,
}) {
  const [tab, setTab] = useState("approve");
  const [note, setNote] = useState(initialNote);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Debounced re-render on every tab/note change so admins see the note
  // appear in the email body almost instantly.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await previewApplicationDecisionEmail(applicationId, {
          approved: tab === "approve", note,
        });
        if (alive) setData(r);
      } catch (e) {
        if (alive) toast.error(e?.response?.data?.detail || "Failed to render preview.");
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [applicationId, tab, note]);

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="welcome-packet-preview-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[920px] max-h-[92vh] bg-[#0a0a0a] border border-[#262626] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[#262626]">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
              ◆ Email Preview
            </div>
            <div className="font-display text-2xl mt-1 break-words">
              Welcome packet · {studio}
            </div>
            <div className="font-mono text-xs text-[#a3a3a3] mt-1 break-words">
              Will send to: <span className="text-[#e5e5e5]">{data?.recipient || "…"}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="welcome-preview-close"
            className="px-2.5 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition shrink-0"
          >
            ✕ Close
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#262626]" data-testid="welcome-preview-tabs">
          {[
            { id: "approve", label: "✦ Approval · Welcome packet" },
            { id: "reject",  label: "✕ Rejection · Short + kind"  },
          ].map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                data-testid={`welcome-preview-tab-${t.id}`}
                className={`px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] transition border-b-2 ${
                  active
                    ? "border-[#ff4500] text-[#ff4500] bg-[#ff4500]/5"
                    : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5]"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Body — split: note input + iframe preview */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Left: live note editor + meta */}
          <div className="md:w-[280px] md:shrink-0 border-r border-[#262626] p-5 space-y-4 overflow-y-auto">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mb-1">
                Subject line
              </div>
              <div className="font-mono text-xs text-[#e5e5e5] break-words leading-relaxed">
                {data?.subject || "…"}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mb-1">
                Applicant
              </div>
              <div className="font-mono text-xs text-[#e5e5e5] break-words">
                {applicantName}
              </div>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mb-1 block">
                Inline note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={5}
                placeholder={
                  tab === "approve"
                    ? "e.g. Loved your portfolio — excited to see what you list first."
                    : "e.g. Pieces feel rushed — keep building, reapply in 6 months."
                }
                className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
                data-testid="welcome-preview-note"
              />
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252] mt-1 leading-relaxed">
                Renders live · note appears as a quoted block at the end of the email.
              </p>
            </div>
            <div className="border-t border-[#262626] pt-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] leading-relaxed">
                ◆ This is a preview only — nothing is sent until you click
                Approve / Reject on the application row.
              </p>
            </div>
          </div>

          {/* Right: rendered email iframe */}
          <div className="flex-1 bg-[#121212] overflow-hidden flex flex-col min-h-[60vh]">
            <div className="px-4 py-2 border-b border-[#262626] font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">
              Inbox preview
            </div>
            {loading && !data ? (
              <div className="flex-1 flex items-center justify-center font-mono text-xs text-[#525252]">
                Rendering…
              </div>
            ) : (
              <iframe
                title="email-preview"
                srcDoc={data?.html || ""}
                className="flex-1 w-full border-0 bg-white"
                data-testid="welcome-preview-iframe"
                sandbox=""
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
