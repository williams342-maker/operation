/**
 * Admin · Beta Feedback Tab
 *
 * Lists every submission to the public Beta Feedback widget in the order
 * it was received (most recent first), plus a filter to show pending vs
 * resolved tickets. Admin can:
 *   • Reply via email (uses POST /admin/feedback/:id/reply, auto-resolves)
 *   • Resolve without reply (POST /admin/feedback/:id/resolve)
 *   • Click an email/page-context link to open the affected page
 *
 * The endpoints already existed (settings.py); this tab is purely a UI
 * surface so admins can read incoming feedback without having to dig in
 * MongoDB.
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Mail, Check, MessageSquare, ExternalLink } from "lucide-react";
import { fetchAdminFeedback, adminResolveFeedback, replyToFeedback } from "../../lib/api";
import EmptyState from "../EmptyState";
import { RowsSkeleton } from "../Skeleton";
import { timeAgo } from "../../lib/timeAgo";

const FILTERS = [
  { id: "pending", label: "Pending", resolved: false },
  { id: "resolved", label: "Resolved", resolved: true },
  { id: "all", label: "All", resolved: undefined },
];

export default function FeedbackTab() {
  const [filter, setFilter] = useState("pending");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyOpen, setReplyOpen] = useState(null); // feedback id
  const [resolving, setResolving] = useState("");

  const refresh = async () => {
    const f = FILTERS.find((x) => x.id === filter);
    setLoading(true);
    try {
      const r = await fetchAdminFeedback(f.resolved);
      // Server already sorts by created_at desc; preserve that order.
      setItems(r.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load feedback.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-line */ }, [filter]);

  const counts = useMemo(() => ({
    pending: items.filter((i) => !i.resolved).length,
    resolved: items.filter((i) => i.resolved).length,
    all: items.length,
  }), [items]);

  const onResolve = async (id) => {
    setResolving(id);
    try {
      await adminResolveFeedback(id);
      toast.success("Marked as resolved.");
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't resolve.");
    } finally {
      setResolving("");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-feedback-tab">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-3xl text-ink">Beta Feedback</h2>
          <p className="font-mono text-xs text-ink-muted mt-1">
            Submissions from the public Beta Feedback widget · newest first
          </p>
        </div>
        <div className="flex border border-line" data-testid="feedback-filter">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                data-testid={`feedback-filter-${f.id}`}
                className={`px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                  active ? "bg-brand text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </header>

      {loading ? (
        <div data-testid="feedback-loading"><RowsSkeleton count={4} /></div>
      ) : !items.length ? (
        <EmptyState
          title={filter === "pending" ? "Nothing waiting on you." : "No feedback yet."}
          subtitle={filter === "pending"
            ? "Every beta submission has been replied to or resolved. Nice."
            : "Submissions will appear here as buyers and makers send them in."}
          icon={MessageSquare}
        />
      ) : (
        <ol className="border border-line divide-y divide-line" data-testid="feedback-list">
          {items.map((f, idx) => (
            <FeedbackRow
              key={f.id}
              fb={f}
              index={items.length - idx}  // received-order number
              isOpen={replyOpen === f.id}
              onToggleReply={() => setReplyOpen(replyOpen === f.id ? null : f.id)}
              onResolve={() => onResolve(f.id)}
              resolving={resolving === f.id}
              onSentReply={() => { setReplyOpen(null); refresh(); }}
            />
          ))}
        </ol>
      )}

      <p className="font-mono text-[10px] text-ink-muted">
        Showing {items.length} submission{items.length === 1 ? "" : "s"} ·
        {" "}{counts.pending} pending · {counts.resolved} resolved
      </p>
    </div>
  );
}

function FeedbackRow({ fb, index, isOpen, onToggleReply, onResolve, resolving, onSentReply }) {
  return (
    <li className="px-5 py-4" data-testid={`feedback-row-${fb.id}`}>
      <div className="flex items-start gap-4">
        <span className="font-display text-xl text-ink-muted shrink-0 w-8 text-right" title="Received order #">
          #{index}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-ink font-bold">
              {fb.name || "Anonymous"}
            </span>
            {fb.email && (
              <a
                href={`mailto:${fb.email}`}
                className="font-mono text-xs text-ink-muted hover:text-brand"
                data-testid={`feedback-email-${fb.id}`}
              >
                {fb.email}
              </a>
            )}
            <span className="font-mono text-[10px] text-ink-muted">
              · {timeAgo(fb.created_at)}
            </span>
            {fb.resolved && (
              <span className="px-2 py-0.5 border border-emerald-500/40 text-emerald-400 font-mono text-[9px] uppercase tracking-[0.22em]">
                ✓ Resolved
              </span>
            )}
            {fb.replied_at && (
              <span className="px-2 py-0.5 border border-sky-500/40 text-sky-400 font-mono text-[9px] uppercase tracking-[0.22em]" title={`Replied ${timeAgo(fb.replied_at)}`}>
                ✉ Replied
              </span>
            )}
          </div>
          <p
            className="font-mono text-sm text-ink mt-2 whitespace-pre-wrap leading-relaxed"
            data-testid={`feedback-message-${fb.id}`}
          >
            {fb.message}
          </p>
          {fb.page && (
            <a
              href={fb.page}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand"
              data-testid={`feedback-page-${fb.id}`}
            >
              <ExternalLink size={10} /> {fb.page.replace(/^https?:\/\/[^/]+/, "")}
            </a>
          )}
          {isOpen && (
            <ReplyComposer
              feedbackId={fb.id}
              onSent={onSentReply}
              defaultSubject={`Re: your feedback on Crafters Market`}
            />
          )}
        </div>
        {!fb.resolved && (
          <div className="flex flex-col gap-2 shrink-0">
            {fb.email && (
              <button
                type="button"
                onClick={onToggleReply}
                data-testid={`feedback-reply-${fb.id}`}
                className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
              >
                <Mail size={12} className="inline mr-1" /> {isOpen ? "Cancel" : "Reply"}
              </button>
            )}
            <button
              type="button"
              onClick={onResolve}
              disabled={resolving}
              data-testid={`feedback-resolve-${fb.id}`}
              className="px-3 py-1.5 border border-line hover:border-emerald-500/60 hover:text-emerald-400 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
            >
              <Check size={12} className="inline mr-1" /> {resolving ? "…" : "Resolve"}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function ReplyComposer({ feedbackId, onSent, defaultSubject }) {
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error("Subject and message are required.");
      return;
    }
    setBusy(true);
    try {
      await replyToFeedback(feedbackId, { subject, message, auto_resolve: true });
      toast.success("Reply sent · ticket auto-resolved.");
      onSent();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send reply.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mt-3 border border-line bg-paper p-3 space-y-2"
      data-testid={`feedback-reply-composer-${feedbackId}`}
    >
      <input
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
        data-testid={`feedback-reply-subject-${feedbackId}`}
      />
      <textarea
        rows={5}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Type your reply…"
        className="w-full bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink resize-none leading-relaxed"
        data-testid={`feedback-reply-body-${feedbackId}`}
      />
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="btn-industrial btn-primary disabled:opacity-50"
        data-testid={`feedback-reply-send-${feedbackId}`}
      >
        {busy ? "Sending…" : "Send & resolve →"}
      </button>
    </div>
  );
}
