import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchAdminSettings,
  patchAdminSettings,
  adminClearAllChat,
  adminClearIdleChat,
  fetchAdminFeedback,
  adminResolveFeedback,
  replyToFeedback,
  adminGscStatus,
  adminGscOauthStart,
  adminGscDisconnect,
  adminGscTestInspect,
} from "../../lib/api";
import { refreshSiteSettings } from "../../hooks/useSiteSettings";
import { RowsSkeleton } from "../Skeleton";

const SWITCHES = [
  {
    key: "maintenance_mode",
    label: "Maintenance Mode",
    blurb: "When ON, every public route shows a branded maintenance page. Admin + maker portals stay accessible so you can flip it back off.",
    tone: "danger",
    messageKey: "maintenance_message",
    messageLabel: "Message shown on the maintenance page",
  },
  {
    key: "beta_mode",
    label: "Beta Mode",
    blurb: "Show a sticky 'Beta' banner sitewide with a feedback button. Submissions email ops + persist to /admin/dashboard for triage.",
    tone: "warn",
    messageKey: "beta_message",
    messageLabel: "Banner message",
  },
  {
    key: "allow_maker_applications",
    label: "Allow New Maker Applications",
    blurb: "When OFF, /apply rejects new submissions with the configured copy. Use to throttle inbound during reviews.",
    tone: "primary",
    messageKey: "applications_closed_message",
    messageLabel: "'Applications closed' copy",
  },
  {
    key: "beta_signup_enabled",
    label: "Founding Seller Beta Signup",
    blurb: "Master switch for the bold ◆ BETA SIGNUP button in the header AND the /beta landing page. When OFF, the Nav hides the pill and /beta shows a 'spots are closed' state — existing Founding Sellers keep their perks.",
    tone: "warn",
  },
  {
    key: "live_chat_enabled",
    label: "Live Chat",
    blurb: "Master kill-switch for WebSocket chat. When OFF, new connections are rejected and the Chat tab is hidden in /community.",
    tone: "warn",
  },
  {
    key: "auto_clear_idle_rooms",
    label: "Auto-clear idle rooms",
    blurb: "When ON, the scheduler purges chat rooms with no activity in the past N minutes. Runs every 10 min.",
    tone: "primary",
    numericKey: "idle_clear_minutes",
    numericLabel: "Idle window (minutes)",
    numericMin: 5,
    numericMax: 1440,
  },
  {
    key: "ai_moderator_enabled",
    label: "AI Moderator (chat & forum)",
    blurb: "When ON, every chat message AND every forum thread/reply is classified by Claude before being saved. Slurs/threats are blocked and the offender gets a private notice; spammy messages get a warn nudge but still post. Decisions are logged to the audit log with a `chat:`/`forum:` channel prefix.",
    tone: "primary",
  },
  {
    key: "auto_dormant_reengage_enabled",
    label: "Auto Dormant-Buyer Re-engagement",
    blurb: "When ON, every Tuesday at 14:00 UTC the scheduler finds buyers dormant 60+ days, mints a one-time 15% off marketplace-wide code (21-day expiry), tags them in Kit as `dormant-buyer-reengaged-auto`, and emails each one. Capped at 50 buyers per run with a 30-day per-buyer cool-off so we never re-pester the same person. The manual blast on the Retention tab still works alongside this — they share the same idempotency table.",
    tone: "warn",
  },
  {
    key: "auto_offsite_backup_enabled",
    label: "Auto Offsite Mongo Backups",
    blurb: "When ON, every night at 03:15 UTC the scheduler runs `mongodump --archive --gzip` of the entire production database, uploads the archive to a private R2 prefix, and sweeps any archive older than the retention window in the same job. Self-skips if R2 is not configured. Manual `Run now` in the Backup tab still works regardless of this toggle (super admin only). The retention window defaults to 30 days; change it via API if you need a longer history.",
    tone: "primary",
  },
  {
    key: "auto_recovery_drill_enabled",
    label: "Auto Recovery Drill (Quarterly)",
    blurb: "When ON, the first day of each quarter (Jan/Apr/Jul/Oct) at 04:30 UTC the scheduler downloads the latest R2 archive, restores it into an isolated `_dr_drill_<timestamp>` namespace on the same Mongo cluster, counts products + makers + blogs to verify the restore worked, drops the namespace, and posts the pass/fail result to your Slack/Discord webhook. Production collections are NEVER touched (the rename is enforced by mongorestore's `--nsFrom/--nsTo`). Manual trigger via the Backup tab works regardless of this toggle. Untested backups don't exist — flip this ON.",
    tone: "warn",
  },
  {
    key: "email_poster_on_admin_edit",
    label: "Email poster on admin edit",
    blurb: "When ON (default), if an admin edits a community design file via the Admin → Design Files tab, we email the original poster a field-level diff so changes don't happen silently. Each edit is also stamped on the file's `admin_edits[]` audit log. Mute this during a bulk-cleanup run if you don't want to spam, then flip back ON. The audit-log row is only written when the email actually goes out.",
    tone: "primary",
  },
  {
    key: "auto_review_prompt_enabled",
    label: "Auto post-delivery review prompts (Daily)",
    blurb: "When ON (default), at 16:00 UTC every day we sweep all orders delivered between 7 and 30 days ago that haven't been prompted yet, and email the buyer a one-tap review CTA per maker on the order. Idempotent — `review_prompt_sent_at` is the source of truth so the same order can never receive a second prompt. Reviews are the single biggest UGC lever for indie shops; expect a 15-25% review-creation rate on prompted orders. Mute during email-deliverability investigations or domain changes. Manual trigger via `POST /api/admin/marketing/review-prompts/run` works regardless of this toggle.",
    tone: "primary",
  },
  {
    key: "auto_publish_5star_reviews_enabled",
    label: "Auto-publish 5-star reviews to Buffer",
    blurb: "When ON, every fresh 5-star review (≥30 chars of text) is auto-queued to every connected Buffer channel — Pinterest, Instagram, Facebook — with the buyer's quote, the maker's name, and a deep link to the product. Idempotent: `posted_to_buffer_at` is stamped on each review so the same row is never re-posted, even on edit. Skips silently if Buffer isn't configured, no channels are connected, or the review is too short. Default OFF — flip ON once your Buffer queue/scheduler is configured to your liking. Free social-proof distribution for makers — expect 1-3 posts/week per active maker.",
    tone: "primary",
  },
];

const toneClass = (tone, on) => {
  if (!on) return "bg-[#262626] border-[#262626]";
  if (tone === "danger") return "bg-red-600 border-red-700";
  if (tone === "warn") return "bg-yellow-500 border-yellow-600";
  return "bg-emerald-600 border-emerald-700";
};

function ToggleRow({ row, settings, onPatch, busy }) {
  const on = !!settings[row.key];
  return (
    <div
      className={`border p-4 md:p-5 transition ${on ? "border-[#ff4500]/40 bg-[#ff4500]/5" : "border-[#262626]"}`}
      data-testid={`setting-row-${row.key}`}
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-display text-lg uppercase">{row.label}</div>
          <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-1">{row.blurb}</p>
        </div>
        <button
          role="switch"
          aria-checked={on}
          disabled={busy}
          onClick={() => onPatch({ [row.key]: !on })}
          className={`relative inline-flex h-7 w-14 shrink-0 items-center border transition disabled:opacity-50 ${toneClass(row.tone, on)}`}
          data-testid={`setting-toggle-${row.key}`}
        >
          <span
            className={`inline-block h-5 w-5 bg-white shadow transition-transform ${on ? "translate-x-8" : "translate-x-1"}`}
          />
        </button>
      </div>

      {on && row.messageKey && (
        <label className="block mt-4">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
            {row.messageLabel}
          </span>
          <textarea
            rows={2}
            value={settings[row.messageKey] || ""}
            onChange={(e) => onPatch({ [row.messageKey]: e.target.value }, /*debounce*/ true)}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
            data-testid={`setting-text-${row.messageKey}`}
          />
        </label>
      )}

      {on && row.numericKey && (
        <label className="block mt-4 max-w-xs">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
            {row.numericLabel}
          </span>
          <input
            type="number"
            min={row.numericMin}
            max={row.numericMax}
            value={settings[row.numericKey] || 60}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) onPatch({ [row.numericKey]: n }, /*debounce*/ true);
            }}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            data-testid={`setting-num-${row.numericKey}`}
          />
        </label>
      )}
    </div>
  );
}

function HardClearCard({ onCleared }) {
  const [step, setStep] = useState(0); // 0=idle, 1=first confirm, 2=double confirm
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const fire = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await adminClearAllChat();
      setResult(r);
      setStep(0);
      toast.success(`Cleared ${r.deleted} chat message${r.deleted === 1 ? "" : "s"}.`);
      onCleared?.();
    } catch (e) {
      const msg = e?.response?.data?.detail || "Failed to clear chat.";
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-red-900/60 bg-red-950/20 p-4 md:p-5" data-testid="hard-clear-card">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-red-400 mb-2">
        ◆ Danger zone
      </div>
      <div className="font-display text-lg uppercase">Hard clear all chat rooms</div>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-1 mb-4">
        Permanently deletes every chat message across every room. Cannot be undone.
        Forum threads and replies are not touched.
      </p>
      {result && (
        <p className="font-mono text-xs text-emerald-300 mb-3" data-testid="hard-clear-result">
          ◆ Cleared {result.deleted} message{result.deleted === 1 ? "" : "s"}.
        </p>
      )}
      {err && <p className="font-mono text-xs text-red-400 mb-3">{err}</p>}
      {step === 0 && (
        <button
          onClick={() => setStep(1)}
          className="px-4 py-2 border border-red-700 text-red-300 hover:bg-red-900/30 font-mono text-[11px] uppercase tracking-[0.22em]"
          data-testid="hard-clear-btn"
        >
          Hard clear all rooms
        </button>
      )}
      {step === 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStep(2)}
            className="px-4 py-2 border border-red-700 bg-red-900/30 text-red-200 font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid="hard-clear-confirm-1"
          >
            I understand · continue
          </button>
          <button
            onClick={() => setStep(0)}
            className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em]"
          >
            Cancel
          </button>
        </div>
      )}
      {step === 2 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={fire}
            disabled={busy}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white border border-red-700 font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="hard-clear-confirm-2"
          >
            {busy ? "Clearing…" : "Yes — wipe everything"}
          </button>
          <button
            onClick={() => setStep(0)}
            className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em]"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function IdleClearNowCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const fire = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await adminClearIdleChat();
      setResult(r);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border border-[#262626] p-4 md:p-5" data-testid="idle-clear-now-card">
      <div className="font-display text-lg uppercase">Run idle-clear now</div>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-1 mb-4">
        Manually trigger the idle-room cleanup using the configured idle window.
        Useful for spot-checking before relying on the cron.
      </p>
      {result && (
        <pre className="font-mono text-[10px] text-[#a3a3a3] mb-3 overflow-x-auto bg-[#0d0d0d] border border-[#262626] p-2" data-testid="idle-clear-now-result">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      {err && <p className="font-mono text-xs text-red-400 mb-3">{err}</p>}
      <button
        onClick={fire}
        disabled={busy}
        className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
        data-testid="idle-clear-now-btn"
      >
        {busy ? "Running…" : "Run idle-clear now"}
      </button>
    </div>
  );
}

function FeedbackInbox() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("open"); // open | all | resolved
  const [replyTarget, setReplyTarget] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const resolved = filter === "all" ? undefined : filter === "resolved";
      const data = await fetchAdminFeedback(resolved);
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  const resolve = async (id) => {
    await adminResolveFeedback(id);
    await refresh();
  };

  return (
    <div className="border border-[#262626] p-4 md:p-5" data-testid="feedback-inbox">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="font-display text-lg uppercase">Beta feedback inbox</div>
        <div className="flex border border-[#262626]">
          {["open", "resolved", "all"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] border-r border-[#262626] last:border-r-0 ${
                filter === f ? "bg-[#ff4500] text-[#0a0a0a]" : "text-[#a3a3a3] hover:text-[#e5e5e5]"
              }`}
              data-testid={`feedback-filter-${f}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <p className="font-mono text-xs text-[#a3a3a3]">Loading…</p>
      ) : !items.length ? (
        <p className="font-mono text-xs text-[#a3a3a3]" data-testid="feedback-empty">No {filter === "all" ? "" : filter + " "}feedback yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="border border-[#262626] p-3" data-testid={`feedback-${it.id}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-display text-base">{it.name}</div>
                <div className="font-mono text-[10px] text-[#525252]">
                  {(it.created_at || "").slice(0, 16).replace("T", " ")} · {it.page || "—"}
                </div>
              </div>
              <a href={`mailto:${it.email}`} className="font-mono text-[10px] text-[#a3a3a3] hover:text-[#ff4500]">
                {it.email}
              </a>
              <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-2 whitespace-pre-wrap">{it.message}</p>
              {it.replied_at && (
                <div className="mt-2 font-mono text-[10px] text-emerald-400">
                  ◆ Replied by {it.replied_by} · {(it.replied_at || "").slice(0, 16).replace("T", " ")} · "{it.replied_subject}"
                </div>
              )}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {!it.resolved && (
                  <button
                    onClick={() => resolve(it.id)}
                    className="px-3 py-1 border border-emerald-800 hover:border-emerald-500 hover:text-emerald-300 font-mono text-[10px] uppercase tracking-[0.22em]"
                    data-testid={`feedback-resolve-${it.id}`}
                  >
                    Mark resolved
                  </button>
                )}
                <button
                  onClick={() => setReplyTarget(it)}
                  className="px-3 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5"
                  data-testid={`feedback-reply-${it.id}`}
                >
                  ✉ Reply
                </button>
                {it.resolved && (
                  <span className="inline-block px-2 py-0.5 border border-emerald-800 bg-emerald-900/30 text-emerald-300 font-mono text-[9px] uppercase tracking-[0.22em]">
                    Resolved
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {replyTarget && (
        <FeedbackReplyModal
          feedback={replyTarget}
          onClose={() => setReplyTarget(null)}
          onSent={async () => { setReplyTarget(null); await refresh(); }}
        />
      )}
    </div>
  );
}

// One-shot reply composer for a beta-feedback item. Reuses the same dark
// shell as the Admin Email modal — single recipient transactional send +
// optional auto-resolve.
function FeedbackReplyModal({ feedback, onClose, onSent }) {
  const [subject, setSubject] = useState(`Re: your feedback to Crafters Market`);
  const [message, setMessage] = useState(
    `Hi ${feedback.name || "there"},\n\nThanks for the feedback — `,
  );
  const [autoResolve, setAutoResolve] = useState(true);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error("Subject and message are required.");
      return;
    }
    setBusy(true);
    try {
      await replyToFeedback(feedback.id, {
        subject, message, auto_resolve: autoResolve,
      });
      toast.success(`Reply sent to ${feedback.email}.`);
      onSent();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reply failed.");
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="feedback-reply-modal"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="w-full max-w-xl bg-[#0a0a0a] border border-[#ff4500] p-6 md:p-8">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#262626]">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">◆ Feedback reply</div>
            <h3 className="font-display text-2xl mt-1">Reply to {feedback.name}</h3>
            <p className="font-mono text-xs text-[#a3a3a3] mt-1 break-all">{feedback.email}</p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            data-testid="feedback-reply-close"
            className="font-mono text-xl text-[#a3a3a3] hover:text-[#ff4500] disabled:opacity-50"
          >✕</button>
        </div>
        <div className="mt-4 border-l-2 border-[#262626] pl-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] mb-1">Original</div>
          <p className="font-mono text-xs text-[#a3a3a3] whitespace-pre-wrap leading-relaxed line-clamp-5">{feedback.message}</p>
        </div>
        <div className="space-y-3 mt-5">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={180}
              data-testid="feedback-reply-subject"
              className="w-full mt-1.5 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={7}
              data-testid="feedback-reply-message"
              className="w-full mt-1.5 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5] resize-none leading-relaxed"
            />
          </div>
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] cursor-pointer">
            <input
              type="checkbox"
              checked={autoResolve}
              onChange={(e) => setAutoResolve(e.target.checked)}
              data-testid="feedback-reply-resolve"
            />
            Mark as resolved after sending
          </label>
        </div>
        <div className="flex justify-end gap-3 mt-5 pt-4 border-t border-[#262626]">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border border-[#262626] hover:border-[#525252] font-mono text-xs uppercase tracking-[0.22em] disabled:opacity-50"
          >Cancel</button>
          <button
            onClick={send}
            disabled={busy || !subject.trim() || !message.trim()}
            data-testid="feedback-reply-send"
            className="btn-industrial btn-primary disabled:opacity-50"
          >{busy ? "Sending…" : "Send reply →"}</button>
        </div>
      </div>
    </div>
  );
}

function MaintenanceScheduleCard({ settings, onPatch, busy }) {
  // Convert ISO → datetime-local format ("YYYY-MM-DDTHH:MM")
  const toLocal = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ""; }
  };
  // Convert datetime-local → ISO UTC
  const toIso = (local) => {
    if (!local) return "";
    try { return new Date(local).toISOString(); } catch { return ""; }
  };

  return (
    <div className="border border-[#262626] p-4 md:p-5" data-testid="maintenance-schedule-card">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">
        ◆ Scheduled Maintenance
      </div>
      <div className="font-display text-lg uppercase">Plan a window</div>
      <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mt-1 mb-4">
        Set a future time to flip Maintenance Mode on, off, or both. The cron
        runs every minute and clears each schedule once it fires. Leave a field
        blank to skip it.
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
            Turn ON at (local time)
          </span>
          <input
            type="datetime-local"
            value={toLocal(settings.maintenance_scheduled_on)}
            onChange={(e) =>
              onPatch({ maintenance_scheduled_on: toIso(e.target.value) }, true)
            }
            disabled={busy}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            data-testid="maintenance-scheduled-on"
          />
        </label>
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1">
            Turn OFF at (local time)
          </span>
          <input
            type="datetime-local"
            value={toLocal(settings.maintenance_scheduled_off)}
            onChange={(e) =>
              onPatch({ maintenance_scheduled_off: toIso(e.target.value) }, true)
            }
            disabled={busy}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
            data-testid="maintenance-scheduled-off"
          />
        </label>
      </div>
      {(settings.maintenance_scheduled_on || settings.maintenance_scheduled_off) && (
        <button
          onClick={() =>
            onPatch({ maintenance_scheduled_on: "", maintenance_scheduled_off: "" })
          }
          disabled={busy}
          className="mt-4 px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
          data-testid="maintenance-clear-schedule"
        >
          ✕ Clear schedule
        </button>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// SEO diagnostics — hits the public /api/seo/diag endpoint and surfaces
// exactly what `site_root()` resolved to. Flags preview-domain leakage
// (happens when PUBLIC_SITE_URL env var isn't set on a deploy) with a red
// "FIX ME" badge so the operator can't miss it.
// ─────────────────────────────────────────────────────────────────────────────
function SeoDiagCard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setErr("");
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const r = await fetch(`${API}/api/seo/diag`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e.message || "Failed to load");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const leaked = data?.preview_domain_leakage;
  const healthy = data && !leaked;

  return (
    <section className="border border-[#262626] p-4 md:p-5" data-testid="seo-diag-card">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">SEO · sitemap & robots</div>
          <h3 className="font-display text-xl mt-1 text-[#e5e5e5]">Indexing health</h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-xl">
            Confirms `PUBLIC_SITE_URL` is wired correctly and search engines
            will see <code className="text-[#ff4500]">craftersmarket.org</code>{" "}
            URLs (not preview hostnames). Refresh after any deploy.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          data-testid="seo-diag-refresh"
          className="shrink-0 px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
        >
          {busy ? "…" : "↻ Refresh"}
        </button>
      </div>

      {err && <div className="mt-4 font-mono text-xs text-red-400">{err}</div>}

      {data && (
        <div className="mt-4 space-y-3">
          {/* Health pill */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-block px-2 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] font-bold ${
                healthy
                  ? "border-emerald-500/60 text-emerald-400 bg-emerald-500/5"
                  : "border-red-500/60 text-red-400 bg-red-500/5"
              }`}
              data-testid="seo-diag-status"
            >
              {healthy ? "◆ OK" : "✕ Preview leak"}
            </span>
            <span className="font-mono text-xs text-[#e5e5e5]">
              resolved to <code className="text-[#ff4500]">{data.resolved_site_root}</code>
            </span>
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-xs">
            <DiagStat label="static" value={data.breakdown.static_pages} />
            <DiagStat label="products" value={data.breakdown.products} />
            <DiagStat label="makers" value={data.breakdown.makers} />
            <DiagStat label="blog" value={data.breakdown.blog_posts} />
          </div>

          {/* Env var status */}
          <div className="font-mono text-[11px] text-[#a3a3a3] space-y-1 border-t border-[#262626] pt-3">
            <div>
              <span className="text-[#525252]">PUBLIC_SITE_URL:</span>{" "}
              {data.public_site_url_env ? (
                <code className="text-emerald-400">{data.public_site_url_env}</code>
              ) : (
                <span className="text-red-400 font-bold">✕ not set · add to backend env</span>
              )}
            </div>
            <div>
              <span className="text-[#525252]">X-Forwarded-Host:</span>{" "}
              <code className="text-[#e5e5e5]">{data.x_forwarded_host || "—"}</code>
            </div>
            <div>
              <span className="text-[#525252]">Total indexable URLs:</span>{" "}
              <code className="text-[#ff4500]">{data.total_indexable_urls}</code>
            </div>
          </div>

          {/* Quick links */}
          <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.22em] pt-2">
            <a
              href={data.checks.sitemap_endpoint}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] transition"
              data-testid="seo-diag-link-sitemap"
            >
              → sitemap.xml
            </a>
            <a
              href={data.checks.robots_endpoint}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] transition"
              data-testid="seo-diag-link-robots"
            >
              → robots.txt
            </a>
            <a
              href={data.checks.static_index}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] transition"
              data-testid="seo-diag-link-index"
            >
              → static index
            </a>
          </div>

          {leaked && (
            <div className="mt-3 border-l-2 border-red-500 pl-3 font-mono text-[11px] text-red-400 leading-relaxed" data-testid="seo-diag-leak-warning">
              <b>Preview-domain leak detected.</b> Your backend is emitting sitemap
              URLs rooted at a preview hostname. Set{" "}
              <code className="text-[#e5e5e5]">PUBLIC_SITE_URL=https://craftersmarket.org</code>{" "}
              in the deployed backend env, redeploy, then refresh.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DiagStat({ label, value }) {
  return (
    <div className="border border-[#262626] p-2 text-center">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</div>
      <div className="font-display text-2xl text-[#e5e5e5]">{value}</div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// iter111 — Search-engine ping card. Fires an IndexNow ping (Bing / Yandex /
// Naver / Seznam / Yep) on demand from the admin dashboard. Google doesn't
// support IndexNow, so we surface a deep-link to Search Console for the
// manual step. Saves the operator from waiting 1-7 days for natural recrawl
// after a deploy or copy refresh.
// ─────────────────────────────────────────────────────────────────────────────
function SearchEnginePingCard() {
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = async () => {
    setErr("");
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const token = localStorage.getItem("cm_admin_jwt") || "";
      const r = await fetch(`${API}/api/admin/seo/ping/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStatus(await r.json());
    } catch (e) {
      setErr(e.message || "Failed to load");
    }
  };

  const fire = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const API = process.env.REACT_APP_BACKEND_URL;
      const token = localStorage.getItem("cm_admin_jwt") || "";
      const r = await fetch(`${API}/api/admin/seo/ping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ budget: 50 }),
      });
      const body = await r.json();
      setResult(body);
      await refresh();
    } catch (e) {
      setErr(e.message || "Ping failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const lastOk = status?.last_ping_ok;
  const lastWhen = status?.last_ping_at;

  return (
    <section className="border border-[#262626] p-4 md:p-5" data-testid="seo-ping-card">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">SEO · search-engine ping</div>
          <h3 className="font-display text-xl mt-1 text-[#e5e5e5]">Notify search engines</h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-xl">
            Pushes the homepage + ~50 most-recent product / maker / journal
            URLs to <b className="text-[#e5e5e5]">Bing, Yandex, Naver, Seznam, and Yep</b> via IndexNow.
            They&rsquo;ll re-crawl within hours instead of days. Google doesn&rsquo;t
            support IndexNow &mdash; use the Search Console link below for that one.
          </p>
        </div>
        <button
          onClick={fire}
          disabled={busy}
          data-testid="seo-ping-fire"
          className="shrink-0 px-4 py-2 border border-[#ff4500] bg-[#ff4500]/5 text-[#ff4500] hover:bg-[#ff4500] hover:text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50"
        >
          {busy ? "Pinging…" : "▶ Ping now"}
        </button>
      </div>

      {err && <div className="mt-4 font-mono text-xs text-red-400" data-testid="seo-ping-error">{err}</div>}

      {/* Last-ping audit row */}
      {status && (
        <div className="mt-4 flex flex-wrap items-center gap-3 font-mono text-[11px] text-[#a3a3a3]">
          <span className="text-[#525252]">Last ping:</span>
          {lastWhen ? (
            <>
              <code className="text-[#e5e5e5]">{lastWhen}</code>
              <span
                className={`px-2 py-0.5 border font-bold uppercase tracking-[0.22em] text-[10px] ${
                  lastOk
                    ? "border-emerald-500/60 text-emerald-400"
                    : "border-red-500/60 text-red-400"
                }`}
                data-testid="seo-ping-last-status"
              >
                {lastOk ? `✓ ${status.last_ping_status}` : `✕ ${status.last_ping_status || "err"}`}
              </span>
              <span className="text-[#525252]">·</span>
              <span>{status.last_ping_count} URLs</span>
              {status.last_ping_error && (
                <span className="text-red-400">· {status.last_ping_error}</span>
              )}
            </>
          ) : (
            <span className="text-[#525252]">never</span>
          )}
        </div>
      )}

      {/* Most-recent ping result */}
      {result && (
        <div className="mt-4 border-t border-[#262626] pt-4 space-y-3" data-testid="seo-ping-result">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block px-2 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] font-bold ${
                result.ok
                  ? "border-emerald-500/60 text-emerald-400 bg-emerald-500/5"
                  : "border-red-500/60 text-red-400 bg-red-500/5"
              }`}
            >
              {result.ok ? `◆ Submitted · ${result.status}` : `✕ Failed · ${result.status || "err"}`}
            </span>
            <span className="font-mono text-xs text-[#e5e5e5]">
              {result.count} URLs sent to <code className="text-[#ff4500]">api.indexnow.org</code>
            </span>
          </div>

          {!result.ok && result.response_excerpt && (
            <div className="border-l-2 border-red-500 pl-3 font-mono text-[11px] text-red-400 leading-relaxed">
              <b>IndexNow response:</b> {result.response_excerpt}
            </div>
          )}

          {result.urls_sample && result.urls_sample.length > 0 && (
            <details className="font-mono text-[11px] text-[#a3a3a3]">
              <summary className="cursor-pointer hover:text-[#ff4500]" data-testid="seo-ping-urls-toggle">
                ↓ {result.count} URL{result.count === 1 ? "" : "s"} submitted (sample)
              </summary>
              <ul className="mt-2 space-y-1 pl-4 max-h-48 overflow-y-auto">
                {result.urls_sample.map((u) => (
                  <li key={u} className="text-[#e5e5e5] truncate">
                    <a href={u} target="_blank" rel="noreferrer" className="hover:text-[#ff4500]">{u}</a>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Google fallback link — IndexNow doesn't reach Google. */}
          <div className="border-t border-[#262626] pt-3">
            <p className="font-mono text-[11px] text-[#a3a3a3] mb-2">
              Google&rsquo;s turn:
            </p>
            <a
              href={result.google_search_console_url}
              target="_blank"
              rel="noreferrer"
              className="inline-block px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition"
              data-testid="seo-ping-gsc-link"
            >
              → Open Search Console &rarr;
            </a>
          </div>
        </div>
      )}
    </section>
  );
}



/**
 * GscConnectionCard — admin-side "Connect GSC via OAuth" panel.
 *
 * Shows current connection status (OAuth + service-account) and lets
 * the admin either connect a Google account that already has GSC
 * property access, or disconnect / test an existing connection.
 *
 * Two-step flow:
 *   1. Click "Connect" → backend returns Google's authorization URL.
 *   2. Frontend opens that URL in a popup. Google redirects to
 *      /api/admin/gsc/oauth-callback which stores the refresh-token
 *      then posts a message back to the opener.
 *   3. Status auto-refreshes on the postMessage signal.
 *
 * Idempotent disconnect — never destructive (only removes the stored
 * refresh-token; doesn't touch GSC-side permissions).
 */
function GscConnectionCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const s = await adminGscStatus();
      setStatus(s);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't load GSC status.");
    }
  };

  useEffect(() => {
    load();
    // Listen for the popup's postMessage so we auto-refresh after consent
    const onMsg = (e) => {
      if (e?.data?.type === "gsc-oauth") {
        if (e.data.success) {
          toast.success("GSC connected.");
        } else {
          toast.error("GSC connection failed — see popup details.");
        }
        load();
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const connect = async () => {
    setBusy("connect");
    try {
      const { authorization_url } = await adminGscOauthStart();
      // Open in a popup; the callback page posts back via window.opener
      const w = window.open(authorization_url, "gsc-connect", "width=520,height=720");
      if (!w) {
        toast.error("Popup blocked — allow popups for this site and retry.");
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || "Couldn't start OAuth flow.";
      toast.error(msg);
      setErr(msg);
    } finally {
      setBusy("");
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect the stored Google account? GSC inspections will pause until you reconnect (or until the service-account fallback is used).")) return;
    setBusy("disconnect");
    try {
      await adminGscDisconnect();
      toast.success("GSC disconnected.");
      setTestResult(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't disconnect.");
    } finally {
      setBusy("");
    }
  };

  const runTest = async () => {
    setBusy("test");
    setTestResult(null);
    try {
      const r = await adminGscTestInspect("");
      setTestResult(r);
      if (r.ok) toast.success(`Inspection OK → ${r.tier}`);
      else toast.error(`Inspection failed: ${r.reason}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Inspection failed.");
    } finally {
      setBusy("");
    }
  };

  if (!status) return null;

  const oauthAvailable = status.oauth_configured;
  const isConnected = status.connected;

  return (
    <div className="border border-[#262626] p-4 md:p-5" data-testid="gsc-connection-card">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-1">
            ◆ Search Console
          </div>
          <h3 className="font-display text-2xl uppercase">GSC connection</h3>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-2xl leading-relaxed">
            Powers the "Verified by Google" pill + the real index-status tier on listing cards. Connect a Google account that already has GSC access for{" "}
            <code className="text-[#e5e5e5]">{status.site_url || "your GSC property"}</code> and the daily 05:30 UTC sweep starts pulling real verdicts.
          </p>
        </div>
        <ConnectionPill connected={isConnected} email={status.connection?.connected_email} />
      </div>

      {err && <p className="font-mono text-xs text-red-400 mb-3">{err}</p>}

      {!oauthAvailable && !status.service_account_configured && (
        <div className="border border-amber-500/40 bg-amber-500/5 p-3 mb-4 font-mono text-xs text-amber-200">
          ⚠️ OAuth is not configured. Set <code>GSC_OAUTH_CLIENT_ID</code>, <code>GSC_OAUTH_CLIENT_SECRET</code>, and{" "}
          <code>GSC_OAUTH_REDIRECT_URI</code> env vars in production, then reload this page.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {oauthAvailable && !isConnected && (
          <button
            onClick={connect}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 bg-[#ff4500] hover:bg-[#ff5f1f] text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] px-4 py-2 disabled:opacity-50"
            data-testid="gsc-connect-btn"
          >
            {busy === "connect" ? "Opening…" : "Connect Google account"}
          </button>
        )}
        {isConnected && (
          <>
            <button
              onClick={runTest}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 border border-[#ff4500] text-[#ff4500] hover:bg-[#ff4500]/10 font-mono text-[10px] uppercase tracking-[0.22em] px-4 py-2 disabled:opacity-50"
              data-testid="gsc-test-btn"
            >
              {busy === "test" ? "Inspecting…" : "Run test inspection"}
            </button>
            <button
              onClick={disconnect}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 border border-red-500/40 text-red-400 hover:bg-red-500/10 font-mono text-[10px] uppercase tracking-[0.22em] px-4 py-2 disabled:opacity-50"
              data-testid="gsc-disconnect-btn"
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        )}
      </div>

      {testResult && (
        <div
          className={`mt-4 border p-3 font-mono text-xs ${
            testResult.ok ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-300" : "border-red-500/40 bg-red-500/5 text-red-300"
          }`}
          data-testid="gsc-test-result"
        >
          <div className="text-[10px] uppercase tracking-[0.22em] opacity-70 mb-1">
            ◆ Test result · {testResult.url}
          </div>
          {testResult.ok ? (
            <div className="space-y-1">
              <div>Verdict: <span className="text-[#e5e5e5]">{testResult.verdict || "—"}</span></div>
              <div>Coverage: <span className="text-[#e5e5e5]">{testResult.coverage || "—"}</span></div>
              <div>Last crawl: <span className="text-[#e5e5e5]">{testResult.last_crawl || "—"}</span></div>
              <div>Tier: <span className="text-[#ff4500] font-bold">{testResult.tier}</span></div>
            </div>
          ) : (
            <div>Reason: {testResult.reason}</div>
          )}
        </div>
      )}

      {isConnected && status.connection?.connected_at && (
        <p className="font-mono text-[10px] text-[#525252] mt-3">
          Connected {new Date(status.connection.connected_at).toLocaleString()}
          {status.connection.connected_email && ` · ${status.connection.connected_email}`}
        </p>
      )}
    </div>
  );
}

function ConnectionPill({ connected, email }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] shrink-0 ${
        connected
          ? "border-emerald-500/50 bg-emerald-500/5 text-emerald-400"
          : "border-[#262626] bg-[#0a0a0a] text-[#a3a3a3]"
      }`}
      data-testid="gsc-connection-pill"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-[#525252]"}`} />
      {connected ? (email ? `Connected · ${email}` : "Connected") : "Not connected"}
    </div>
  );
}



export default function SettingsTab() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pendingText, setPendingText] = useState({});

  const refresh = async () => {
    setLoading(true);
    try {
      const s = await fetchAdminSettings();
      setSettings(s);
      setPendingText({});
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  // Debounced PATCH for text/numeric edits.
  useEffect(() => {
    const keys = Object.keys(pendingText);
    if (!keys.length) return;
    const t = setTimeout(async () => {
      try {
        const next = await patchAdminSettings(pendingText);
        setSettings(next);
        setPendingText({});
        refreshSiteSettings();
      } catch (e) {
        setErr(e?.response?.data?.detail || "Failed to save.");
      }
    }, 700);
    return () => clearTimeout(t);
  }, [pendingText]);

  const onPatch = async (delta, debounce = false) => {
    setSettings((s) => ({ ...s, ...delta }));
    if (debounce) {
      setPendingText((p) => ({ ...p, ...delta }));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const next = await patchAdminSettings(delta);
      setSettings(next);
      refreshSiteSettings();
      const k = Object.keys(delta)[0];
      const v = delta[k];
      const label = k.replace(/_/g, " ");
      if (typeof v === "boolean") {
        toast.success(`${label} ${v ? "enabled" : "disabled"}`);
      } else {
        toast.success(`${label} updated`);
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || "Failed to save.";
      setErr(msg);
      toast.error(msg);
      // Revert on failure.
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="space-y-3" data-testid="settings-loading">
        <RowsSkeleton count={6} />
      </div>
    );
  }

  return (
    <div data-testid="settings-tab" className="space-y-6">
      <div className="border border-[#262626] p-4 md:p-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">
          ◆ Site Switches
        </div>
        <h3 className="font-display text-2xl uppercase mb-1">Operator controls</h3>
        <p className="font-mono text-xs text-[#a3a3a3]">
          All toggles take effect within ~60 seconds for users (frontend polls /api/settings).
          Admin + maker portals always stay accessible — even in maintenance mode — so you can flip switches back.
        </p>
      </div>

      {err && <p className="font-mono text-xs text-red-400" data-testid="settings-error">{err}</p>}

      <div className="grid gap-3">
        {SWITCHES.map((row) => (
          <ToggleRow
            key={row.key}
            row={row}
            settings={settings}
            onPatch={onPatch}
            busy={busy}
          />
        ))}
      </div>

      <MaintenanceScheduleCard settings={settings} onPatch={onPatch} busy={busy} />

      <SeoDiagCard />

      <SearchEnginePingCard />

      <GscConnectionCard />

      <div className="grid md:grid-cols-2 gap-3">
        <IdleClearNowCard />
        <HardClearCard onCleared={refresh} />
      </div>

      <FeedbackInbox />
    </div>
  );
}
