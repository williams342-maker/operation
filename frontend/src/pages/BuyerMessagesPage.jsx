import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Inbox, Send, RefreshCw, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import {
  fetchBuyerThreads, fetchBuyerThread, replyBuyerThread,
} from "../lib/api";
import { useStructuredData } from "../lib/seo";

/** Buyer-side DM inbox at `/messages`. Mirrors the maker tab — two-pane
 *  layout, deep-linked via `?thread=<id>`. Requires a community user JWT. */
export default function BuyerMessagesPage() {
  const navigate = useNavigate();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const composerRef = useRef(null);

  useStructuredData({
    title: "Messages · Crafters Market",
    description: "Direct conversations with makers on Crafters Market.",
    url: `${window.location.origin}/messages`,
    jsonLd: null,
  });

  const initialThreadId = useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("thread");
    } catch { return null; }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem("cm_buyer_jwt")) {
      navigate("/community/login?next=/messages", { replace: true });
      return;
    }
    (async () => {
      const list = await loadThreads();
      setLoading(false);
      if (initialThreadId && list.find((t) => t.id === initialThreadId)) {
        openThread(initialThreadId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadThreads = async () => {
    setRefreshing(true);
    try {
      const r = await fetchBuyerThreads();
      setThreads(r.threads || []);
      return r.threads || [];
    } catch (e) {
      if (e?.response?.status === 401) {
        navigate("/community/login?next=/messages", { replace: true });
      } else {
        toast.error(e?.response?.data?.detail || "Couldn't load messages.");
      }
      return [];
    } finally {
      setRefreshing(false);
    }
  };

  const openThread = async (id) => {
    setActiveId(id);
    try {
      const r = await fetchBuyerThread(id);
      setThread(r.thread);
      setMessages(r.messages || []);
      setThreads((cur) => cur.map((t) => t.id === id ? { ...t, unread_for_buyer: 0 } : t));
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
      await replyBuyerThread(activeId, body);
      setDraft("");
      const r = await fetchBuyerThread(activeId);
      setThread(r.thread);
      setMessages(r.messages || []);
      setThreads((cur) => {
        const updated = cur.find((t) => t.id === activeId);
        if (!updated) return cur;
        const rest = cur.filter((t) => t.id !== activeId);
        return [{ ...updated, last_sender: "buyer", last_message_at: new Date().toISOString() }, ...rest];
      });
      toast.success("Reply sent.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reply failed.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="buyer-messages-page">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8">
        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">◆ Inbox</div>
            <h1 className="font-display text-[56px] md:text-[88px] leading-[0.88]">
              Your <span className="text-outline">Messages</span>
            </h1>
            <p className="font-mono text-xs text-[#a3a3a3] mt-3 max-w-md">
              Direct conversations with makers — replies arrive via email and stay logged here.
            </p>
          </div>
          <button
            onClick={loadThreads}
            disabled={refreshing}
            className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="buyer-messages-refresh"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
            ◆ Loading inbox…
          </div>
        ) : threads.length === 0 ? (
          <div className="border border-dashed border-[#1f1f1f] p-16 text-center" data-testid="buyer-messages-empty">
            <Inbox size={36} className="text-[#404040] mx-auto mb-3" />
            <h3 className="font-display text-2xl uppercase mb-2">No messages yet.</h3>
            <p className="font-mono text-xs text-[#737373] max-w-md mx-auto">
              Visit a maker's page and tap "Message" to start a conversation. Replies will land here.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-[320px_1fr] gap-0 border border-[#1f1f1f]">
            <aside className="border-r border-[#1f1f1f] max-h-[70vh] overflow-y-auto" data-testid="buyer-thread-list">
              {threads.map((t) => {
                const isActive = t.id === activeId;
                const unread = (t.unread_for_buyer || 0) > 0;
                return (
                  <button
                    key={t.id}
                    onClick={() => openThread(t.id)}
                    className={`w-full text-left p-4 border-b border-[#1f1f1f] transition-all hover:bg-[#161616] ${
                      isActive ? "bg-[#ff4500]/10 border-l-2 border-l-[#ff4500]" : "border-l-2 border-l-transparent"
                    }`}
                    data-testid={`buyer-thread-row-${t.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-display text-base truncate ${unread ? "text-white" : "text-[#a3a3a3]"}`}>
                            {t.maker_name}
                          </span>
                          {unread && (
                            <span className="bg-[#ff4500] text-[#0a0a0a] text-[9px] font-mono px-1.5 py-0.5">
                              {t.unread_for_buyer}
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#525252] truncate mt-1">
                          {t.subject || "—"}
                        </div>
                        <div className="font-mono text-[11px] text-[#737373] truncate mt-1">
                          {t.last_sender === "buyer" ? "↳ You: " : ""}{t.last_preview || ""}
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

            <section className="min-h-[60vh] flex flex-col" data-testid="buyer-thread-reader">
              {!thread ? (
                <div className="flex-1 flex items-center justify-center text-center p-12">
                  <div>
                    <MessageSquare className="text-[#404040] mx-auto mb-3" size={36} />
                    <p className="font-mono text-xs text-[#737373]">Select a conversation to read it.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="p-5 border-b border-[#1f1f1f]">
                    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">
                      ◆ {thread.maker_name}
                    </div>
                    <h3 className="font-display text-2xl uppercase">{thread.subject || "Conversation"}</h3>
                  </div>
                  <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[50vh]">
                    {messages.map((m) => (
                      <Bubble key={m.id} m={m} mine={m.sender_type === "buyer"} />
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
                      placeholder={`Reply to ${thread.maker_name} · ⌘+Enter to send`}
                      className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm resize-y"
                      maxLength={4000}
                      data-testid="buyer-thread-reply-input"
                    />
                    <div className="flex justify-between items-center mt-2">
                      <span className="font-mono text-[10px] text-[#525252]">{draft.length} / 4000</span>
                      <button
                        onClick={sendReply}
                        disabled={sending || !draft.trim()}
                        className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
                        data-testid="buyer-thread-reply-btn"
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
    </div>
  );
}

function Bubble({ m, mine }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid={`buyer-message-${m.id}`}>
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
