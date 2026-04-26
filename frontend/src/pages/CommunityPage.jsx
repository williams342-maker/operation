import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Heart, Download, Send, Plus, Lock } from "lucide-react";
import {
  fetchShowcase, createShowcase, likeShowcase,
  fetchDesignFiles, downloadDesignFile, unlockDownloadsCheckout, uploadDesignFile,
  fetchForumThreads, fetchForumThread, createForumThread, replyForumThread,
  deleteChatMessage, deleteForumThread, deleteForumReply,
  fetchChatHistory, wsChatUrl,
  communityMe, uploadAvatar,
  fetchProducts, fetchMakers,
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
              <AvatarPicker me={me} setMe={setMe} />
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

// ===================== AVATAR PICKER =====================
function AvatarPicker({ me, setMe }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      setErr("Max 1.5MB");
      setTimeout(() => setErr(""), 2400);
      return;
    }
    setBusy(true); setErr("");
    try {
      const r = await uploadAvatar(file);
      setMe({ ...me, picture: r.picture });
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Upload failed");
      setTimeout(() => setErr(""), 2400);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className="w-10 h-10 rounded-full border border-[#262626] hover:border-[#ff4500] overflow-hidden flex items-center justify-center bg-[#121212]"
        data-testid="avatar-upload-btn"
        title="Click to upload an avatar"
      >
        {me.picture ? (
          <img src={me.picture} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="font-mono text-[10px] uppercase text-[#a3a3a3]">
            {(me.name || me.email)[0]?.toUpperCase() || "?"}
          </span>
        )}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onPick}
        className="hidden"
        data-testid="avatar-upload-input"
      />
      {err && (
        <span className="absolute -bottom-5 right-0 font-mono text-[10px] text-red-400 whitespace-nowrap">{err}</span>
      )}
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
  const [form, setForm] = useState({ title: "", description: "", image_url: "", product_slug: "", maker_slug: "" });
  const [products, setProducts] = useState([]);
  const [makers, setMakers] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([fetchProducts(), fetchMakers()]).then(([p, m]) => {
      setProducts(p || []);
      setMakers(m || []);
    });
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      // If user picked a product, default the maker_slug to that product's maker.
      const picked = products.find((p) => p.slug === form.product_slug);
      const payload = {
        title: form.title,
        description: form.description,
        image_url: form.image_url,
        product_slug: form.product_slug || null,
        maker_slug: form.maker_slug || (picked ? picked.maker_slug : null),
      };
      await createShowcase(payload);
      onSaved();
    }
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
      <select value={form.product_slug} onChange={(e) => setForm({ ...form, product_slug: e.target.value })}
              className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
              data-testid="showcase-product">
        <option value="">— Tag a product (optional) —</option>
        {products.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}
      </select>
      <select value={form.maker_slug} onChange={(e) => setForm({ ...form, maker_slug: e.target.value })}
              className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
              data-testid="showcase-maker">
        <option value="">— Tag a maker (optional) —</option>
        {makers.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
      </select>
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
        {(post.product_slug || post.maker_slug) && (
          <div className="flex flex-wrap gap-2 mb-3" data-testid={`showcase-tags-${post.id}`}>
            {post.product_slug && (
              <Link to={`/shop/${post.product_slug}`} className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] border border-[#ff4500]/40 px-2 py-1 hover:bg-[#ff4500]/10">
                ◆ {post.product_slug}
              </Link>
            )}
            {post.maker_slug && (
              <Link to={`/makers/${post.maker_slug}`} className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] border border-[#262626] px-2 py-1 hover:border-[#ff4500] hover:text-[#ff4500]">
                @ {post.maker_slug}
              </Link>
            )}
          </div>
        )}
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
  const isMod = !!localStorage.getItem("cm_admin_jwt") || !!localStorage.getItem("cm_maker_jwt");
  const seenReplyIdsRef = useRef(new Set());
  const mentionDingRef = useRef(null);
  const refresh = () => fetchForumThread(id).then(setData);
  useEffect(() => { refresh(); }, [id]);

  // Poll for new replies every 12s so @mentions notify promptly.
  useEffect(() => {
    const t = setInterval(() => { refresh().catch(() => {}); }, 12000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const myName = (me?.name || (me?.email || "").split("@")[0] || "").toLowerCase();
  const isMention = (text) =>
    !!myName && new RegExp(`@${myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text || "");

  // Detect newly-arrived mentions and fire ding + desktop notification.
  useEffect(() => {
    if (!data) return;
    const replies = data.replies || [];
    const known = seenReplyIdsRef.current;
    if (known.size === 0) {
      // First load — seed the set without notifying.
      replies.forEach((r) => known.add(r.id));
      return;
    }
    for (const r of replies) {
      if (known.has(r.id)) continue;
      known.add(r.id);
      if (r.user_id === me?.user_id) continue;     // ignore my own posts
      if (!isMention(r.body)) continue;
      try { mentionDingRef.current?.play?.(); } catch {}
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          const n = new Notification(`@${r.user_name || r.user_email} mentioned you`, {
            body: (r.body || "").slice(0, 140),
            tag: `forum-${id}-${r.id}`,
          });
          n.onclick = () => { window.focus(); };
        } catch {}
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!data) return <p className="font-mono text-sm text-[#a3a3a3]">Loading…</p>;
  const { thread, replies } = data;
  const reply = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try { await replyForumThread(id, { body }); setBody(""); refresh(); }
    finally { setBusy(false); }
  };
  const delThread = async () => {
    if (!window.confirm("Delete this entire thread?")) return;
    await deleteForumThread(thread.id);
    onBack();
  };
  const delReply = async (rid) => {
    if (!window.confirm("Delete this reply?")) return;
    await deleteForumReply(rid);
    refresh();
  };
  return (
    <div className="space-y-6" data-testid="thread-detail">
      <button onClick={onBack} className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]" data-testid="thread-back">
        ← back to threads
      </button>
      <div className="border border-[#262626] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              ◆ {thread.tag || "general"} · started by {thread.user_name || thread.user_email}
            </div>
            <h2 className="font-display text-3xl mt-2">{thread.title}</h2>
          </div>
          {isMod && (
            <button onClick={delThread} className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 hover:text-red-200" data-testid={`thread-mod-delete-${thread.id}`}>
              ⊗ delete
            </button>
          )}
        </div>
        <p className={`font-mono text-sm leading-relaxed mt-4 whitespace-pre-wrap ${
          isMention(thread.body) ? "border-l-2 border-[#ff4500] pl-3 bg-[#ff4500]/5 text-[#e5e5e5]" : "text-[#e5e5e5]"
        }`}>{thread.body}</p>
      </div>
      {replies.map((r) => {
        const mentioned = isMention(r.body);
        return (
          <div key={r.id}
               className={`border border-[#262626] p-4 ml-6 ${mentioned ? "border-l-2 border-l-[#ff4500] bg-[#ff4500]/5" : ""}`}
               data-testid={mentioned ? "forum-reply-mentioned" : `reply-${r.id}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                {r.user_name || r.user_email}
              </div>
              {isMod && (
                <button onClick={() => delReply(r.id)} className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 hover:text-red-200" data-testid={`reply-mod-delete-${r.id}`}>
                  ⊗
                </button>
              )}
            </div>
            <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-2 whitespace-pre-wrap">{r.body}</p>
          </div>
        );
      })}
      {me && (
        <form onSubmit={reply} className="ml-6 space-y-2" data-testid="reply-form">
          <textarea required rows={3} placeholder="Reply… (use @name to mention someone)" value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
                    data-testid="reply-body" />
          <button type="submit" disabled={busy} className="btn-industrial btn-primary disabled:opacity-50" data-testid="reply-submit">
            {busy ? "Sending…" : "Reply →"}
          </button>
        </form>
      )}
      {/* High-pitch ding for @mentions in forum replies */}
      <audio
        ref={mentionDingRef}
        src="data:audio/wav;base64,UklGRl4DAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YToDAACBgIB/gH+Af4B/gH+Af4B/gH+Af4B/gH+Af4B/gH+Af4B/gH+Af4B/"
        preload="auto"
      />
    </div>
  );
}

// ===================== LIVE CHAT (AIM-style + cross-channel unread + @mentions) =====================
function ChatTab({ me }) {
  const [channel, setChannel] = useState("general");
  const [messagesByCh, setMessagesByCh] = useState({});
  const [buddiesByCh, setBuddiesByCh] = useState({});
  const [unread, setUnread] = useState({});
  const [mentions, setMentions] = useState({}); // per-channel mention count
  const [typing, setTyping] = useState([]);
  const [draft, setDraft] = useState("");
  const [muted, setMuted] = useState(false);
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const sendWsRef = useRef(null);             // active socket (for sending)
  const shadowSocketsRef = useRef({});        // { channel: ws }
  const activeChannelRef = useRef("general"); // FIX: avoid stale-closure in shadow ws handlers
  const scrollRef = useRef(null);
  const audioRef = useRef(null);
  const mentionAudioRef = useRef(null);
  const typingTimeoutRef = useRef({});
  const lastTypingSentRef = useRef(0);
  const isMaker = !!localStorage.getItem("cm_maker_jwt");
  const buyerJwt = localStorage.getItem("cm_buyer_jwt");
  const makerJwt = localStorage.getItem("cm_maker_jwt");
  const adminJwt = localStorage.getItem("cm_admin_jwt");
  const tokenForChannel = (ch) => (ch === "makers-only" ? makerJwt : (buyerJwt || makerJwt || adminJwt));
  const messages = messagesByCh[channel] || [];
  const buddies = buddiesByCh[channel] || [];
  const myName = (me?.name || (me?.email || "").split("@")[0] || "").toLowerCase();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Reset unread/mentions when entering a channel + keep ref fresh for shadow sockets
  useEffect(() => {
    activeChannelRef.current = channel;
    setUnread((u) => ({ ...u, [channel]: 0 }));
    setMentions((m) => ({ ...m, [channel]: 0 }));
    setTyping([]);
  }, [channel]);

  // Maintain shadow WS sockets to all accessible channels for unread tracking.
  useEffect(() => {
    const eligible = CHANNELS.filter((c) => !!tokenForChannel(c));
    eligible.forEach((c) => {
      if (shadowSocketsRef.current[c]) return; // already connected
      const tok = tokenForChannel(c);
      if (!tok) return;
      const ws = new WebSocket(wsChatUrl(c, tok));
      ws.onmessage = (e) => onWsMessage(c, e);
      ws.onerror = () => {};
      ws.onclose = () => {
        // Drop reference so a future channel switch can recreate it on retry.
        if (shadowSocketsRef.current[c] === ws) {
          delete shadowSocketsRef.current[c];
        }
      };
      shadowSocketsRef.current[c] = ws;
    });
    // Load history for the active channel from REST so we don't depend on shadow socket timing.
    if (tokenForChannel(channel)) {
      fetchChatHistory(channel).then((hist) =>
        setMessagesByCh((m) => ({ ...m, [channel]: hist }))
      );
    }
    return () => {
      // Tear down all shadow sockets on unmount
      Object.values(shadowSocketsRef.current).forEach((ws) => {
        try { ws.close(); } catch { /* ignore */ }
      });
      shadowSocketsRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyerJwt, makerJwt, adminJwt]);

  // Reload history when switching channel (cheap, ensures we have full backlog).
  useEffect(() => {
    if (!tokenForChannel(channel)) return;
    fetchChatHistory(channel).then((hist) =>
      setMessagesByCh((m) => ({ ...m, [channel]: hist }))
    );
    sendWsRef.current = shadowSocketsRef.current[channel] || null;
  }, [channel]);

  const isMention = (text) =>
    !!myName && new RegExp(`@${myName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);

  const onWsMessage = (ch, e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.kind === "presence") {
      setBuddiesByCh((b) => ({ ...b, [ch]: msg.buddies || [] }));
      return;
    }
    if (msg.kind === "typing") {
      // Only render typing if it's the active channel.
      if (ch !== activeChannelRef.current) return;
      setTyping((prev) => {
        const others = prev.filter((p) => p.user_email !== msg.user_email);
        return msg.is_typing ? [...others, msg] : others;
      });
      clearTimeout(typingTimeoutRef.current[msg.user_email]);
      if (msg.is_typing) {
        typingTimeoutRef.current[msg.user_email] = setTimeout(() => {
          setTyping((prev) => prev.filter((p) => p.user_email !== msg.user_email));
        }, 4000);
      }
      return;
    }
    if (msg.kind === "system" && msg.buddies) {
      setBuddiesByCh((b) => ({ ...b, [ch]: msg.buddies }));
    }
    setMessagesByCh((m) => ({ ...m, [ch]: [...(m[ch] || []), msg] }));

    if (msg.kind === "message") {
      const mine = msg.user_email && me?.email && msg.user_email === me.email;
      if (mine) return;

      const mentioned = isMention(msg.text || "");

      // Sound: mention beep if mentioned, regular beep otherwise
      if (!muted) {
        try {
          (mentioned ? mentionAudioRef.current : audioRef.current)?.play?.();
        } catch { /* ignore */ }
      }

      if (ch !== activeChannelRef.current) {
        setUnread((u) => ({ ...u, [ch]: (u[ch] || 0) + 1 }));
        if (mentioned) {
          setMentions((mm) => ({ ...mm, [ch]: (mm[ch] || 0) + 1 }));
        }
      }

      // Browser notification when tab is unfocused or message is a mention
      if (mentioned || (typeof document !== "undefined" && document.hidden)) {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            const n = new Notification(
              `${mentioned ? "💬 You were mentioned in" : "💬 New message in"} #${ch}`,
              { body: `${msg.user_name}: ${msg.text}`.slice(0, 140), tag: `cm-chat-${ch}`, icon: "/favicon.ico" }
            );
            n.onclick = () => { window.focus(); setChannel(ch); n.close(); };
          } catch { /* ignore */ }
        }
      }
    }
  };

  const requestNotifPermission = async () => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      const p = await Notification.requestPermission();
      setNotifPermission(p);
    }
  };

  const sendTyping = (isTyping) => {
    const ws = sendWsRef.current;
    if (!ws || ws.readyState !== 1) return;
    const now = Date.now();
    if (isTyping && now - lastTypingSentRef.current < 1500) return;
    lastTypingSentRef.current = now;
    ws.send(JSON.stringify({ kind: "typing", is_typing: !!isTyping }));
  };

  const send = (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    const ws = sendWsRef.current;
    if (!text || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ text }));
    setDraft("");
    sendTyping(false);
  };

  if (!tokenForChannel(channel)) {
    return (
      <p className="font-mono text-sm text-[#a3a3a3]" data-testid="chat-locked">
        Sign in to join the live chat. <Link to="/community/login" className="text-[#ff4500]">Sign in →</Link>
      </p>
    );
  }
  if (channel === "makers-only" && !isMaker) {
    return (
      <div className="space-y-4" data-testid="chat-tab">
        <ChannelSelector channel={channel} setChannel={setChannel} unread={unread} mentions={mentions} />
        <div
          className="border border-[#ff4500]/40 bg-[#ff4500]/5 p-5"
          data-testid="chat-makers-only-blocked"
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500] mb-2">◆ Makers only</div>
          <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
            This channel is restricted to verified makers. Sign in to your maker portal to join the conversation.
          </p>
          <Link to="/maker/login" className="btn-industrial btn-primary inline-flex mt-4" data-testid="chat-makers-signin-cta">
            Maker sign-in →
          </Link>
        </div>
      </div>
    );
  }

  const otherTypers = typing.filter((t) => t.user_email !== me?.email);

  return (
    <div className="space-y-4" data-testid="chat-tab">
      <audio
        ref={audioRef}
        src="data:audio/wav;base64,UklGRrICAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YY4CAACAgIB/g4WIiYqLjI6PkJGRkpKSkZGQjouHg395d3VxbWloZWNiYWBeXVtaWVlYV1ZWVldXWFlZW1xeYGFiZGZnaWttbm9wcXJzdHV2d3d4eHl6e3x9foCBg4WGiImLjI6PkJGSkpOTkpGQjouHhH96d3VybmpoZWNiYWBeXVtaWVlYV1ZWVldXWFlaW1xeYGJjZWdoamtsbW9wcXJzdHV2d3d4eHl6e3x9foCBg4WGh4mLjI6PkJGSkpOTkpGQjouHhH96d3VybmpoZWNiYWBeXVtaWVlYV1ZWVldXWFlaW1xeYGJjZWdoamtsbW9wcXJzdHV2d3d4eHl6e3x9foCBg4WGh4mLjI6PkJGSkpOTkpGQjouHhH96d3VybmpoZWNiYWBeXVtaWVlYV1ZWVldXWFlaW1xeYGJjZWdoamtsbW9wcXJzdHV2d3d4eHl6e3x9foCBg4WGh4mLjI6PkJGSkpOTkpGQ"
        preload="auto"
      />
      {/* mention beep — slightly higher pitch */}
      <audio
        ref={mentionAudioRef}
        src="data:audio/wav;base64,UklGRn4DAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVoDAACBgoKDg4SEhYWGhoeHiIiJiYqKi4uMjI2Njo6Pj5CQkZGSkpOTlJSVlZaWl5eYmJmZmpqbm5ycnZ2enp+foKChoaKio6Oko6OioqGhoKCfn56enZ2cnJubmpqZmZiYl5eWlpWVlJSTk5KSkZGQkI+Pjo6NjYyMi4uKiomJiIiHh4aGhYWEhIODgoKBgX+Af359fXx8e3t6enl5eHh3d3Z2dXV0dHNzcnJxcXBwb29ubm1tbGxra2pqaWloZ2dlZWNjYWFf"
        preload="auto"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChannelSelector channel={channel} setChannel={setChannel} unread={unread} mentions={mentions} />
        {notifPermission === "default" && (
          <button
            onClick={requestNotifPermission}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] border border-[#ff4500]/40 px-3 py-1.5 hover:bg-[#ff4500]/10"
            data-testid="chat-enable-notifs"
          >
            Enable desktop notifications →
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-12 gap-4">
        <aside className="lg:col-span-3 lg:order-2 border border-[#262626] p-3 bg-[#0a0a0a] lg:max-h-[480px] overflow-y-auto" data-testid="chat-buddies">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-3">
            ◆ Buddy list · {buddies.length}
          </div>
          <ul className="space-y-2">
            {!buddies.length && (
              <li className="font-mono text-[10px] text-[#525252]" data-testid="chat-buddies-empty">
                No one's online — start the conversation.
              </li>
            )}
            {buddies.map((b) => (
              <li key={b.user_email} className="flex items-center gap-2" data-testid={`chat-buddy-${b.user_email}`}>
                <span className={`w-2 h-2 rounded-full ${b.role === "maker" ? "bg-[#ff4500]" : "bg-emerald-400"}`} />
                {b.picture && <img src={b.picture} alt="" className="w-5 h-5 rounded-full object-cover border border-[#262626]" />}
                <span className="font-mono text-[11px] text-[#e5e5e5] truncate">{b.user_name}</span>
                {b.role === "maker" && (
                  <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#ff4500] ml-auto">M</span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-3 border-t border-[#262626]">
            <button
              onClick={() => setMuted((m) => !m)}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
              data-testid="chat-mute-toggle"
            >
              {muted ? "🔇 Sound off" : "🔔 Sound on"}
            </button>
          </div>
        </aside>

        <div className="lg:col-span-9 lg:order-1 space-y-3">
          <div ref={scrollRef} className="border border-[#262626] h-[420px] overflow-y-auto p-4 space-y-2 bg-[#0a0a0a]" data-testid="chat-stream">
            {messages.map((m, i) => (
              <ChatLine
                key={m.id || i}
                m={m}
                mentioned={m.kind === "message" && isMention(m.text || "")}
                onDelete={
                  (localStorage.getItem("cm_admin_jwt") || localStorage.getItem("cm_maker_jwt"))
                    ? async (id) => {
                        if (!id) return;
                        if (!window.confirm("Delete this message?")) return;
                        try {
                          await deleteChatMessage(id);
                          setMessagesByCh((mm) => ({
                            ...mm,
                            [channel]: (mm[channel] || []).filter((x) => x.id !== id),
                          }));
                        } catch { /* ignore */ }
                      }
                    : null
                }
              />
            ))}
          </div>

          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] h-4" data-testid="chat-typing">
            {otherTypers.length > 0 && (
              <span>
                <span className="text-[#ff4500]">●</span>{" "}
                {otherTypers.map((t) => t.user_name).join(", ")} {otherTypers.length === 1 ? "is" : "are"} typing
                <TypingDots />
              </span>
            )}
          </div>

          <form onSubmit={send} className="flex gap-2" data-testid="chat-form">
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (e.target.value) sendTyping(true);
              }}
              onBlur={() => sendTyping(false)}
              placeholder={`Message #${channel}… (use @name to mention someone)`}
              className="flex-1 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
              data-testid="chat-input"
            />
            <button type="submit" className="bg-[#ff4500] text-black px-4" data-testid="chat-send">
              <Send size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ChatLine({ m, mentioned, onDelete }) {
  if (m.kind === "system") {
    return <div className="font-mono text-[12px] text-[#525252] italic">— {m.text} —</div>;
  }
  return (
    <div
      className={`font-mono text-[12px] flex items-start gap-1 group ${mentioned ? "border-l-2 border-[#ff4500] pl-2 bg-[#ff4500]/5" : "text-[#e5e5e5]"}`}
      data-testid={mentioned ? "chat-line-mentioned" : "chat-line"}
    >
      <span className="flex-1 min-w-0">
        <span className={`font-bold ${m.role === "maker" ? "text-[#ff4500]" : "text-emerald-400"}`}>
          {m.user_name || m.user_email}
        </span>
        <span className="text-[#525252] mx-1">›</span>
        <span className="text-[#e5e5e5]">{m.text}</span>
      </span>
      {onDelete && (
        <button
          onClick={() => onDelete(m.id)}
          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-200 px-1 transition-opacity"
          aria-label="Delete (mod)"
          title="Delete (mod)"
          data-testid={`chat-mod-delete-${m.id || ""}`}
        >
          ⊗
        </button>
      )}
    </div>
  );
}

function TypingDots() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x % 3) + 1), 400);
    return () => clearInterval(t);
  }, []);
  return <span>{".".repeat(n)}</span>;
}

function ChannelSelector({ channel, setChannel, unread, mentions }) {
  return (
    <div className="flex gap-2 flex-wrap" data-testid="chat-channels">
      {CHANNELS.map((c) => {
        const cnt = unread?.[c] || 0;
        const ment = mentions?.[c] || 0;
        const showBadge = cnt > 0 && channel !== c;
        return (
          <button
            key={c}
            onClick={() => setChannel(c)}
            className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] border transition relative ${
              channel === c ? "border-[#ff4500] text-[#ff4500]" : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500]/40"
            }`}
            data-testid={`chat-channel-${c}`}
          >
            #{c}
            {showBadge && (
              <span
                className={`absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center font-mono text-[9px] ${
                  ment > 0 ? "bg-[#ff4500] text-black ring-2 ring-[#ff4500]/40" : "bg-[#ff4500] text-black"
                }`}
                data-testid={`chat-unread-${c}`}
                title={ment > 0 ? `${ment} mention${ment > 1 ? "s" : ""}` : `${cnt} new`}
              >
                {ment > 0 ? "@" : cnt}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
