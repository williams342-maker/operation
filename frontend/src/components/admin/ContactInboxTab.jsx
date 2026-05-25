/**
 * Admin · Contact Inbox Tab
 *
 * Lists every public Contact-form submission from `/contact` newest-first.
 * Mirrors the Beta Feedback tab's interactions (Reply / Resolve) plus a
 * Topic filter (general / custom_order / order_help / maker_program /
 * press / partnership / bug / other).
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Mail, Check, MessageSquare, ExternalLink, Phone } from "lucide-react";
import {
  fetchAdminContactMessages,
  adminResolveContactMessage,
  adminReplyContactMessage,
} from "../../lib/api";
import EmptyState from "../EmptyState";
import { RowsSkeleton } from "../Skeleton";
import { timeAgo } from "../../lib/timeAgo";

const FILTERS = [
  { id: "pending", label: "Pending", resolved: false },
  { id: "resolved", label: "Resolved", resolved: true },
  { id: "all", label: "All", resolved: undefined },
];

const TOPIC_LABELS = {
  general: "General",
  custom_order: "Custom",
  order_help: "Order help",
  maker_program: "Maker program",
  press: "Press",
  partnership: "Partnership",
  bug: "Bug",
  other: "Other",
};
const TOPIC_TONE = {
  custom_order: "border-[#ff4500]/40 text-[#ff4500]",
  order_help: "border-amber-500/40 text-amber-400",
  bug: "border-red-500/40 text-red-400",
  press: "border-purple-500/40 text-purple-400",
  partnership: "border-sky-500/40 text-sky-400",
};
const TOPIC_FILTER_OPTIONS = ["all", ...Object.keys(TOPIC_LABELS)];

export default function ContactInboxTab() {
  const [filter, setFilter] = useState("pending");
  const [topicFilter, setTopicFilter] = useState("all");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyOpen, setReplyOpen] = useState(null);
  const [resolving, setResolving] = useState("");

  const refresh = async () => {
    const f = FILTERS.find((x) => x.id === filter);
    setLoading(true);
    try {
      const r = await fetchAdminContactMessages(
        f.resolved,
        topicFilter === "all" ? undefined : topicFilter,
      );
      setItems(r.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load messages.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-line */ }, [filter, topicFilter]);

  const counts = useMemo(() => ({
    pending: items.filter((i) => !i.resolved).length,
    resolved: items.filter((i) => i.resolved).length,
    all: items.length,
  }), [items]);

  const onResolve = async (id) => {
    setResolving(id);
    try {
      await adminResolveContactMessage(id);
      toast.success("Marked as resolved.");
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't resolve.");
    } finally {
      setResolving("");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-contact-tab">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-3xl text-[#e5e5e5]">Contact Messages</h2>
          <p className="font-mono text-xs text-[#a3a3a3] mt-1">
            Submissions from <span className="text-[#e5e5e5]">/contact</span> · newest first
          </p>
        </div>
        <div className="flex border border-[#262626]" data-testid="contact-filter">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                data-testid={`contact-filter-${f.id}`}
                className={`px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                  active ? "bg-[#ff4500] text-black" : "text-[#a3a3a3] hover:text-[#e5e5e5]"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex gap-2 flex-wrap" data-testid="contact-topic-filter">
        {TOPIC_FILTER_OPTIONS.map((tid) => {
          const active = topicFilter === tid;
          const label = tid === "all" ? "All topics" : TOPIC_LABELS[tid];
          return (
            <button
              key={tid}
              type="button"
              onClick={() => setTopicFilter(tid)}
              data-testid={`contact-topic-${tid}`}
              className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                active
                  ? "border-[#ff4500] text-[#ff4500] bg-[#ff4500]/5"
                  : "border-[#262626] text-[#a3a3a3] hover:text-[#e5e5e5]"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div data-testid="contact-inbox-loading"><RowsSkeleton count={4} /></div>
      ) : !items.length ? (
        <EmptyState
          title={filter === "pending" ? "Nothing waiting on you." : "No messages yet."}
          subtitle={filter === "pending"
            ? "Every contact-form submission has been replied to or resolved."
            : "Submissions from the public contact form will appear here."}
          icon={MessageSquare}
        />
      ) : (
        <ol className="border border-[#262626] divide-y divide-[#1a1a1a]" data-testid="contact-list">
          {items.map((m, idx) => (
            <ContactRow
              key={m.id}
              msg={m}
              index={items.length - idx}
              isOpen={replyOpen === m.id}
              onToggleReply={() => setReplyOpen(replyOpen === m.id ? null : m.id)}
              onResolve={() => onResolve(m.id)}
              resolving={resolving === m.id}
              onSentReply={() => { setReplyOpen(null); refresh(); }}
            />
          ))}
        </ol>
      )}

      <p className="font-mono text-[10px] text-[#525252]">
        Showing {items.length} message{items.length === 1 ? "" : "s"} ·
        {" "}{counts.pending} pending · {counts.resolved} resolved
      </p>
    </div>
  );
}

function ContactRow({ msg, index, isOpen, onToggleReply, onResolve, resolving, onSentReply }) {
  const tone = TOPIC_TONE[msg.topic] || "border-[#262626] text-[#a3a3a3]";
  return (
    <li className="px-5 py-4" data-testid={`contact-row-${msg.id}`}>
      <div className="flex items-start gap-4">
        <span className="font-display text-xl text-[#525252] shrink-0 w-8 text-right" title="Received order #">
          #{index}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-[#e5e5e5] font-bold">
              {msg.name || "Anonymous"}
            </span>
            <a
              href={`mailto:${msg.email}`}
              className="font-mono text-xs text-[#a3a3a3] hover:text-[#ff4500]"
              data-testid={`contact-email-${msg.id}`}
            >
              {msg.email}
            </a>
            {msg.phone && (
              <a
                href={`tel:${msg.phone}`}
                className="inline-flex items-center gap-1 font-mono text-[10px] text-[#a3a3a3] hover:text-[#ff4500]"
              >
                <Phone size={10} /> {msg.phone}
              </a>
            )}
            <span className={`px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.22em] ${tone}`}>
              {TOPIC_LABELS[msg.topic] || msg.topic}
            </span>
            <span className="font-mono text-[10px] text-[#525252]">· {timeAgo(msg.created_at)}</span>
            {msg.resolved && (
              <span className="px-2 py-0.5 border border-emerald-500/40 text-emerald-400 font-mono text-[9px] uppercase tracking-[0.22em]">
                ✓ Resolved
              </span>
            )}
            {msg.replied_at && (
              <span
                className="px-2 py-0.5 border border-sky-500/40 text-sky-400 font-mono text-[9px] uppercase tracking-[0.22em]"
                title={`Replied ${timeAgo(msg.replied_at)}`}
              >
                ✉ Replied
              </span>
            )}
          </div>
          {msg.subject && (
            <div className="font-mono text-xs text-[#e5e5e5] mt-2 italic">
              Subject: {msg.subject}
            </div>
          )}
          <p
            className="font-mono text-sm text-[#e5e5e5] mt-2 whitespace-pre-wrap leading-relaxed"
            data-testid={`contact-message-${msg.id}`}
          >
            {msg.message}
          </p>
          {isOpen && (
            <ReplyComposer
              messageId={msg.id}
              onSent={onSentReply}
              defaultSubject={msg.subject ? `Re: ${msg.subject}` : "Re: your message to Crafters Market"}
            />
          )}
        </div>
        {!msg.resolved && (
          <div className="flex flex-col gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleReply}
              data-testid={`contact-reply-${msg.id}`}
              className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition"
            >
              <Mail size={12} className="inline mr-1" /> {isOpen ? "Cancel" : "Reply"}
            </button>
            <button
              type="button"
              onClick={onResolve}
              disabled={resolving}
              data-testid={`contact-resolve-${msg.id}`}
              className="px-3 py-1.5 border border-[#262626] hover:border-emerald-500/60 hover:text-emerald-400 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
            >
              <Check size={12} className="inline mr-1" /> {resolving ? "…" : "Resolve"}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function ReplyComposer({ messageId, onSent, defaultSubject }) {
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!subject.trim() || message.trim().length < 2) {
      toast.error("Subject and message are required.");
      return;
    }
    setBusy(true);
    try {
      await adminReplyContactMessage(messageId, { subject, message, auto_resolve: true });
      toast.success("Reply sent · ticket auto-resolved.");
      onSent();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send reply.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 border border-[#262626] bg-[#0a0a0a] p-3 space-y-2" data-testid={`contact-reply-composer-${messageId}`}>
      <input
        type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        className="w-full bg-[#0d0d0d] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5]"
        data-testid={`contact-reply-subject-${messageId}`}
      />
      <textarea
        rows={5} value={message} onChange={(e) => setMessage(e.target.value)}
        placeholder="Type your reply…"
        className="w-full bg-[#0d0d0d] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5] resize-none leading-relaxed"
        data-testid={`contact-reply-body-${messageId}`}
      />
      <button
        type="button" onClick={send} disabled={busy}
        className="btn-industrial btn-primary disabled:opacity-50"
        data-testid={`contact-reply-send-${messageId}`}
      >
        {busy ? "Sending…" : "Send & resolve →"}
      </button>
    </div>
  );
}
