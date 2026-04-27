import React, { useEffect, useMemo, useRef, useState } from "react";
import { Inbox, Send, RefreshCw, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import {
  fetchMakerThreads, fetchMakerThread, replyMakerThread,
} from "../../lib/api";

/** Maker Messages tab — two-pane inbox.
 *  Left: thread list (sorted by last_message_at, unread badge).
 *  Right: active thread reader + reply composer.
 *  Deep-linked via `?thread=<id>` on the URL hash so email CTAs land on it.
 */
export default function MessagesTab({ maker }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const composerRef = useRef(null);

  // Read ?thread=... from the hash (e.g. #messages?thread=abc).
  const initialThreadId = useMemo(() => {
    try {
      const hash = window.location.hash || "";
      const q = hash.split("?")[1] || "";
      const params = new URLSearchParams(q);
      return params.get("thread");
    } catch { return null; }
  }, []);

  const loadThreads = async () => {
    setRefreshing(true);
    try {
      const r = await fetchMakerThreads();
      setThreads(r.threads || []);
      return r.threads || [];
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load messages.");
      return [];
    } finally {
      setRefreshing(false);
    }
  };

  const openThread = async (id) => {
    setActiveId(id);
    try {
      const r = await fetchMakerThread(id);
      setThread(r.thread);
      setMessages(r.messages || []);
      // Locally clear unread on the thread row so the badge disappears.
      setThreads((cur) => cur.map((t) => t.id === id ? { ...t, unread_for_maker: 0 } : t));
      requestAnimationFrame(() => {
        composerRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't open thread.");
    }
  };

  const sendReply = async () => {
    const body = draft.trim();
    if (!body || !activeId) return;
    setSending(true);
    try {
      await replyMakerThread(activeId, body);
      setDraft("");
      const r = await fetchMakerThread(activeId);
      setThread(r.thread);
      setMessages(r.messages || []);
      // Move thread to top + flip last_sender locally.
      setThreads((cur) => {
        const updated = cur.find((t) => t.id === activeId);
        if (!updated) return cur;
        const rest = cur.filter((t) => t.id !== activeId);
        return [{ ...updated, last_sender: "maker", last_message_at: new Date().toISOString() }, ...rest];
      });
      toast.success("Reply sent.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reply failed.");
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    (async () => {
      const list = await loadThreads();
      setLoading(false);
      if (initialThreadId && list.find((t) => t.id === initialThreadId)) {
        openThread(initialThreadId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div data-testid="messages-tab">
      <header className="pb-6 border-b border-[#262626] flex items-center justify-between">
        <div>
          <h2 className="font-display text-3xl md:text-4xl uppercase">Messages.</h2>
          <p className="font-mono text-xs text-[#a3a3a3] mt-2">
            Direct conversations with buyers — replies deliver via email and
            stay logged here for the audit trail.
          </p>
        </div>
        <button
          onClick={loadThreads}
          className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2 disabled:opacity-50"
          disabled={refreshing}
          data-testid="messages-refresh-btn"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      {loading ? (
        <div className="py-12 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
          ◆ Loading inbox…
        </div>
      ) : threads.length === 0 ? (
        <EmptyInbox />
      ) : (
        <div className="grid md:grid-cols-[320px_1fr] gap-0 mt-6 border border-[#1f1f1f]">
          {/* Thread list */}
          <aside className="border-r border-[#1f1f1f] max-h-[70vh] overflow-y-auto" data-testid="messages-list">
            {threads.map((t) => {
              const isActive = t.id === activeId;
              const unread = (t.unread_for_maker || 0) > 0;
              return (
                <button
                  key={t.id}
                  onClick={() => openThread(t.id)}
                  className={`w-full text-left p-4 border-b border-[#1f1f1f] transition-all hover:bg-[#161616] ${
                    isActive ? "bg-[#ff4500]/10 border-l-2 border-l-[#ff4500]" : "border-l-2 border-l-transparent"
                  }`}
                  data-testid={`thread-row-${t.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-display text-base truncate ${unread ? "text-white" : "text-[#a3a3a3]"}`}>
                          {t.buyer_name || t.buyer_email}
                        </span>
                        {unread && (
                          <span className="bg-[#ff4500] text-[#0a0a0a] text-[9px] font-mono px-1.5 py-0.5 rounded-sm" data-testid={`thread-unread-${t.id}`}>
                            {t.unread_for_maker}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#525252] truncate mt-1">
                        {t.subject || "—"}
                      </div>
                      <div className="font-mono text-[11px] text-[#737373] truncate mt-1">
                        {t.last_sender === "maker" ? "↳ You: " : ""}{t.last_preview || ""}
                      </div>
                    </div>
                    <div className="font-mono text-[9px] text-[#525252] uppercase tracking-[0.18em] shrink-0">
                      {fmtDate(t.last_message_at)}
                    </div>
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Active thread */}
          <section className="min-h-[60vh] flex flex-col" data-testid="messages-reader">
            {!thread ? (
              <div className="flex-1 flex items-center justify-center text-center p-12">
                <div>
                  <MessageSquare className="text-[#404040] mx-auto mb-3" size={36} />
                  <p className="font-mono text-xs text-[#737373]">Select a thread to read it.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="p-5 border-b border-[#1f1f1f]" data-testid="thread-header">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">
                    ◆ {thread.buyer_name || thread.buyer_email}
                  </div>
                  <h3 className="font-display text-2xl uppercase">{thread.subject || "Conversation"}</h3>
                  <div className="font-mono text-[10px] text-[#525252] mt-2">
                    {thread.buyer_email}
                    {thread.product_slug ? ` · re: ${thread.product_slug}` : ""}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[50vh]" data-testid="thread-messages">
                  {messages.map((m) => (
                    <MessageBubble key={m.id} m={m} mineSlug={maker?.slug} mineSenderType="maker" />
                  ))}
                </div>

                <div ref={composerRef} className="p-4 border-t border-[#1f1f1f] bg-[#0d0d0d]">
                  <textarea
                    rows={3}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); }
                    }}
                    placeholder="Reply to the buyer · ⌘+Enter to send"
                    className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm resize-y"
                    maxLength={4000}
                    data-testid="thread-reply-input"
                  />
                  <div className="flex justify-between items-center mt-2">
                    <span className="font-mono text-[10px] text-[#525252]">{draft.length} / 4000</span>
                    <button
                      onClick={sendReply}
                      disabled={sending || !draft.trim()}
                      className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
                      data-testid="thread-reply-btn"
                    >
                      <Send size={14} /> {sending ? "Sending…" : "Send reply"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function EmptyInbox() {
  return (
    <div className="border border-dashed border-[#1f1f1f] p-12 mt-6 text-center" data-testid="messages-empty">
      <Inbox size={36} className="text-[#404040] mx-auto mb-3" />
      <h3 className="font-display text-2xl uppercase mb-2">No messages yet.</h3>
      <p className="font-mono text-xs text-[#737373] max-w-md mx-auto">
        Buyers can reach you from your shop or product pages — every DM lands here
        and triggers an email. Replies stay logged for the audit trail.
      </p>
    </div>
  );
}

function MessageBubble({ m, mineSenderType }) {
  const mine = m.sender_type === mineSenderType;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid={`message-${m.id}`}>
      <div className={`max-w-[80%] border ${mine ? "border-[#ff4500] bg-[#ff4500]/10" : "border-[#262626] bg-[#121212]"} p-3`}>
        <div className={`font-mono text-[10px] uppercase tracking-[0.18em] mb-1 ${mine ? "text-[#ff4500]" : "text-[#a3a3a3]"}`}>
          {mine ? "You" : (m.sender_name || m.sender_email)} · {fmtDate(m.created_at, true)}
        </div>
        <div className="font-mono text-sm text-[#e5e5e5] whitespace-pre-wrap break-words">
          {m.body}
        </div>
      </div>
    </div>
  );
}

function fmtDate(iso, withTime = false) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (withTime) {
      return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    }
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return ""; }
}
