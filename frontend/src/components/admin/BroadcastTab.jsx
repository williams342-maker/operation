import React, { useState } from "react";
import { toast } from "sonner";
import { previewAdminBroadcast, sendAdminBroadcast } from "../../lib/api";
import { useConfirm } from "../../hooks/useConfirm";

// Site-wide announcement composer. Sends a transactional email to a
// chosen cohort (all makers / Plus / Beta / buyers / pending applicants /
// everyone) via the existing Mailgun→Postmark→Mailtrap fallback chain.
const AUDIENCES = [
  { id: "all_makers",         label: "All Makers",         hint: "Every approved maker on the platform." },
  { id: "plus_makers",        label: "Crafters Plus",      hint: "Active paying subscribers only." },
  { id: "beta_makers",        label: "Founding Sellers",   hint: "Makers currently in the 90-day beta." },
  { id: "buyers",             label: "Buyers & Community", hint: "Past paying customers + community accounts." },
  { id: "applicants_pending", label: "Pending Applicants", hint: "Haven't been approved or rejected yet." },
  { id: "update_subscribers", label: "Update Subscribers", hint: "Public /updates page subscribers — opt-in for product news." },
  { id: "everyone",           label: "Everyone",           hint: "Union of all cohorts above — use sparingly." },
];

const TEMPLATES = [
  { id: "outage",   label: "Outage / Issue",    headline: "Service Update.",     subject: "Service update" },
  { id: "launch",   label: "New Feature",       headline: "Launch Day.",         subject: "New on Crafters Market" },
  { id: "event",    label: "Upcoming Event",    headline: "Mark Your Calendar.", subject: "Upcoming event" },
  {
    id: "clips_incentive",
    label: "★ Founding-50 Clips",
    headline: "Claim your free Featured slot.",
    subject: "★ First 50 makers — claim a free Featured Clip slot",
    body:
`We just launched a new short-form video feed at /clips (think TikTok for makers — workshop cuts, weld pulls, powder-coat sweeps, before/afters).

To kick it off, the FIRST 50 organic uploads automatically earn a permanent ★ Featured star badge on every viewer's screen — for life.

→ Post your first clip from your dashboard: maker portal → Settings → Workshop clips (feed)
→ YouTube Shorts / Vimeo URLs work, or drag-drop a 9:16 MP4 up to 50 MB
→ Optional: link a listing so viewers can shop the piece in one tap

Slots are claimed in posting order — once they're gone, they're gone. Be one of the founding 50 and your work stays at the top of the feed every time someone opens /clips.

— Crafters Market team`,
  },
  { id: "custom",   label: "Custom",            headline: "Announcement.",       subject: "" },
];

export default function BroadcastTab() {
  const [audience, setAudience] = useState("all_makers");
  const [template, setTemplate] = useState("custom");
  const [headline, setHeadline] = useState("Announcement.");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmModal] = useConfirm();

  const selectedAudience = AUDIENCES.find((a) => a.id === audience);

  const applyTemplate = (id) => {
    setTemplate(id);
    const t = TEMPLATES.find((x) => x.id === id);
    if (t && id !== "custom") {
      setHeadline(t.headline);
      if (!subject) setSubject(t.subject);
      // Some templates (e.g. clips_incentive) ship a full ready-to-send
      // body. Only auto-fill if the composer is empty so we never trample
      // an admin's draft.
      if (t.body && !message.trim()) setMessage(t.body);
      // For curated templates we also pre-select the maker audience —
      // the admin can override before hitting send.
      if (id === "clips_incentive") setAudience("all_makers");
    }
  };

  const doPreview = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error("Subject and message are required.");
      return;
    }
    setBusy(true);
    try {
      const r = await previewAdminBroadcast({ subject, message, audience, headline });
      setPreview(r);
      toast.success(`Audience resolves to ${r.count} recipients.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Preview failed.");
    } finally {
      setBusy(false);
    }
  };

  const doTestSend = async () => {
    if (!testEmail.trim()) {
      toast.error("Enter a test email address first.");
      return;
    }
    if (!subject.trim() || !message.trim()) {
      toast.error("Subject and message are required.");
      return;
    }
    setBusy(true);
    try {
      await sendAdminBroadcast({
        subject, message, audience, headline, test_email: testEmail.trim(),
      });
      toast.success(`Test sent to ${testEmail}.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Test send failed.");
    } finally {
      setBusy(false);
    }
  };

  const doLiveSend = async () => {
    if (!preview) {
      toast.error("Preview the audience first.");
      return;
    }
    const ok = await confirm({
      title: `Send to ${preview.count} recipients?`,
      body: `Subject: ${subject}\nAudience: ${selectedAudience?.label}\n\nThis cannot be undone once queued.`,
      confirmLabel: `Send to ${preview.count}`,
      tone: "danger",
      testId: "confirm-broadcast-send",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await sendAdminBroadcast({ subject, message, audience, headline });
      toast.success(`Queued ${r.recipients} emails.`);
      setMessage("");
      setSubject("");
      setPreview(null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl" data-testid="broadcast-tab">
      {confirmModal}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Announcement Composer</div>
        <h2 className="font-display text-3xl md:text-4xl mt-1">Site-Wide Email</h2>
        <p className="font-mono text-xs text-ink-muted mt-2 max-w-2xl leading-relaxed">
          Broadcast outages, upcoming events, feature launches, or maker updates via the
          standard transactional fallback chain. Always preview the audience count before sending.
        </p>
      </div>

      {/* Template quick-picks */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">Template</div>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => applyTemplate(t.id)}
              data-testid={`broadcast-template-${t.id}`}
              className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                template === t.id
                  ? "border-brand text-brand bg-brand/5"
                  : "border-line text-ink-muted hover:border-ink-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Audience picker */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">Audience</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {AUDIENCES.map((a) => (
            <button
              key={a.id}
              onClick={() => { setAudience(a.id); setPreview(null); }}
              data-testid={`broadcast-audience-${a.id}`}
              className={`text-left border p-3 transition ${
                audience === a.id
                  ? "border-brand bg-brand/5"
                  : "border-line hover:border-ink-muted"
              }`}
            >
              <div className="font-mono text-xs text-ink uppercase tracking-[0.22em]">{a.label}</div>
              <div className="font-mono text-[10px] text-ink-muted mt-1">{a.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Compose */}
      <div className="border border-line p-5 space-y-4">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Headline (big, top of email)</label>
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={120}
            data-testid="broadcast-headline"
            className="w-full mt-2 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-display text-xl text-ink"
          />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Subject line</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={180}
            placeholder="e.g. Scheduled maintenance tonight 9-11pm ET"
            data-testid="broadcast-subject"
            className="w-full mt-2 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm text-ink"
          />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Message body (plain text, line breaks preserved)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={8}
            placeholder="Hey makers — we're pushing a new release tonight..."
            data-testid="broadcast-message"
            className="w-full mt-2 bg-transparent border border-line focus:border-brand outline-none px-3 py-3 font-mono text-sm text-ink leading-relaxed resize-none"
          />
          <div className="font-mono text-[10px] text-ink-muted mt-1">{message.length} chars</div>
        </div>
      </div>

      {/* Preview + test + send */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={doPreview}
          disabled={busy}
          data-testid="broadcast-preview-btn"
          className="px-4 py-2 border border-line hover:border-brand hover:text-brand font-mono text-xs uppercase tracking-[0.22em] transition disabled:opacity-50"
        >
          ◆ Preview audience
        </button>
        <input
          type="email"
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          placeholder="test@yourself.com"
          data-testid="broadcast-test-email"
          className="bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink w-64"
        />
        <button
          onClick={doTestSend}
          disabled={busy || !testEmail.trim()}
          data-testid="broadcast-test-btn"
          className="px-4 py-2 border border-line hover:border-sky-500 hover:text-blue-700 font-mono text-xs uppercase tracking-[0.22em] transition disabled:opacity-50"
        >
          Send test →
        </button>
        <button
          onClick={doLiveSend}
          disabled={busy || !preview}
          data-testid="broadcast-live-btn"
          className="btn-industrial btn-primary disabled:opacity-50"
        >
          {busy ? "Working…" : preview ? `Send to ${preview.count} →` : "Preview first"}
        </button>
      </div>

      {preview && (
        <div className="border border-brand/40 bg-brand/5 p-4" data-testid="broadcast-preview-box">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-2">
            ◆ Resolved audience: {preview.count} recipients
          </div>
          <div className="font-mono text-xs text-ink leading-relaxed">
            Sample: {preview.sample.slice(0, 5).join(", ")}
            {preview.count > 5 && ` +${preview.count - 5} more`}
          </div>
        </div>
      )}
    </div>
  );
}
