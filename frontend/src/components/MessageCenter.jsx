import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Inbox, Star, AlertCircle, Send, Archive, Trash2, Search,
  ArrowLeft, MailOpen, Mail, Paperclip, X,
} from "lucide-react";

/**
 * MessageCenter — shared two-pane inbox used by both the Maker Dashboard
 * (Messages tab) and the Buyer Account Messages page.
 *
 * Layout (Etsy-inspired, dark-industrial themed):
 *   ┌──────────┬────────────────────────────┬─────────────────────────┐
 *   │  Folder  │  Top toolbar (search +     │                         │
 *   │  rail    │  bulk actions when N>0)    │   Reader pane           │
 *   │ + counts │ ──────────────────────────│   (open thread, reply)  │
 *   │          │  Thread list rows         │                         │
 *   └──────────┴────────────────────────────┴─────────────────────────┘
 *
 * Folder rail: Inbox · Starred · Unread · Sent · Archive · Trash
 * Toolbar actions (when 1+ rows selected): Star · Mark unread · Archive · Trash
 * Per-row hover-action: Star toggle
 *
 * Props (kept small — caller injects API + role-specific naming):
 *   role:               "maker" | "buyer"      (used for testid + label copy)
 *   fetchThreads(f,q):  () => { threads, counts }
 *   fetchThread(id):    () => { thread, messages }
 *   patchThread(id,p):  PATCH single thread
 *   bulkPatch(ids,p):   POST bulk patch
 *   replyThread(id,b):  POST a reply
 *   counterpartLabel:   "Buyer" or "Maker" — shown in column header
 *
 * The component is intentionally controlled by callbacks rather than
 * hard-coding API endpoints, so the SAME UI works on both sides without
 * branching. Anything role-specific lives in the parent.
 */
const FOLDERS = [
  { id: "inbox",    label: "Inbox",      Icon: Inbox },
  { id: "starred",  label: "Starred",    Icon: Star },
  { id: "unread",   label: "Unread",     Icon: AlertCircle },
  { id: "sent",     label: "Sent",       Icon: Send },
  { id: "archive",  label: "Archive",    Icon: Archive },
  { id: "trash",    label: "Trash",      Icon: Trash2 },
];

const initials = (s) => (s || "?").split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
const BACKEND = process.env.REACT_APP_BACKEND_URL;
const MAX_ATTACHMENTS = 4;

export default function MessageCenter({
  role,
  fetchThreads,
  fetchThread,
  patchThread,
  bulkPatch,
  replyThread,
  emptyTrash,
  uploadAttachment,
  counterpartLabel = "Counterpart",
}) {
  const [folder, setFolder] = useState("inbox");
  const [q, setQ] = useState("");
  const [threads, setThreads] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [reply, setReply] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const fileInputRef = useRef(null);
  const debounceRef = useRef(null);

  // Re-fetch the list whenever the folder or query (debounced) changes.
  const reload = async (f = folder, query = q) => {
    setLoading(true);
    try {
      const data = await fetchThreads(f, query);
      setThreads(data.threads || []);
      setCounts(data.counts || {});
    } catch (e) {
      toast.error("Couldn't load messages.");
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* on mount */ }, []);  // eslint-disable-line
  useEffect(() => {
    setSelected(new Set()); setOpenId(null);
    reload(folder, q);
  }, [folder]);  // eslint-disable-line
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => reload(folder, q), 300);
    return () => clearTimeout(debounceRef.current);
  }, [q]);  // eslint-disable-line

  const openThread = async (id) => {
    setOpenId(id); setMessages([]); setReply(""); setAttachments([]);
    try {
      const data = await fetchThread(id);
      setMessages(data.messages || []);
    } catch { toast.error("Couldn't open thread."); }
    // Locally clear unread on the row we just opened
    setThreads((prev) => prev.map((t) => t.id === id ? { ...t, [`unread_for_${role}`]: 0 } : t));
  };

  const toggleStar = async (id, currentlyStarred) => {
    setThreads((p) => p.map((t) => t.id === id ? { ...t, [`starred_for_${role}`]: !currentlyStarred } : t));
    try { await patchThread(id, { starred: !currentlyStarred }); }
    catch { toast.error("Couldn't update."); reload(); }
  };

  const sendReply = async () => {
    if (!openId || (!reply.trim() && attachments.length === 0)) return;
    setReplyBusy(true);
    try {
      await replyThread(openId, reply.trim(), attachments.map((a) => a.id));
      setReply(""); setAttachments([]);
      const data = await fetchThread(openId);
      setMessages(data.messages || []);
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't send reply."); }
    finally { setReplyBusy(false); }
  };

  const onPickFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !uploadAttachment) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) { toast.error(`Max ${MAX_ATTACHMENTS} photos per message.`); return; }
    if (files.length > room) toast.warning(`Only ${room} more photo${room === 1 ? "" : "s"} allowed.`);
    setAttachBusy(true);
    try {
      for (const f of files.slice(0, room)) {
        if (f.size > 10 * 1024 * 1024) { toast.error(`${f.name} is over 10 MB.`); continue; }
        const r = await uploadAttachment(f);
        setAttachments((p) => [...p, { id: r.id, filename: r.filename || f.name, url: r.url }]);
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Photo upload failed.");
    } finally { setAttachBusy(false); }
  };

  const toggleSelect = (id) => {
    setSelected((s) => {
      const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next;
    });
  };
  const selectAll = () => setSelected(new Set(threads.map((t) => t.id)));
  const clearSelection = () => setSelected(new Set());

  const bulkAction = async (patch, msg) => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await bulkPatch(ids, patch);
      toast.success(`${msg} ${ids.length}.`);
      clearSelection();
      reload();
    } catch { toast.error("Couldn't apply action."); }
  };

  const openThreadObj = useMemo(() => threads.find((t) => t.id === openId), [threads, openId]);
  const selCount = selected.size;

  return (
    <div
      className="flex border border-line bg-paper min-h-[640px] h-[calc(100vh-220px)] overflow-hidden"
      data-testid={`message-center-${role}`}
    >
      {/* ── Folder rail ── */}
      <aside className="w-44 shrink-0 border-r border-line py-3 overflow-y-auto">
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted px-4 mb-2">◆ Folders</div>
        <ul>
          {FOLDERS.map(({ id, label, Icon }) => {
            const active = folder === id;
            const count = counts[id] || 0;
            return (
              <li key={id}>
                <button
                  onClick={() => setFolder(id)}
                  data-testid={`mc-folder-${id}`}
                  className={`w-full flex items-center gap-2.5 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition ${
                    active ? "bg-brand/10 text-brand border-l-2 border-brand"
                           : "text-ink-muted hover:text-ink hover:bg-surface border-l-2 border-transparent"
                  }`}
                >
                  <Icon size={13} className="shrink-0" />
                  <span className="flex-1 text-left">{label}</span>
                  {count > 0 && <span className={`text-[9px] ${active ? "text-brand" : "text-ink-muted"}`}>{count}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* ── Thread list pane ── */}
      <section className="w-[28rem] shrink-0 border-r border-line flex flex-col">
        <div className="border-b border-line p-2.5 flex items-center gap-2">
          {selCount > 0 ? (
            <>
              <button onClick={clearSelection} className="text-ink-muted hover:text-brand" aria-label="Clear selection">✕</button>
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">{selCount} selected</span>
              <div className="flex-1" />
              <BulkBtn onClick={() => bulkAction({ starred: true }, "Starred")} title="Star">
                <Star size={13} />
              </BulkBtn>
              <BulkBtn onClick={() => bulkAction({ mark_unread: true }, "Marked unread")} title="Mark unread">
                <Mail size={13} />
              </BulkBtn>
              <BulkBtn onClick={() => bulkAction({ archived: true }, "Archived")} title="Archive">
                <Archive size={13} />
              </BulkBtn>
              <BulkBtn onClick={() => bulkAction({ trashed: true }, "Trashed")} title="Trash">
                <Trash2 size={13} />
              </BulkBtn>
            </>
          ) : (
            <>
              <Search size={14} className="text-ink-muted shrink-0 ml-1" />
              <input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search messages…"
                data-testid={`mc-search-${role}`}
                className="flex-1 bg-transparent border-none outline-none font-mono text-xs placeholder:text-ink-muted"
              />
              {threads.length > 0 && (
                <button onClick={selectAll} title="Select all"
                  className="text-ink-muted hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em]">
                  All
                </button>
              )}
              {folder === "trash" && threads.length > 0 && emptyTrash && (
                <button
                  onClick={async () => {
                    if (!window.confirm(`Permanently delete all ${threads.length} thread${threads.length === 1 ? "" : "s"} in Trash? This cannot be undone.`)) return;
                    try {
                      const r = await emptyTrash();
                      toast.success(`Trash emptied · ${r.deleted ?? 0} thread${(r.deleted ?? 0) === 1 ? "" : "s"} removed.`);
                      setOpenId(null);
                      reload();
                    } catch (e) {
                      toast.error(e?.response?.data?.detail || "Empty trash failed.");
                    }
                  }}
                  data-testid={`mc-empty-trash-${role}`}
                  title="Permanently delete every thread in Trash"
                  className="px-2.5 py-1 border border-red-500/40 text-red-600 hover:bg-red-500/10 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1.5 transition"
                >
                  <Trash2 size={11} /> Empty
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex-1 overflow-y-auto" data-testid={`mc-thread-list-${role}`}>
          {loading ? (
            <div className="p-6 font-mono text-xs text-ink-muted">Loading…</div>
          ) : threads.length === 0 ? (
            <div className="p-6 font-mono text-xs text-ink-muted">
              {folder === "inbox" ? "Nothing yet." : `No ${folder} messages.`}
            </div>
          ) : threads.map((t) => {
            const unread = (t[`unread_for_${role}`] || 0) > 0;
            const starred = !!t[`starred_for_${role}`];
            const isOpen = openId === t.id;
            const counterName = role === "maker"
              ? (t.buyer_name || t.buyer_email)
              : (t.maker_name || t.maker_slug);
            const sel = selected.has(t.id);
            return (
              <div
                key={t.id}
                onClick={() => openThread(t.id)}
                data-testid={`mc-thread-${t.id}`}
                className={`group flex items-start gap-2 px-3 py-2.5 border-b border-line cursor-pointer transition ${
                  isOpen ? "bg-brand/8" : "hover:bg-surface"
                }`}
              >
                <input
                  type="checkbox" checked={sel}
                  onClick={(e) => { e.stopPropagation(); toggleSelect(t.id); }}
                  onChange={() => {}}
                  className="mt-0.5 accent-[#ff4500]"
                />
                <button
                  onClick={(e) => { e.stopPropagation(); toggleStar(t.id, starred); }}
                  data-testid={`mc-star-${t.id}`}
                  className="mt-0.5 shrink-0"
                  title={starred ? "Unstar" : "Star"}
                >
                  <Star size={13} className={starred ? "text-brand fill-[#ff4500]" : "text-[#404040] group-hover:text-ink-muted"} />
                </button>
                {/* Avatar disc */}
                <div className="shrink-0 w-7 h-7 rounded-full bg-surface border border-line flex items-center justify-center font-mono text-[10px] text-ink-muted">
                  {initials(counterName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`truncate font-mono text-[11px] uppercase tracking-[0.18em] ${unread ? "text-white" : "text-ink-muted"}`}>
                      {counterName}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-ink-muted">
                      {t.last_message_at ? new Date(t.last_message_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
                    </span>
                  </div>
                  <div className={`truncate text-xs mt-0.5 ${unread ? "text-ink font-medium" : "text-ink-muted"}`}>
                    {t.subject || "(no subject)"}
                  </div>
                  {t.last_preview && (
                    <div className="truncate text-[11px] text-ink-muted mt-0.5">{t.last_preview}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Reader pane ── */}
      <section className="flex-1 flex flex-col">
        {!openThreadObj ? (
          <EmptyReader counterpartLabel={counterpartLabel} />
        ) : (
          <>
            <div className="border-b border-line p-3 flex items-center gap-3">
              <button onClick={() => setOpenId(null)} className="md:hidden text-ink-muted hover:text-brand" title="Back">
                <ArrowLeft size={16} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="font-display text-base uppercase truncate">{openThreadObj.subject || "(no subject)"}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted truncate">
                  {role === "maker" ? `${openThreadObj.buyer_name || openThreadObj.buyer_email}` : `${openThreadObj.maker_name || openThreadObj.maker_slug}`}
                </div>
              </div>
              <ToolBtn onClick={async () => { await patchThread(openId, { mark_unread: true }); setOpenId(null); reload(); toast.success("Marked unread."); }} title="Mark unread"><MailOpen size={14} /></ToolBtn>
              <ToolBtn onClick={async () => { await patchThread(openId, { archived: true }); setOpenId(null); reload(); toast.success("Archived."); }} title="Archive"><Archive size={14} /></ToolBtn>
              <ToolBtn onClick={async () => { await patchThread(openId, { trashed: true }); setOpenId(null); reload(); toast.success("Trashed."); }} title="Trash"><Trash2 size={14} /></ToolBtn>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="mc-reader">
              {messages.map((m) => {
                const fromMe = m.sender_type === role;
                return (
                  <div key={m.id} className={`flex ${fromMe ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-lg p-3 ${fromMe ? "bg-brand/10 border border-brand/40" : "bg-surface border border-line"}`}>
                      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted mb-1">
                        {fromMe ? "You" : (m.sender_name || m.sender_email)}
                        <span className="ml-2 text-ink-muted">
                          {m.created_at ? new Date(m.created_at).toLocaleString() : ""}
                        </span>
                      </div>
                      {m.body && (
                        <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.body}</div>
                      )}
                      {(m.attachments || []).length > 0 && (
                        <div className={`flex flex-wrap gap-2 ${m.body ? "mt-2" : ""}`}>
                          {m.attachments.map((a) => (
                            <a
                              key={a.id}
                              href={`${BACKEND}${a.url}`}
                              target="_blank" rel="noreferrer"
                              data-testid={`mc-msg-attachment-${a.id}`}
                              title={a.filename}
                            >
                              <img
                                src={`${BACKEND}${a.url}`}
                                alt={a.filename || "attachment"}
                                loading="lazy"
                                className="w-32 h-32 object-cover border border-line hover:border-brand transition"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-line p-3">
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2" data-testid="mc-attach-chips">
                  {attachments.map((a) => (
                    <div key={a.id} className="relative" data-testid={`mc-attach-chip-${a.id}`}>
                      <img
                        src={`${BACKEND}${a.url}`} alt={a.filename}
                        className="w-16 h-16 object-cover border border-line"
                      />
                      <button
                        onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))}
                        data-testid={`mc-attach-remove-${a.id}`}
                        title="Remove photo"
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-ink text-paper rounded-full flex items-center justify-center hover:bg-brand transition"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={reply} onChange={(e) => setReply(e.target.value)}
                placeholder="Write a reply…" rows={3}
                data-testid="mc-reply"
                className="w-full bg-transparent border border-line focus:border-brand outline-none p-2 font-mono text-xs resize-none"
              />
              <div className="flex justify-end items-center gap-2 mt-2">
                {uploadAttachment && (
                  <>
                    <input
                      ref={fileInputRef} type="file" multiple
                      accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
                      onChange={onPickFiles} className="hidden"
                      data-testid="mc-attach-input"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={attachBusy || attachments.length >= MAX_ATTACHMENTS}
                      data-testid="mc-attach-btn"
                      title={attachments.length >= MAX_ATTACHMENTS ? `Max ${MAX_ATTACHMENTS} photos` : "Attach photos"}
                      className="px-3 py-2 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 transition"
                    >
                      <Paperclip size={12} /> {attachBusy ? "Uploading…" : "Photo"}
                    </button>
                  </>
                )}
                <button
                  onClick={sendReply}
                  disabled={replyBusy || attachBusy || (!reply.trim() && attachments.length === 0)}
                  data-testid="mc-reply-send"
                  className="px-4 py-2 bg-brand hover:bg-brand-hover text-black font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  <Send size={12} /> {replyBusy ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function EmptyReader({ counterpartLabel }) {
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="text-center max-w-sm">
        <Inbox size={28} className="mx-auto text-[#404040] mb-3" />
        <div className="font-display text-xl uppercase mb-1">Pick a conversation</div>
        <div className="font-mono text-xs text-ink-muted leading-relaxed">
          Select a thread on the left to read messages from a {counterpartLabel.toLowerCase()} and reply.
        </div>
      </div>
    </div>
  );
}

function ToolBtn({ onClick, title, children }) {
  return (
    <button onClick={onClick} title={title}
      className="p-2 border border-line hover:border-brand hover:text-brand transition">
      {children}
    </button>
  );
}

function BulkBtn({ onClick, title, children }) {
  return (
    <button onClick={onClick} title={title}
      className="p-1.5 hover:bg-surface hover:text-brand transition rounded">
      {children}
    </button>
  );
}
