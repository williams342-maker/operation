import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Heart, Download, Send, Plus, Lock } from "lucide-react";
import {
  fetchShowcase, createShowcase, likeShowcase,
  fetchDesignFiles, downloadDesignFile, unlockDownloadsCheckout, uploadDesignFile,
  fetchForumThreads, fetchForumThread, createForumThread, replyForumThread,
  fetchChatHistory, wsChatUrl,
  communityMe,
} from "../lib/api";

const TABS = [
  { id: "showcase", label: "Showcase" },
  { id: "files", label: "Design Files" },
  { id: "forum", label: "Forum" },
  { id: "chat", label: "Live Chat" },
];

const CHANNELS = ["general", "help", "showcase", "makers-only"];

export default function CommunityPage() {
  const [tab, setTab] = useState("showcase");
  const [me, setMe] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const jwt = localStorage.getItem("cm_buyer_jwt");
    if (!jwt) return;
    communityMe()
      .then(setMe)
      .catch(() => {
        localStorage.removeItem("cm_buyer_jwt");
        localStorage.removeItem("cm_buyer_email");
      });
  }, []);

  const logout = () => {
    localStorage.removeItem("cm_buyer_jwt");
    localStorage.removeItem("cm_buyer_email");
    setMe(null);
    navigate("/community/login");
  };

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="community-page">
      <div className="max-w-[1200px] mx-auto px-4 md:px-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pb-6 border-b border-[#262626] mb-10">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
              ◆ The Workshop Floor
            </div>
            <h1 className="font-display text-[44px] md:text-[80px] leading-[0.9] uppercase">
              Community.
            </h1>
            <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-lg">
              Buyers, makers, and the workshop crew — sharing pieces, swapping design files, and talking shop.
            </p>
          </div>
          {me ? (
            <div className="flex items-center gap-3">
              {me.picture ? (
                <img src={me.picture} alt="" className="w-9 h-9 rounded-full border border-[#262626]" />
              ) : null}
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                Signed in as<br /><span className="text-[#e5e5e5]">{me.email}</span>
              </div>
              <button
                onClick={logout}
                className="px-3 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em]"
                data-testid="community-logout-btn"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <Link
              to="/community/login"
              className="btn-industrial btn-primary self-start md:self-auto"
              data-testid="community-login-cta"
            >
              Sign In →
            </Link>
          )}
        </div>

        <div className="flex border-b border-[#262626] mb-8 overflow-x-auto" data-testid="community-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3 font-mono text-[11px] uppercase tracking-[0.22em] border-b-2 transition whitespace-nowrap ${
                tab === t.id ? "border-[#ff4500] text-[#ff4500]" : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5]"
              }`}
              data-testid={`community-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "showcase" && <ShowcaseTab me={me} />}
        {tab === "files" && <FilesTab me={me} />}
        {tab === "forum" && <ForumTab me={me} />}
        {tab === "chat" && <ChatTab me={me} />}
      </div>
    </div>
  );
}

// ===================== SHOWCASE =====================
function ShowcaseTab({ me }) {
  const [posts, setPosts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const refresh = () => fetchShowcase().then(setPosts);
  useEffect(() => { refresh(); }, []);
  return (
    <div data-testid="showcase-tab">
      {me && (
        <div className="mb-6 flex justify-between items-center">
          <p className="font-mono text-xs text-[#a3a3a3]">{posts.length} pieces in the wild.</p>
          <button onClick={() => setShowForm((s) => !s)} className="btn-industrial btn-primary inline-flex items-center gap-2" data-testid="showcase-new-btn">
            <Plus size={14} /> {showForm ? "Cancel" : "Post a piece"}
          </button>
        </div>
      )}
      {showForm && (
        <ShowcaseForm onSaved={() => { setShowForm(false); refresh(); }} />
      )}
      {!posts.length ? (
        <p className="font-mono text-sm text-[#a3a3a3]" data-testid="showcase-empty">No posts yet — be the first to show off your piece.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="showcase-grid">
          {posts.map((p) => (
            <ShowcaseCard key={p.id} post={p} onLike={refresh} canLike={!!me} />
          ))}
        </div>
      )}
    </div>
  );
}

function ShowcaseForm({ onSaved }) {
  const [form, setForm] = useState({ title: "", description: "", image_url: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await createShowcase(form); onSaved(); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="border border-[#262626] p-5 mb-6 grid md:grid-cols-2 gap-3" data-testid="showcase-form">
      <input required placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
             data-testid="showcase-title" />
      <input required placeholder="Image URL" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
             data-testid="showcase-image" />
      <textarea required placeholder="Tell us about it…" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
                data-testid="showcase-description" />
      <button type="submit" disabled={busy} className="btn-industrial btn-primary md:col-span-2 disabled:opacity-50" data-testid="showcase-submit">
        {busy ? "Posting…" : "Post →"}
      </button>
    </form>
  );
}

function ShowcaseCard({ post, onLike, canLike }) {
  const [liked, setLiked] = useState(false);
  return (
    <div className="border border-[#262626] hover:border-[#ff4500] transition group" data-testid={`showcase-${post.id}`}>
      <div className="aspect-[4/3] overflow-hidden bg-[#121212]">
        <img src={post.image_url} alt={post.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-700" />
      </div>
      <div className="p-4">
        <div className="font-display text-xl mb-1">{post.title}</div>
        <p className="font-mono text-[11px] text-[#a3a3a3] leading-relaxed mb-3">{post.description}</p>
        <div className="flex justify-between items-center text-[10px] font-mono uppercase tracking-[0.22em] text-[#525252]">
          <span>{post.user_name || post.user_email}</span>
          <button
            onClick={async () => { if (canLike && !liked) { await likeShowcase(post.id); setLiked(true); onLike(); } }}
            disabled={!canLike}
            className={`flex items-center gap-1 ${liked ? "text-[#ff4500]" : "hover:text-[#ff4500]"} disabled:opacity-50`}
            data-testid={`showcase-like-${post.id}`}
          >
            <Heart size={12} fill={liked ? "currentColor" : "none"} /> {post.likes + (liked ? 1 : 0)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== DESIGN FILES =====================
function FilesTab({ me }) {
  const [files, setFiles] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const isMaker = !!localStorage.getItem("cm_maker_jwt");
  const refresh = () => fetchDesignFiles().then(setFiles);
  useEffect(() => { refresh(); }, []);

  return (
    <div data-testid="files-tab">
      <div className="mb-6 flex flex-col sm:flex-row justify-between gap-3">
        <p className="font-mono text-xs text-[#a3a3a3]">
          {files.length} community files · 5 free downloads / 6 months · $5 unlocks unlimited
        </p>
        {isMaker && (
          <button onClick={() => setShowUpload((s) => !s)} className="btn-industrial btn-primary inline-flex items-center gap-2 self-start" data-testid="files-upload-btn">
            <Plus size={14} /> {showUpload ? "Cancel" : "Upload a file"}
          </button>
        )}
      </div>
      {showUpload && <FileUploadForm onSaved={() => { setShowUpload(false); refresh(); }} />}
      {!files.length ? (
        <p className="font-mono text-sm text-[#a3a3a3]" data-testid="files-empty">No design files yet — makers can upload DXF/SVG/STL files for the community.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="files-grid">
          {files.map((f) => (
            <FileCard key={f.id} file={f} canDownload={!!me} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileUploadForm({ onSaved }) {
  const [f, setF] = useState({ title: "", description: "", file_type: "DXF", download_url: "", thumbnail_url: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await uploadDesignFile(f); onSaved(); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="border border-[#262626] p-5 mb-6 grid md:grid-cols-2 gap-3" data-testid="file-upload-form">
      <input required placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}
             className="bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
             data-testid="file-title" />
      <select value={f.file_type} onChange={(e) => setF({ ...f, file_type: e.target.value })}
              className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
              data-testid="file-type">
        {["DXF", "SVG", "STL", "GLB", "OTHER"].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input required placeholder="Download URL (Dropbox/Drive/etc.)" value={f.download_url} onChange={(e) => setF({ ...f, download_url: e.target.value })}
             className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
             data-testid="file-url" />
      <input placeholder="Thumbnail URL (optional)" value={f.thumbnail_url} onChange={(e) => setF({ ...f, thumbnail_url: e.target.value })}
             className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
             data-testid="file-thumb" />
      <textarea required placeholder="What's in it?" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })}
                className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
                data-testid="file-description" />
      <button type="submit" disabled={busy} className="btn-industrial btn-primary md:col-span-2 disabled:opacity-50" data-testid="file-submit">
        {busy ? "Uploading…" : "Publish file →"}
      </button>
    </form>
  );
}

function FileCard({ file, canDownload }) {
  const [status, setStatus] = useState(null);
  const onDownload = async () => {
    if (!canDownload) return;
    try {
      const r = await downloadDesignFile(file.id);
      if (r.locked) {
        setStatus({ kind: "locked", message: r.message });
      } else {
        setStatus({ kind: "ready", url: r.url, used: r.downloads_used });
        window.open(r.url, "_blank", "noopener");
      }
    } catch { setStatus({ kind: "err" }); }
  };
  const unlock = async () => {
    const r = await unlockDownloadsCheckout();
    window.location.href = r.url;
  };
  return (
    <div className="border border-[#262626] hover:border-[#ff4500] transition p-4 flex flex-col gap-3" data-testid={`file-${file.id}`}>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">◆ {file.file_type}</span>
        <span className="font-mono text-[10px] text-[#525252]">{file.downloads} downloads</span>
      </div>
      <div className="font-display text-xl leading-tight">{file.title}</div>
      <p className="font-mono text-[11px] text-[#a3a3a3] leading-relaxed">{file.description}</p>
      <div className="font-mono text-[10px] text-[#525252] uppercase tracking-[0.22em]">by {file.maker_name}</div>
      {status?.kind === "locked" ? (
        <button onClick={unlock} className="btn-industrial btn-primary inline-flex items-center justify-center gap-2" data-testid={`file-unlock-${file.id}`}>
          <Lock size={14} /> Unlock $5 — 6 mo unlimited
        </button>
      ) : (
        <button onClick={onDownload} disabled={!canDownload}
                className="btn-industrial inline-flex items-center justify-center gap-2 border border-[#262626] hover:border-[#ff4500] disabled:opacity-50"
                data-testid={`file-download-${file.id}`}>
          <Download size={14} /> {canDownload ? "Download" : "Sign in to download"}
        </button>
      )}
      {status?.kind === "ready" && (
        <span className="font-mono text-[10px] text-[#a3a3a3]">{status.used}/5 free this window</span>
      )}
    </div>
  );
}

// ===================== FORUM =====================
function ForumTab({ me }) {
  const [threads, setThreads] = useState([]);
  const [active, setActive] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const refresh = () => fetchForumThreads().then(setThreads);
  useEffect(() => { refresh(); }, []);
  if (active) return <ThreadDetail id={active} me={me} onBack={() => { setActive(null); refresh(); }} />;
  return (
    <div data-testid="forum-tab">
      <div className="mb-6 flex justify-between items-center">
        <p className="font-mono text-xs text-[#a3a3a3]">{threads.length} active threads.</p>
        {me && (
          <button onClick={() => setShowNew((s) => !s)} className="btn-industrial btn-primary inline-flex items-center gap-2" data-testid="forum-new-btn">
            <Plus size={14} /> {showNew ? "Cancel" : "Start a thread"}
          </button>
        )}
      </div>
      {showNew && <NewThreadForm onSaved={() => { setShowNew(false); refresh(); }} />}
      {!threads.length ? (
        <p className="font-mono text-sm text-[#a3a3a3]" data-testid="forum-empty">No threads yet — start the first conversation.</p>
      ) : (
        <ul className="space-y-3" data-testid="forum-list">
          {threads.map((t) => (
            <li key={t.id} onClick={() => setActive(t.id)}
                className="border border-[#262626] hover:border-[#ff4500] p-4 cursor-pointer transition"
                data-testid={`forum-thread-${t.id}`}>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-display text-xl">{t.title}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                  {t.reply_count} replies · {t.tag || "general"}
                </span>
              </div>
              <p className="font-mono text-[11px] text-[#a3a3a3] mt-2 line-clamp-2">{t.body}</p>
              <div className="font-mono text-[10px] text-[#525252] uppercase tracking-[0.22em] mt-2">
                started by {t.user_name || t.user_email}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewThreadForm({ onSaved }) {
  const [t, setT] = useState({ title: "", body: "", tag: "general" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await createForumThread(t); onSaved(); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="border border-[#262626] p-5 mb-6 space-y-3" data-testid="thread-new-form">
      <div className="grid md:grid-cols-3 gap-3">
        <input required placeholder="Title" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })}
               className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
               data-testid="thread-title" />
        <select value={t.tag} onChange={(e) => setT({ ...t, tag: e.target.value })}
                className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
                data-testid="thread-tag">
          {["general", "makers", "help", "showcase"].map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <textarea required rows={4} placeholder="What do you want to talk about?" value={t.body}
                onChange={(e) => setT({ ...t, body: e.target.value })}
                className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
                data-testid="thread-body" />
      <button type="submit" disabled={busy} className="btn-industrial btn-primary disabled:opacity-50" data-testid="thread-submit">
        {busy ? "Posting…" : "Post thread →"}
      </button>
    </form>
  );
}

function ThreadDetail({ id, me, onBack }) {
  const [data, setData] = useState(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => fetchForumThread(id).then(setData);
  useEffect(() => { refresh(); }, [id]);
  if (!data) return <p className="font-mono text-sm text-[#a3a3a3]">Loading…</p>;
  const { thread, replies } = data;
  const reply = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try { await replyForumThread(id, { body }); setBody(""); refresh(); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-6" data-testid="thread-detail">
      <button onClick={onBack} className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]" data-testid="thread-back">
        ← back to threads
      </button>
      <div className="border border-[#262626] p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          ◆ {thread.tag || "general"} · started by {thread.user_name || thread.user_email}
        </div>
        <h2 className="font-display text-3xl mt-2">{thread.title}</h2>
        <p className="font-mono text-sm text-[#e5e5e5] leading-relaxed mt-4 whitespace-pre-wrap">{thread.body}</p>
      </div>
      {replies.map((r) => (
        <div key={r.id} className="border border-[#262626] p-4 ml-6" data-testid={`reply-${r.id}`}>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            {r.user_name || r.user_email}
          </div>
          <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-2 whitespace-pre-wrap">{r.body}</p>
        </div>
      ))}
      {me && (
        <form onSubmit={reply} className="ml-6 space-y-2" data-testid="reply-form">
          <textarea required rows={3} placeholder="Reply…" value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
                    data-testid="reply-body" />
          <button type="submit" disabled={busy} className="btn-industrial btn-primary disabled:opacity-50" data-testid="reply-submit">
            {busy ? "Sending…" : "Reply →"}
          </button>
        </form>
      )}
    </div>
  );
}

// ===================== LIVE CHAT =====================
function ChatTab({ me }) {
  const [channel, setChannel] = useState("general");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const isMaker = !!localStorage.getItem("cm_maker_jwt");
  const buyerJwt = localStorage.getItem("cm_buyer_jwt");
  const makerJwt = localStorage.getItem("cm_maker_jwt");
  const adminJwt = localStorage.getItem("cm_admin_jwt");
  const token = channel === "makers-only" ? makerJwt : (buyerJwt || makerJwt || adminJwt);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    setMessages([]);
    if (!token) return;
    let alive = true;
    fetchChatHistory(channel).then((hist) => { if (alive) setMessages(hist); });
    const ws = new WebSocket(wsChatUrl(channel, token));
    ws.onmessage = (e) => {
      try { setMessages((m) => [...m, JSON.parse(e.data)]); } catch { /* ignore */ }
    };
    ws.onerror = () => {};
    wsRef.current = ws;
    return () => { alive = false; try { ws.close(); } catch {} };
  }, [channel, token]);

  const send = (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ text }));
    setDraft("");
  };

  if (!token) {
    return (
      <p className="font-mono text-sm text-[#a3a3a3]" data-testid="chat-locked">
        Sign in to join the live chat. <Link to="/community/login" className="text-[#ff4500]">Sign in →</Link>
      </p>
    );
  }
  if (channel === "makers-only" && !isMaker) {
    return (
      <div className="space-y-4" data-testid="chat-tab">
        <ChannelSelector channel={channel} setChannel={setChannel} />
        <div
          className="border border-[#ff4500]/40 bg-[#ff4500]/5 p-5"
          data-testid="chat-makers-only-blocked"
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500] mb-2">
            ◆ Makers only
          </div>
          <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
            This channel is restricted to verified makers. Sign in to your maker portal to join the conversation.
          </p>
          <Link
            to="/maker/login"
            className="btn-industrial btn-primary inline-flex mt-4"
            data-testid="chat-makers-signin-cta"
          >
            Maker sign-in →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="chat-tab">
      <ChannelSelector channel={channel} setChannel={setChannel} />
      <div ref={scrollRef} className="border border-[#262626] h-[420px] overflow-y-auto p-4 space-y-2 bg-[#0a0a0a]" data-testid="chat-stream">
        {messages.map((m, i) => (
          <div key={m.id || i} className={`font-mono text-[12px] ${m.kind === "system" ? "text-[#525252] italic" : "text-[#e5e5e5]"}`}>
            {m.kind === "system" ? (
              <span>— {m.text} —</span>
            ) : (
              <span><span className="text-[#ff4500]">{m.user_name || m.user_email}:</span> {m.text}</span>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2" data-testid="chat-form">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Message #${channel}…`}
               className="flex-1 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
               data-testid="chat-input" />
        <button type="submit" className="bg-[#ff4500] text-black px-4" data-testid="chat-send"><Send size={16} /></button>
      </form>
    </div>
  );
}

function ChannelSelector({ channel, setChannel }) {
  return (
    <div className="flex gap-2 flex-wrap" data-testid="chat-channels">
      {CHANNELS.map((c) => (
        <button
          key={c}
          onClick={() => setChannel(c)}
          className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] border transition ${
            channel === c ? "border-[#ff4500] text-[#ff4500]" : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500]/40"
          }`}
          data-testid={`chat-channel-${c}`}
        >
          #{c}
        </button>
      ))}
    </div>
  );
}
