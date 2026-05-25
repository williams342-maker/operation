import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Heart, Download, Send, Plus, Lock, Flag, Sparkles, Trophy, Pencil, Trash2, X as XIcon, TrendingUp, Eye, Share2, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  fetchShowcase, createShowcase, likeShowcase,
  editShowcase, deleteShowcase,
  fetchShowcaseReportReasons, reportShowcase,
  fetchDesignFiles, fetchDesignFilesLeaderboard, fetchTrendingDesignFiles, downloadDesignFile, unlockDownloadsCheckout, uploadDesignFile, uploadDesignFileDirect,
  addDesignFileVariants, deleteDesignFileVariant, updateDesignFile,
  reportDesignFile, convertDxfToSvg, renderStlThumbnail,
  fetchForumThreads, fetchForumThread, fetchForumCategories,
  createForumThread, replyForumThread, uploadForumAttachment,
  uploadShowcaseImage, uploadShowcaseVideo, aiDescribeShowcase,
  deleteChatMessage, deleteForumThread, deleteForumReply,
  fetchChatHistory, wsChatUrl,
  communityMe, uploadAvatar,
  fetchProducts, fetchMakers,
} from "../lib/api";
import { useSiteSettings } from "../hooks/useSiteSettings";
import { Film } from "lucide-react";
import QualityBadge from "../components/QualityBadge";
import AuthorLabel from "../components/AuthorLabel";
import SectionErrorBoundary from "../components/SectionErrorBoundary";
import { useConfirm } from "../hooks/useConfirm";

const TABS = [
  { id: "showcase", label: "Showcase" },
  { id: "files", label: "Design Files" },
  { id: "forum", label: "Forum" },
  { id: "chat", label: "Live Chat" },
];

const CHANNELS = [
  "general",
  "machine-help",
  "finishing-tips",
  "beginners",
  "advanced-cnc",
  "off-topic",
  "makers-only",
];

const CHANNEL_LABEL = {
  "general": "General",
  "machine-help": "Machine Help",
  "finishing-tips": "Finishing Tips",
  "beginners": "Beginners",
  "advanced-cnc": "Advanced CNC",
  "off-topic": "Off Topic",
  "makers-only": "Makers Only",
};

export default function CommunityPage() {
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      // Honor `?channel=...` deep-link from the floating LiveChatWidget.
      if (sp.get("channel")) return "chat";
      // Honor `?tab=forum` (from homepage TrendingForumStrip) and any
      // explicit `?tab=` value pointing at a known tab.
      const t = sp.get("tab");
      if (["showcase", "files", "forum", "chat"].includes(t)) return t;
    }
    return "showcase";
  });
  const [me, setMe] = useState(null);
  const navigate = useNavigate();
  const settings = useSiteSettings();
  const liveChatEnabled = !settings || settings.live_chat_enabled !== false;

  // Reset scroll on tab switch (showcase ↔ threads ↔ files ↔ live).
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [tab]);

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
          {TABS.filter((t) => t.id !== "chat" || liveChatEnabled).map((t) => (
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
        {tab === "chat" && liveChatEnabled && <ChatTab me={me} />}
        {tab === "chat" && !liveChatEnabled && (
          <div className="border border-[#262626] p-8 text-center" data-testid="chat-disabled">
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">◆ Chat Offline</div>
            <p className="font-mono text-sm text-[#a3a3a3]">
              Live chat is temporarily disabled by the workshop crew. Forum threads still work and are a great place to ask questions.
            </p>
          </div>
        )}
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

  // Deep-link to a specific showcase via `#showcase-<id>` (used by share
  // links). Scrolls to + highlights the target card once posts arrive.
  useEffect(() => {
    if (!posts.length) return;
    const hash = window.location.hash;
    const match = hash.match(/^#showcase-([0-9a-f-]{8,})/i);
    if (!match) return;
    const targetId = `showcase-${match[1]}`;
    // Defer to next tick so the DOM has the new cards mounted.
    setTimeout(() => {
      const el = document.getElementById(targetId);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Pulse-highlight so the visitor sees which card the link landed on
      el.classList.add("ring-2", "ring-[#ff4500]");
      setTimeout(() => el.classList.remove("ring-2", "ring-[#ff4500]"), 2400);
    }, 100);
  }, [posts]);
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
            <ShowcaseCard
              key={p.id} post={p}
              onLike={refresh} canLike={!!me}
              me={me}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// iter114 — Multi-image showcase form with AI description help.
// Replaces the original single-URL paste with:
//   • A real file picker (up to 8 images, each ≤ 8MB) that uploads to R2
//     incrementally with a per-image progress chip.
//   • A "✨ Help me write this" button that asks Claude to draft the
//     description from the title + tagged product/maker context.
const SHOWCASE_MAX_IMAGES = 8;
const SHOWCASE_MAX_BYTES_PER_FILE = 8 * 1024 * 1024;
// Maker-only video clips on showcase (this iter).
const SHOWCASE_MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const SHOWCASE_ALLOWED_VIDEO_TYPES = [
  "video/mp4", "video/webm", "video/quicktime", "video/x-m4v",
];

function ShowcaseForm({ onSaved }) {
  const [form, setForm] = useState({ title: "", description: "", product_slug: "", maker_slug: "" });
  const [images, setImages] = useState([]); // [{url, name}]
  const [video, setVideo] = useState(null); // {url, name, size, mime} | null
  const [uploading, setUploading] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [products, setProducts] = useState([]);
  const [makers, setMakers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  // Maker mode unlocks the video uploader. We detect via the maker JWT in
  // localStorage — the same key the maker dashboard uses. Buyers see the
  // form unchanged.
  const isMaker = typeof window !== "undefined"
    && !!localStorage.getItem("cm_maker_jwt");
  // iter115 — surface whether the AI actually looked at the photos so
  // buyers see the difference between "described from title alone" and
  // "described from your actual uploads."
  const [aiVisionMeta, setAiVisionMeta] = useState(null);
  const [err, setErr] = useState("");
  const inputRef = React.useRef(null);
  const videoInputRef = React.useRef(null);

  useEffect(() => {
    Promise.all([fetchProducts(), fetchMakers()]).then(([p, m]) => {
      setProducts(p || []);
      setMakers(m || []);
    });
  }, []);

  const onPickImages = async (e) => {
    setErr("");
    const fl = Array.from(e.target.files || []);
    if (!fl.length) return;
    const room = SHOWCASE_MAX_IMAGES - images.length;
    if (fl.length > room) {
      setErr(`Up to ${SHOWCASE_MAX_IMAGES} photos per post — you have ${images.length} already.`);
      e.target.value = "";
      return;
    }
    for (const file of fl) {
      if (!file.type.startsWith("image/")) {
        setErr(`'${file.name}' isn't an image — pick JPG/PNG/WebP.`);
        e.target.value = "";
        return;
      }
      if (file.size > SHOWCASE_MAX_BYTES_PER_FILE) {
        setErr(`'${file.name}' is ${(file.size / 1024 / 1024).toFixed(1)}MB — must be ≤ 8MB.`);
        e.target.value = "";
        return;
      }
    }
    setUploading(true);
    try {
      // Upload sequentially to keep progress legible. Concurrency would
      // shave a few hundred ms but 8 images × ~500ms is fine and the
      // serialized error path is simpler to reason about.
      for (const file of fl) {
        const r = await uploadShowcaseImage(file);
        setImages((cur) => [...cur, { url: r.url, name: r.filename || file.name }]);
      }
    } catch (uploadErr) {
      setErr(uploadErr?.response?.data?.detail || "Upload failed.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removeImage = (i) => setImages((cur) => cur.filter((_, idx) => idx !== i));

  const onPickVideo = async (e) => {
    setErr("");
    const file = e.target.files?.[0];
    if (!file) return;
    if (!SHOWCASE_ALLOWED_VIDEO_TYPES.includes(file.type) && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
      setErr(`'${file.name}' isn't a supported clip — use MP4, WebM, or MOV.`);
      e.target.value = "";
      return;
    }
    if (file.size > SHOWCASE_MAX_VIDEO_BYTES) {
      setErr(`Clip is ${(file.size / 1024 / 1024).toFixed(1)}MB — must be ≤ 50MB. Trim it in CapCut / Premiere Rush first.`);
      e.target.value = "";
      return;
    }
    setVideoUploading(true);
    setVideoProgress(0);
    try {
      const r = await uploadShowcaseVideo(file, { onProgress: setVideoProgress });
      setVideo({ url: r.url, name: r.filename || file.name, size: r.size, mime: r.mime });
    } catch (uploadErr) {
      setErr(uploadErr?.response?.data?.detail || "Video upload failed.");
    } finally {
      setVideoUploading(false);
      e.target.value = "";
    }
  };
  const removeVideo = () => { setVideo(null); setVideoProgress(0); };

  const runAiDescribe = async () => {
    if (!form.title.trim()) {
      setErr("Add a title first — the AI uses it to write the description.");
      return;
    }
    setAiBusy(true);
    setErr("");
    setAiVisionMeta(null);
    try {
      const r = await aiDescribeShowcase({
        title: form.title.trim(),
        image_urls: images.map((i) => i.url),
        product_slug: form.product_slug || null,
        maker_slug: form.maker_slug || null,
      });
      if (r.description) {
        setForm((c) => ({ ...c, description: r.description }));
        setAiVisionMeta({ vision: !!r.vision_used, count: r.images_seen || 0 });
      } else {
        setErr("AI couldn't generate a description right now — write your own and try again later.");
      }
    } catch (aiErr) {
      setErr(aiErr?.response?.data?.detail || "AI generation failed.");
    } finally {
      setAiBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!images.length && !video) {
      setErr(isMaker
        ? "Upload at least one photo or a video clip of the piece."
        : "Upload at least one photo of the piece.");
      return;
    }
    setBusy(true);
    try {
      const picked = products.find((p) => p.slug === form.product_slug);
      const payload = {
        title: form.title,
        description: form.description,
        image_urls: images.map((i) => i.url),
        image_url: images[0]?.url || null,
        video_url: video?.url || null,
        product_slug: form.product_slug || null,
        maker_slug: form.maker_slug || (picked ? picked.maker_slug : null),
      };
      await createShowcase(payload);
      onSaved();
    } catch (subErr) {
      setErr(subErr?.response?.data?.detail || "Could not post.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="border border-[#262626] p-5 mb-6 grid md:grid-cols-2 gap-3" data-testid="showcase-form">
      <input
        required placeholder="Title" value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
        data-testid="showcase-title"
      />

      {/* Multi-image picker */}
      <div className="md:col-span-2 border border-dashed border-[#262626] p-4" data-testid="showcase-image-picker">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || images.length >= SHOWCASE_MAX_IMAGES}
            className="btn-industrial btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="showcase-image-add"
          >
            <Plus size={14} />
            {images.length === 0 ? "Add photos" : `Add more (${images.length}/${SHOWCASE_MAX_IMAGES})`}
          </button>
          <p className="font-mono text-[10px] text-[#525252]">
            JPG/PNG/WebP, ≤ 8MB each. First photo becomes the cover.
          </p>
          <input
            ref={inputRef} type="file" accept="image/*" multiple onChange={onPickImages}
            className="hidden" data-testid="showcase-image-input"
          />
        </div>
        {uploading && (
          <p className="font-mono text-[10px] text-[#ff4500] mb-2" data-testid="showcase-image-uploading">
            Uploading…
          </p>
        )}
        {images.length > 0 && (
          <div className="grid grid-cols-4 gap-2" data-testid="showcase-image-list">
            {images.map((img, i) => (
              <div
                key={img.url} className="relative group border border-[#262626]"
                data-testid={`showcase-image-tile-${i}`}
              >
                <img src={img.url} alt={img.name} className="w-full aspect-square object-cover" />
                {i === 0 && (
                  <span className="absolute top-1 left-1 bg-[#ff4500] text-[#0a0a0a] font-mono text-[8px] uppercase tracking-[0.18em] px-1.5 py-0.5 font-bold">
                    Cover
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute top-1 right-1 bg-[#0a0a0a]/80 text-[#a3a3a3] hover:text-red-400 w-6 h-6 inline-flex items-center justify-center font-mono text-xs border border-[#262626]"
                  aria-label={`Remove photo ${i + 1}`}
                  data-testid={`showcase-image-remove-${i}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Maker-only video picker (this iter) */}
      {isMaker && (
        <div className="md:col-span-2 border border-dashed border-[#262626] p-4" data-testid="showcase-video-picker">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              disabled={videoUploading || !!video}
              className="btn-industrial btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="showcase-video-add"
            >
              <Film size={14} />
              {video ? "Clip attached" : "Add video clip"}
            </button>
            <p className="font-mono text-[10px] text-[#525252]">
              MP4 / WebM / MOV · ≤ 50MB · ~60s. Maker-only feature.
            </p>
            <input
              ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/x-m4v"
              onChange={onPickVideo} className="hidden" data-testid="showcase-video-input"
            />
          </div>
          {videoUploading && (
            <p className="font-mono text-[10px] text-[#ff4500] mb-2" data-testid="showcase-video-uploading">
              Uploading… {videoProgress}%
            </p>
          )}
          {video && !videoUploading && (
            <div className="relative border border-[#262626] bg-black" data-testid="showcase-video-preview">
              <video
                src={video.url}
                controls
                preload="metadata"
                className="w-full max-h-72 object-contain"
              />
              <div className="flex items-center justify-between px-3 py-2 border-t border-[#262626]">
                <span className="font-mono text-[10px] text-[#a3a3a3] truncate">
                  ◆ {video.name} · {(video.size / 1024 / 1024).toFixed(1)}MB
                </span>
                <button
                  type="button"
                  onClick={removeVideo}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#a3a3a3] hover:text-red-400"
                  data-testid="showcase-video-remove"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <select
        value={form.product_slug} onChange={(e) => setForm({ ...form, product_slug: e.target.value })}
        className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
        data-testid="showcase-product"
      >
        <option value="">— Tag a product (optional) —</option>
        {products.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}
      </select>
      <select
        value={form.maker_slug} onChange={(e) => setForm({ ...form, maker_slug: e.target.value })}
        className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
        data-testid="showcase-maker"
      >
        <option value="">— Tag a maker (optional) —</option>
        {makers.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
      </select>

      {/* Description + AI assist */}
      <div className="md:col-span-2">
        <div className="flex items-center justify-between mb-1">
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            Tell us about it
          </label>
          <button
            type="button"
            onClick={runAiDescribe}
            disabled={aiBusy || !form.title.trim()}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] hover:text-[#e5e5e5] disabled:opacity-40 disabled:cursor-not-allowed transition"
            data-testid="showcase-ai-describe"
            title={form.title.trim() ? "Let AI draft a description from your title and tags" : "Add a title first"}
          >
            {aiBusy ? "✨ Writing…" : "✨ Help me write this"}
          </button>
        </div>
        <textarea
          required placeholder="What stands out, where it lives, why you love it…"
          rows={3} value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
          data-testid="showcase-description"
        />
        {aiVisionMeta && (
          <p
            className="font-mono text-[10px] text-[#525252] mt-1"
            data-testid="showcase-ai-vision-badge"
          >
            {aiVisionMeta.vision
              ? `✨ AI read ${aiVisionMeta.count} of your photo${aiVisionMeta.count === 1 ? "" : "s"} — edit freely.`
              : "◆ AI wrote this from your title and tags. Add photos and re-run for a sharper draft."}
          </p>
        )}
      </div>

      {err && (
        <div
          ref={(node) => {
            // Scroll the error into view so users on long forms aren't
            // left wondering why their click did nothing. Soft scroll
            // (no jump) and only when freshly rendered.
            if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          className="md:col-span-2 border border-red-500/60 bg-red-500/10 px-4 py-3"
          role="alert"
          data-testid="showcase-form-error"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 mb-1">
            ◆ Couldn't post
          </p>
          <p className="font-mono text-xs text-red-200 leading-relaxed">{err}</p>
        </div>
      )}

      <button
        type="submit" disabled={busy || uploading || videoUploading || (images.length === 0 && !video)}
        className="btn-industrial btn-primary md:col-span-2 disabled:opacity-50"
        data-testid="showcase-submit"
      >
        {busy ? "Posting…" : "Post →"}
      </button>
    </form>
  );
}

function ShowcaseCard({ post, onLike, canLike, me, onChanged }) {
  const [liked, setLiked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: post.title || "",
    description: post.description || "",
  });
  const [busy, setBusy] = useState(false);
  const [editErr, setEditErr] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  // Local view counter — starts from the server number and only bumps
  // when the visitor's own view actually counted (avoids visual lies).
  const [views, setViews] = useState(post.views || 0);
  const [shareOpen, setShareOpen] = useState(false);
  const cardRef = useRef(null);

  // ---- View tracking ----
  // Fire one view-mark per (post, visitor session). Uses
  // IntersectionObserver so cards count only when the user actually
  // looks at them (≥40% visible for ≥1s) — not when they scroll past.
  useEffect(() => {
    const sessionKey = `cm_showcase_view_${post.id}`;
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(sessionKey)) return;
    const node = cardRef.current;
    if (!node || !("IntersectionObserver" in window)) return;

    // Stable anonymous client id — persists across page loads but is
    // distinct per browser. Matches the server-side dedupe key.
    let clientId = localStorage.getItem("cm_anon_id");
    if (!clientId) {
      clientId = (crypto?.randomUUID?.() || `anon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      localStorage.setItem("cm_anon_id", clientId);
    }

    let dwellTimer = null;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.4) {
            if (dwellTimer) return;
            dwellTimer = setTimeout(async () => {
              try {
                const r = await markShowcaseViewed(post.id, clientId);
                sessionStorage.setItem(sessionKey, "1");
                if (r?.counted) setViews(r.views);
                obs.disconnect();
              } catch {
                // Network errors are not retried — view counts are nice
                // to have, not essential. Avoid log spam.
              }
            }, 1000);
          } else if (dwellTimer) {
            clearTimeout(dwellTimer);
            dwellTimer = null;
          }
        });
      },
      { threshold: [0, 0.4, 0.8] },
    );
    obs.observe(node);
    return () => {
      if (dwellTimer) clearTimeout(dwellTimer);
      obs.disconnect();
    };
  }, [post.id]);

  // Owner detection — mirrors the backend `_is_showcase_owner` rule.
  // Maker posts are stamped with `user_id = "maker:<slug>"`; buyer
  // posts use the community `user_id` directly. We compare against the
  // currently-signed-in identity (maker JWT preferred — a maker on
  // both JWTs is "the maker" for their own posts).
  const isOwner = (() => {
    if (post.user_role === "maker" && typeof window !== "undefined") {
      const makerJwt = localStorage.getItem("cm_maker_jwt");
      if (makerJwt) {
        try {
          const payload = JSON.parse(atob(makerJwt.split(".")[1]));
          if (payload.role === "maker" && `maker:${payload.sub}` === post.user_id) {
            return true;
          }
        } catch (_) { /* ignore */ }
      }
      return false;
    }
    return !!me && me.user_id === post.user_id;
  })();

  const imageUrls = (post.image_urls && post.image_urls.length > 0)
    ? post.image_urls
    : (post.image_url ? [post.image_url] : []);
  const cover = imageUrls[0];
  const extraCount = Math.max(0, imageUrls.length - 1);
  const hasVideo = !!post.video_url;

  const saveEdit = async () => {
    setEditErr("");
    const title = draft.title.trim();
    const description = draft.description.trim();
    if (!title) { setEditErr("Title is required."); return; }
    if (!description) { setEditErr("Description is required."); return; }
    setBusy(true);
    try {
      await editShowcase(post.id, { title, description });
      setEditing(false);
      onChanged && onChanged();
      toast.success("Post updated.");
    } catch (e) {
      setEditErr(e?.response?.data?.detail || "Couldn't save changes.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    setBusy(true);
    try {
      await deleteShowcase(post.id);
      onChanged && onChanged();
      toast.success("Post deleted.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't delete.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={cardRef}
      id={`showcase-${post.id}`}
      className="border border-[#262626] hover:border-[#ff4500] transition group"
      data-testid={`showcase-${post.id}`}
    >
      <div className="aspect-[4/3] overflow-hidden bg-[#121212] relative">
        {hasVideo ? (
          <video
            src={post.video_url}
            poster={cover || undefined}
            controls
            playsInline
            preload="metadata"
            className="w-full h-full object-cover bg-black"
            data-testid={`showcase-${post.id}-video`}
          />
        ) : (
          cover && (
            <img src={cover} alt={post.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-700" />
          )
        )}
        {hasVideo && (
          <span
            className="absolute top-2 left-2 bg-[#ff4500] text-[#0a0a0a] font-mono text-[9px] uppercase tracking-[0.18em] px-2 py-1 font-bold pointer-events-none"
            data-testid={`showcase-${post.id}-video-badge`}
          >
            ◆ Video
          </span>
        )}
        {!hasVideo && extraCount > 0 && (
          <span
            className="absolute bottom-2 right-2 bg-[#0a0a0a]/85 border border-[#262626] text-[#e5e5e5] font-mono text-[10px] uppercase tracking-[0.18em] px-2 py-1"
            data-testid={`showcase-${post.id}-image-count`}
          >
            +{extraCount} more
          </span>
        )}
        {/* Featured badge for admin-promoted posts */}
        {post.mod_status === "featured" && (
          <span
            className="absolute top-2 right-2 bg-yellow-500 text-[#0a0a0a] font-mono text-[9px] uppercase tracking-[0.18em] px-2 py-1 font-bold pointer-events-none"
            data-testid={`showcase-${post.id}-featured`}
          >
            ★ Featured
          </span>
        )}
      </div>
      <div className="p-4">
        {editing ? (
          <div className="space-y-2" data-testid={`showcase-${post.id}-edit`}>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
              data-testid={`showcase-${post.id}-edit-title`}
            />
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
              data-testid={`showcase-${post.id}-edit-description`}
            />
            {editErr && (
              <p className="font-mono text-[10px] text-red-400" data-testid={`showcase-${post.id}-edit-error`}>
                {editErr}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={saveEdit}
                disabled={busy}
                className="btn-industrial btn-primary text-[10px] px-3 py-2 disabled:opacity-50"
                data-testid={`showcase-${post.id}-edit-save`}
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setEditing(false); setDraft({ title: post.title, description: post.description }); }}
                disabled={busy}
                className="btn-industrial btn-secondary text-[10px] px-3 py-2 disabled:opacity-50"
                data-testid={`showcase-${post.id}-edit-cancel`}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
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
              <span><AuthorLabel name={post.user_name} email={post.user_email} /></span>
              <div className="flex items-center gap-3">
                <span
                  className="flex items-center gap-1 text-[#737373]"
                  title={`${views} ${views === 1 ? "view" : "views"} in the last 24h window`}
                  data-testid={`showcase-${post.id}-views`}
                >
                  <Eye size={12} /> {views}
                </span>
                <button
                  onClick={() => setShareOpen(true)}
                  className="flex items-center gap-1 text-[#525252] hover:text-[#ff4500] transition"
                  title="Share this piece"
                  data-testid={`showcase-${post.id}-share-btn`}
                >
                  <Share2 size={11} /> Share
                </button>
                {!isOwner && (canLike || (typeof window !== "undefined" && localStorage.getItem("cm_maker_jwt"))) && (
                  <button
                    onClick={() => setReportOpen(true)}
                    className="flex items-center gap-1 text-[#525252] hover:text-red-400"
                    title="Report this post"
                    data-testid={`showcase-${post.id}-report-btn`}
                  >
                    <Flag size={11} /> Report
                  </button>
                )}
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
            {isOwner && (
              <div className="flex gap-3 mt-3 pt-3 border-t border-[#262626]" data-testid={`showcase-${post.id}-owner-controls`}>
                <button
                  onClick={() => setEditing(true)}
                  className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] flex items-center gap-1"
                  data-testid={`showcase-${post.id}-edit-btn`}
                >
                  <Pencil size={11} /> Edit
                </button>
                <button
                  onClick={handleDelete}
                  disabled={busy}
                  className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-red-400 flex items-center gap-1 disabled:opacity-50"
                  data-testid={`showcase-${post.id}-delete-btn`}
                >
                  <Trash2 size={11} /> Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {reportOpen && (
        <ShowcaseReportDialog
          post={post}
          onClose={() => setReportOpen(false)}
          onSubmitted={() => { setReportOpen(false); onChanged && onChanged(); }}
        />
      )}
      {shareOpen && (
        <ShowcaseShareDialog post={post} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}


/** Social-share modal for a showcase post. Pre-fills each platform's
 *  composer with a deep-link to the post (`/community#showcase-<id>`),
 *  the title, and a short value-prop line. Uses native share sheet on
 *  mobile when available. */
function ShowcaseShareDialog({ post, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/community#showcase-${post.id}`;
  // Prefer a richer message when the post is product-linked. Falls
  // back to maker-tagged or generic copy.
  const baseText = post.product_slug
    ? `Check out "${post.title}" — made by a Crafters Market maker. Buy it: ${window.location.origin}/shop/${post.product_slug}`
    : `Check out "${post.title}" on Crafters Market.`;
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(baseText);
  const pinImage = encodeURIComponent(
    post.image_urls?.[0] || post.image_url || "",
  );
  const pinDesc = encodeURIComponent(
    `${post.title} — ${post.description?.slice(0, 220) || "From the Crafters Market community."}`,
  );

  const links = [
    {
      key: "x",
      label: "X / Twitter",
      href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    },
    {
      key: "facebook",
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`,
    },
    {
      key: "pinterest",
      label: "Pinterest",
      href: pinImage
        ? `https://pinterest.com/pin/create/button/?url=${encodedUrl}&media=${pinImage}&description=${pinDesc}`
        : `https://pinterest.com/pin/create/button/?url=${encodedUrl}&description=${pinDesc}`,
    },
    {
      key: "reddit",
      label: "Reddit",
      href: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodeURIComponent(post.title)}`,
    },
    {
      key: "email",
      label: "Email",
      href: `mailto:?subject=${encodeURIComponent(post.title)}&body=${encodedText}%20${encodedUrl}`,
    },
  ];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — long-press to copy manually.");
    }
  };

  const tryNative = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({ title: post.title, text: baseText, url });
      onClose();
    } catch {/* user canceled or blocked */}
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid={`showcase-share-dialog-${post.id}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0a0a0a] border border-[#262626] w-full max-w-md p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl uppercase">Share this piece.</h3>
          <button
            onClick={onClose}
            className="text-[#737373] hover:text-[#e5e5e5]"
            data-testid={`showcase-share-close-${post.id}`}
            aria-label="Close share dialog"
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* URL preview + copy */}
        <div className="bg-[#0d0d0d] border border-[#1f1f1f] p-3 flex items-center gap-2">
          <div className="flex-1 font-mono text-[11px] text-[#e5e5e5] break-all">{url}</div>
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition inline-flex items-center gap-1.5"
            data-testid={`showcase-share-copy-${post.id}`}
          >
            <Copy size={11} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {/* Native share sheet (mobile) */}
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button
            onClick={tryNative}
            className="w-full btn-industrial btn-primary text-xs"
            data-testid={`showcase-share-native-${post.id}`}
          >
            ↗ Use device share sheet
          </button>
        )}

        {/* Per-platform links */}
        <div className="grid grid-cols-2 gap-2">
          {links.map((l) => (
            <a
              key={l.key}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] text-center transition"
              data-testid={`showcase-share-${l.key}-${post.id}`}
            >
              {l.label}
            </a>
          ))}
        </div>

        <p className="font-mono text-[10px] text-[#525252] leading-relaxed">
          {post.product_slug
            ? "Pinterest pins and X posts will preview the linked product."
            : "Add a product tag when posting to make shares link buyers straight to the shop."}
        </p>
      </div>
    </div>
  );
}
function ShowcaseReportDialog({ post, onClose, onSubmitted }) {
  const [reasons, setReasons] = useState([]);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetchShowcaseReportReasons()
      .then((d) => setReasons(d.reasons || []))
      .catch(() => setReasons([
        // Network fail-safe fallback. Backend remains source of truth.
        { id: "spam", label: "Spam or self-promotion abuse" },
        { id: "harassment", label: "Harassment or hate speech" },
        { id: "ip", label: "IP / copyright infringement" },
        { id: "misleading", label: "Misleading or fraudulent" },
        { id: "other", label: "Other concern" },
      ]));
  }, []);

  const submit = async () => {
    setErr("");
    if (!reason) { setErr("Pick a reason."); return; }
    setBusy(true);
    try {
      await reportShowcase(post.id, { reason, details });
      toast.success("Thanks — a moderator will review it.");
      onSubmitted && onSubmitted();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't submit the report.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid={`showcase-report-dialog-${post.id}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0a0a0a] border border-[#262626] w-full max-w-md p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-1">
              ◆ Report post
            </div>
            <div className="font-display text-lg">{post.title}</div>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
            data-testid={`showcase-report-close-${post.id}`}
          >
            Cancel
          </button>
        </div>

        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252]">Reason</div>
          <div className="space-y-1.5">
            {reasons.map((r) => (
              <label
                key={r.id}
                className={`flex items-start gap-3 border px-3 py-2 cursor-pointer transition ${
                  reason === r.id
                    ? "border-[#ff4500] bg-[#ff4500]/5"
                    : "border-[#262626] hover:border-[#525252]"
                }`}
                data-testid={`showcase-report-reason-${r.id}`}
              >
                <input
                  type="radio" name="reason" value={r.id}
                  checked={reason === r.id}
                  onChange={() => setReason(r.id)}
                  className="mt-0.5 accent-[#ff4500]"
                />
                <span className="font-mono text-xs text-[#e5e5e5]">{r.label}</span>
              </label>
            ))}
          </div>
        </div>

        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Optional — extra context that helps the moderator (max 1000 chars)."
          rows={3}
          maxLength={1000}
          className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
          data-testid={`showcase-report-details-${post.id}`}
        />

        {err && (
          <p className="font-mono text-[10px] text-red-400" data-testid={`showcase-report-error-${post.id}`}>
            {err}
          </p>
        )}

        <button
          onClick={submit}
          disabled={busy || !reason}
          className="btn-industrial btn-primary w-full disabled:opacity-50"
          data-testid={`showcase-report-submit-${post.id}`}
        >
          {busy ? "Sending…" : "Submit report"}
        </button>
        <p className="font-mono text-[10px] text-[#525252] leading-relaxed">
          Reports are private. The poster is not notified. Submitting false reports may result in your account being restricted.
        </p>
      </div>
    </div>
  );
}

// ===================== DESIGN FILES =====================
// "Trending this week" rail — surfaces the 6 most-downloaded design files
// from the last 7 days. Self-degrades to lifetime top-N when there's no
// recent activity (so it never goes empty on a quiet week). Each card
// links to the canonical file detail and shows the recent-window
// download count up-front as social proof.
function TrendingFilesRail({ me, onRefresh }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    fetchTrendingDesignFiles(7, 6)
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);

  if (rows === null) return null;
  if (!rows.length) return null;

  const isFallback = rows[0]?.fallback;

  const handleDownload = async (file) => {
    if (!me) {
      toast.error("Sign in to download.");
      return;
    }
    setBusy(file.id);
    try {
      const r = await downloadDesignFile(file.id);
      if (r.locked) {
        toast.error(r.message || "Free downloads exhausted — unlock for $5.");
        return;
      }
      window.open(r.url, "_blank");
      onRefresh && onRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Download failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="mb-8" data-testid="trending-files-rail">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-[#ff4500]" />
          <h3 className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#ff4500]">
            ◆ {isFallback ? "All-time downloads" : "Trending this week"}
          </h3>
        </div>
        {!isFallback && (
          <span className="font-mono text-[10px] text-[#525252] uppercase tracking-[0.22em]">
            last 7 days
          </span>
        )}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((f, i) => (
          <TrendingFileCard
            key={f.id}
            rank={i + 1}
            file={f}
            busy={busy === f.id}
            onDownload={() => handleDownload(f)}
            isFallback={isFallback}
          />
        ))}
      </div>
    </section>
  );
}

function TrendingFileCard({ rank, file, busy, onDownload, isFallback }) {
  return (
    <div
      className="border border-[#262626] bg-[#0d0d0d] p-3 flex items-center gap-3 hover:border-[#ff4500]/60 transition-colors"
      data-testid={`trending-file-${file.id}`}
    >
      <div className="font-display text-3xl text-[#ff4500] leading-none w-8 shrink-0 tabular-nums">
        {rank.toString().padStart(2, "0")}
      </div>
      {file.thumbnail_url ? (
        <img
          src={file.thumbnail_url}
          alt=""
          loading="lazy"
          className="w-14 h-14 object-cover border border-[#262626] shrink-0"
        />
      ) : (
        <div className="w-14 h-14 border border-[#262626] bg-[#0a0a0a] shrink-0 flex items-center justify-center font-mono text-[9px] uppercase text-[#525252]">
          {file.file_type?.toUpperCase() || "FILE"}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs text-[#e5e5e5] truncate font-bold">
          {file.title}
        </div>
        <div className="font-mono text-[10px] text-[#a3a3a3] mt-0.5 inline-flex items-center gap-1.5">
          <Download size={10} className="text-[#ff4500]" />
          <span className="tabular-nums" data-testid={`trending-file-count-${file.id}`}>
            {isFallback
              ? `${(file.lifetime_downloads ?? 0).toLocaleString()} all-time`
              : `${(file.recent_downloads ?? 0).toLocaleString()} this week`}
          </span>
          {!isFallback && file.lifetime_downloads ? (
            <span className="text-[#525252]">· {file.lifetime_downloads.toLocaleString()} lifetime</span>
          ) : null}
        </div>
      </div>
      <button
        onClick={onDownload}
        disabled={busy}
        className="px-2.5 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
        data-testid={`trending-file-download-${file.id}`}
        title="Download this file"
      >
        <Download size={11} /> {busy ? "…" : "Get"}
      </button>
    </div>
  );
}


function ContributorLeaderboard() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    fetchDesignFilesLeaderboard(10)
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]));
  }, []);
  if (!rows.length) return null;
  return (
    <div className="border border-[#262626] mb-6" data-testid="files-leaderboard">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-[#1a1a1a]/40 transition"
      >
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
          <Trophy size={14} /> Top Contributors
        </span>
        <span className="font-mono text-[10px] text-[#525252]">
          {open ? "Hide" : `Show top ${rows.length}`}
        </span>
      </button>
      {open && (
        <ol className="border-t border-[#262626] divide-y divide-[#1a1a1a]" data-testid="files-leaderboard-list">
          {rows.map((r, i) => (
            <li
              key={`${r.kind}:${r.handle}`}
              className="flex items-center gap-3 px-5 py-3"
              data-testid={`leaderboard-row-${i + 1}`}
            >
              <span className={`font-display text-2xl shrink-0 w-7 text-right ${
                i === 0 ? "text-[#ff4500]" : i < 3 ? "text-[#e5e5e5]" : "text-[#525252]"
              }`}>{i + 1}</span>
              {r.avatar ? (
                <img src={r.avatar} alt="" className="w-8 h-8 object-cover border border-[#262626] shrink-0" />
              ) : (
                <div className="w-8 h-8 border border-[#262626] bg-[#0a0a0a] shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-[#e5e5e5] truncate">
                  {r.kind === "maker" ? (
                    <Link to={`/makers/${r.handle}`} className="hover:text-[#ff4500]">
                      {r.display_name}
                    </Link>
                  ) : r.display_name}
                  <span className="ml-2 px-1.5 py-0.5 border border-[#262626] text-[#a3a3a3] text-[9px] uppercase tracking-[0.2em]">
                    {r.kind}
                  </span>
                </div>
                <div className="font-mono text-[10px] text-[#a3a3a3] mt-0.5">
                  {r.uploads} upload{r.uploads === 1 ? "" : "s"} · {r.downloads} download{r.downloads === 1 ? "" : "s"}
                </div>
              </div>
              <div className="font-display text-xl text-[#ff4500] shrink-0" title="Contribution score (uploads × 5 + downloads)">
                {r.score}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function FilesTab({ me }) {
  const [files, setFiles] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  // Any signed-in community user (buyer OR maker) can contribute a file.
  // `me` is the buyer-side session; maker-JWT also gates access. Both
  // paths are accepted by the backend `current_any_user` dependency.
  const isMaker = !!localStorage.getItem("cm_maker_jwt");
  const isSignedIn = !!me || isMaker;
  const refresh = () => fetchDesignFiles().then(setFiles);
  useEffect(() => { refresh(); }, []);

  return (
    <div data-testid="files-tab">
      <div className="mb-6 flex flex-col sm:flex-row justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-[#a3a3a3]">
            {files.length} community files
          </p>
          {!isSignedIn && (
            <p className="font-mono text-[10px] text-[#525252] mt-1" data-testid="files-signin-hint">
              Sign in to upload a bundle — pick multiple formats (jpg, stl, dxf, dwg, svg, g-code, pdf, zip…) for the same design.
            </p>
          )}
        </div>
        {isSignedIn && (
          <button
            onClick={() => setShowUpload((s) => !s)}
            className="btn-industrial btn-primary inline-flex items-center gap-2 self-start"
            data-testid="files-upload-btn"
          >
            <Plus size={14} /> {showUpload ? "Cancel" : "Upload a file"}
          </button>
        )}
      </div>
      {showUpload && (
        <SectionErrorBoundary
          testId="files-upload-error-boundary"
          fallback="The upload form hit an unexpected error. Click Try again, or refresh — your other community content is unaffected."
        >
          <FileUploadForm onSaved={() => { setShowUpload(false); refresh(); }} />
        </SectionErrorBoundary>
      )}
      <TrendingFilesRail me={me} onRefresh={refresh} />
      <ContributorLeaderboard />
      {!files.length ? (
        <p className="font-mono text-sm text-[#a3a3a3]" data-testid="files-empty">
          No design files yet — be the first to share a bundle.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="files-grid">
          {files.map((f) => (
            <FileCard key={f.id} file={f} canDownload={!!me} me={me} onRefresh={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

// Real multipart uploader — any signed-in community user can contribute.
// Falls back to an external-URL-paste mode for makers who host on
// Dropbox / Drive / their own CDN (zero-copy, no R2 spend).
//
// Multi-format bundles: the file picker accepts up to 10 files at once.
// First-picked becomes the **primary** (its format chip drives the card
// header); the rest land as variants. Typical bundle for a maker:
// hero.jpg + model.stl + cut.dxf + preview.svg + program.gcode.
const ACCEPTED_EXTS = ["dxf", "dwg", "svg", "stl", "glb", "gltf", "ai", "eps", "pdf", "zip", "jpg", "jpeg", "png", "webp", "gcode", "nc", "tap"];
const ACCEPTED_ATTR = ACCEPTED_EXTS.map((e) => "." + e).join(",");
const MAX_VARIANTS_PER_BUNDLE = 10;
const MAX_BUNDLE_BYTES = 25 * 1024 * 1024; // matches MAX_DESIGN_BYTES per file

function FileUploadForm({ onSaved }) {
  const [mode, setMode] = useState("upload"); // "upload" | "url"
  const [f, setF] = useState({ title: "", description: "", file_type: "DXF", download_url: "", thumbnail_url: "" });
  const [picked, setPicked] = useState([]); // File[] — first is primary
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [autoSvg, setAutoSvg] = useState(true);  // auto-generate SVG from DXF post-upload
  const [previews, setPreviews] = useState({}); // index → blob URL or inline string
  const isMaker = !!localStorage.getItem("cm_maker_jwt");
  // Ref so the "+ Add another file" button can re-open the native picker
  // dialog without forcing the operator to scroll back up to the input.
  const pickerRef = React.useRef(null);

  // Build / refresh visual previews whenever the picked-files set changes.
  // Image files (jpg/png/webp/gif) get a blob URL. SVG files get inline
  // text injected via dangerouslySetInnerHTML (sandboxed by inferred
  // viewBox + fixed size). Non-previewable formats (STL, DXF, GCODE,
  // PDF, F3D) get a pictogram placeholder. We revoke blob URLs in the
  // cleanup pass so the browser doesn't leak memory on large bundles.
  useEffect(() => {
    const next = {};
    const cleanup = [];
    picked.forEach((file, i) => {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) {
        const url = URL.createObjectURL(file);
        next[i] = { kind: "image", url };
        cleanup.push(url);
      } else if (ext === "svg") {
        // Inline-read SVG so we can render it directly (gives a real
        // preview instead of the unhelpful blob:// download tab).
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreviews((prev) => ({ ...prev, [i]: { kind: "svg", text: String(e.target.result || "").slice(0, 200_000) } }));
        };
        reader.readAsText(file);
        next[i] = { kind: "svg-loading" };
      } else {
        next[i] = { kind: "placeholder", ext: ext.toUpperCase() };
      }
    });
    setPreviews(next);
    return () => { cleanup.forEach((u) => URL.revokeObjectURL(u)); };
  }, [picked]);

  // Detect DXF-without-SVG combo so we can offer auto-generate. We
  // recompute on every render because picked is small (<10 files).
  const hasDxf = picked.some((f) => /\.dxf$/i.test(f.name));
  const hasSvg = picked.some((f) => /\.svg$/i.test(f.name));
  const offerAutoSvg = hasDxf && !hasSvg;

  const inferFmt = (file) => {
    const ext = (file.name.split(".").pop() || "").toUpperCase();
    return ext === "GLTF" ? "GLB" : (ext === "JPEG" ? "JPG" : ext);
  };

  const onFileChange = (e) => {
    setErr("");
    const fl = Array.from(e.target.files || []);
    if (!fl.length) {
      // Empty event — happens when the user opens the picker and cancels
      // out of it. Don't clobber what they already have selected.
      e.target.value = "";
      return;
    }
    // Per-file size cap (matches backend MAX_DESIGN_BYTES). Reject the
    // whole batch if any file is over — clearer error than partial fail.
    for (const file of fl) {
      if (file.size > MAX_BUNDLE_BYTES) {
        setErr(`'${file.name}' is ${(file.size / 1024 / 1024).toFixed(1)} MB — must be ≤ 25 MB.`);
        e.target.value = "";
        return;
      }
    }
    // ACCUMULATE across multiple picker invocations. The native
    // `<input type=file>` replaces its `.files` list every time you
    // open it — so without this merge, picking a 2nd file in a 2nd
    // click silently throws away the first. We dedupe by format
    // (each format may appear once per bundle) AND by exact name+size
    // (so re-picking the same file twice doesn't double-add).
    setPicked((prev) => {
      const merged = [...prev];
      const seenFmts = new Set(merged.map((f) => inferFmt(f).toLowerCase()));
      const seenKeys = new Set(merged.map((f) => `${f.name}::${f.size}`));
      for (const file of fl) {
        const fmt = inferFmt(file).toLowerCase();
        const key = `${file.name}::${file.size}`;
        if (seenKeys.has(key)) continue;          // exact dup — silently skip
        if (seenFmts.has(fmt)) {
          setErr(`Already have a ${fmt.toUpperCase()} file in this bundle. Remove it first if you want to swap.`);
          continue;
        }
        if (merged.length >= MAX_VARIANTS_PER_BUNDLE) {
          setErr(`Up to ${MAX_VARIANTS_PER_BUNDLE} files per bundle.`);
          break;
        }
        seenFmts.add(fmt);
        seenKeys.add(key);
        merged.push(file);
      }
      // Auto-detect primary format from the first file in the merged list.
      if (merged.length) {
        setF((c) => ({ ...c, file_type: inferFmt(merged[0]) }));
      }
      return merged;
    });
    // Clear the input value so the SAME file can be re-picked after a
    // remove (otherwise Chrome blocks the re-selection because nothing
    // changed).
    e.target.value = "";
  };

  const removePicked = (idx) => {
    const next = picked.filter((_, i) => i !== idx);
    setPicked(next);
    if (next.length) setF((c) => ({ ...c, file_type: inferFmt(next[0]) }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    setProgress(0);
    try {
      let saved = null;
      if (mode === "upload") {
        if (!picked.length) throw new Error("Pick at least one file to upload.");
        saved = await uploadDesignFileDirect(
          { files: picked, title: f.title, description: f.description, thumbnail_url: f.thumbnail_url },
          { onProgress: setProgress },
        );
      } else {
        saved = await uploadDesignFile(f); // URL-paste, maker-only
      }
      // Optional: auto-generate an SVG variant from a freshly uploaded DXF
      // bundle. Best-effort — we don't fail the whole publish if conversion
      // throws (the user can always click "Generate" on the card later).
      if (mode === "upload" && saved?.id && offerAutoSvg && autoSvg) {
        try {
          await convertDxfToSvg(saved.id);
        } catch (svgErr) {
          // Surface as a toast but don't block the success path —
          // the bundle was published, the SVG is just a bonus.
          toast.warning(
            svgErr?.response?.data?.detail
              || "Bundle published, but DXF→SVG conversion failed. Click Generate on the card to retry.",
          );
        }
      }
      onSaved();
    } catch (e2) {
      setErr(e2?.response?.data?.detail || e2?.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="border border-[#262626] p-5 mb-6 space-y-4"
      data-testid="file-upload-form"
    >
      {/* Mode switcher — only makers see the URL-paste option (they're the
          ones with existing cloud storage). Buyers get a single upload path. */}
      {isMaker && (
        <div className="flex gap-2 pb-2 border-b border-[#262626]" data-testid="file-upload-mode">
          {[
            { id: "upload", label: "Upload a file" },
            { id: "url", label: "Paste a link" },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              data-testid={`file-mode-${m.id}`}
              className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                mode === m.id
                  ? "border-[#ff4500] text-[#ff4500] bg-[#ff4500]/5"
                  : "border-[#262626] text-[#a3a3a3] hover:border-[#525252] hover:text-[#e5e5e5]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            Title <span className="text-[#ff4500]">*</span>
          </span>
          <input
            required
            placeholder="e.g. Mountain Range Wall Art — Plasma Cut"
            name="title"
            autoComplete="off"
            value={f.title}
            onChange={(e) => { const v = e.target.value; setF((c) => ({ ...c, title: v })); }}
            className="mt-1 w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
            data-testid="file-title"
          />
          <span className="font-mono text-[10px] text-[#525252]">
            Short, descriptive — this is what shows up in search results.
          </span>
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            {mode === "url" ? (
              <>File format <span className="text-[#ff4500]">*</span></>
            ) : (
              <>Files <span className="text-[#ff4500]">*</span></>
            )}
          </span>
          {mode === "url" ? (
            <>
              <select
                value={f.file_type}
                name="file_type"
                onChange={(e) => { const v = e.target.value; setF((c) => ({ ...c, file_type: v })); }}
                className="mt-1 w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
                data-testid="file-type"
              >
                {["DXF", "SVG", "STL", "GLB", "OTHER"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <span className="font-mono text-[10px] text-[#525252]">
                What format is the file you're linking to?
              </span>
            </>
          ) : (
            <>
              <div className="mt-1 relative flex items-center border border-[#262626] focus-within:border-[#ff4500] px-3 py-2">
                <input
                  ref={pickerRef}
                  type="file"
                  required={!picked.length}
                  multiple
                  accept={ACCEPTED_ATTR}
                  onChange={onFileChange}
                  data-testid="file-picker"
                  disabled={busy}
                  className="w-full font-mono text-xs text-[#e5e5e5] file:mr-3 file:py-1 file:px-3 file:border file:border-[#ff4500] file:text-[#ff4500] file:bg-transparent file:font-mono file:text-[10px] file:uppercase file:tracking-[0.22em] hover:file:bg-[#ff4500]/10 file:cursor-pointer cursor-pointer disabled:opacity-50"
                />
              </div>
              <span className="font-mono text-[10px] text-[#525252]">
                Pick one or several files — the first is the primary preview.
              </span>
            </>
          )}
        </label>
      </div>

      {/* Multi-file picker hint — only for upload mode. */}
      {mode === "upload" && (
        <p className="font-mono text-[10px] text-[#525252] -mt-2" data-testid="file-multi-hint">
          Tip: <strong className="text-[#a3a3a3]">click the picker again</strong> to add another format to the same bundle —
          e.g. <span className="text-[#ff4500]">hero.jpg + model.stl + cut.dxf + program.gcode</span>.
          The first file picked is the primary; the rest become variants. Up to {MAX_VARIANTS_PER_BUNDLE} per bundle, ≤ 25 MB each.
        </p>
      )}

      {mode === "url" && (
        <input
          required
          placeholder="Download URL (Dropbox/Drive/etc.)"
          name="download_url"
          autoComplete="url"
          value={f.download_url}
          onChange={(e) => { const v = e.target.value; setF((c) => ({ ...c, download_url: v })); }}
          className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
          data-testid="file-url"
        />
      )}

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          Thumbnail URL <span className="text-[#525252] normal-case">(optional)</span>
        </span>
        <input
          placeholder="https://… (skip this — we auto-generate one from any image you upload)"
          name="thumbnail_url"
          autoComplete="url"
          value={f.thumbnail_url}
          onChange={(e) => { const v = e.target.value; setF((c) => ({ ...c, thumbnail_url: v })); }}
          className="mt-1 w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
          data-testid="file-thumb"
        />
        <span className="font-mono text-[10px] text-[#525252] leading-relaxed">
          Want to use a hosted image as the card cover? Paste its URL.
          Otherwise, leave this blank — we'll auto-pick the first jpg/png/webp in your bundle, or render an STL into a preview for you.
        </span>
      </label>

      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          Description <span className="text-[#ff4500]">*</span>
        </span>
        <textarea
          required
          placeholder={
            "What's in the bundle? A few sentences buyers will love:\n"
            + "  • What it makes (e.g. 24\" mountain wall art)\n"
            + "  • Material thickness / cut path notes (1/8\" steel, 0.06 kerf)\n"
            + "  • Recommended machine (laser, plasma, CNC router)\n"
            + "  • License — personal use only? Commercial OK?"
          }
          rows={5}
          maxLength={800}
          name="description"
          autoComplete="off"
          value={f.description}
          onChange={(e) => { const v = e.target.value; setF((c) => ({ ...c, description: v })); }}
          className="mt-1 w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y leading-relaxed"
          data-testid="file-description"
        />
        <div className="flex items-center justify-between gap-3 mt-1">
          <span className="font-mono text-[10px] text-[#525252] leading-relaxed">
            Tip: clear, scannable descriptions get downloaded 2× more. Hit each bullet above if you can.
          </span>
          <span
            className={`font-mono text-[10px] shrink-0 ${
              f.description.length >= 750 ? "text-[#ff4500]" : "text-[#525252]"
            }`}
            data-testid="file-description-counter"
          >
            {f.description.length}/800
          </span>
        </div>
      </label>

      {/* Preview of all picked files — first row is the primary; others
          are variants. Each is removable individually before submit. We
          render a real visual preview for raster + svg files (so the
          maker actually sees what's about to ship) and a labeled
          pictogram for non-renderable formats (STL/DXF/GCODE/PDF/F3D). */}
      {mode === "upload" && picked.length > 0 && !busy && (
        <ul className="space-y-2" data-testid="file-preview-list">
          {picked.map((file, i) => {
            const fmt = (file.name.split(".").pop() || "").toUpperCase();
            const preview = previews[i];
            return (
              <li
                key={`${file.name}-${i}`}
                className="flex items-stretch gap-3 px-3 py-2 border border-[#262626] bg-[#0f0f0f]"
                data-testid={`file-preview-${i}`}
              >
                {/* Thumb / pictogram column — fixed 64px square so the row
                    height stays predictable across mixed bundles. */}
                <div className="w-16 h-16 shrink-0 border border-[#262626] bg-[#050505] flex items-center justify-center overflow-hidden">
                  {preview?.kind === "image" ? (
                    <img
                      src={preview.url}
                      alt={file.name}
                      className="w-full h-full object-cover"
                      data-testid={`file-preview-thumb-${i}`}
                    />
                  ) : preview?.kind === "svg" ? (
                    <div
                      className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
                      dangerouslySetInnerHTML={{ __html: preview.text }}
                      data-testid={`file-preview-svg-${i}`}
                    />
                  ) : preview?.kind === "svg-loading" ? (
                    <span className="font-mono text-[9px] text-[#525252]">…</span>
                  ) : (
                    <span
                      className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#a3a3a3] text-center px-1 leading-tight"
                      data-testid={`file-preview-placeholder-${i}`}
                    >
                      {preview?.ext || fmt}
                      <br />
                      <span className="text-[#525252] text-[8px]">no preview</span>
                    </span>
                  )}
                </div>
                {/* Metadata column. */}
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[0.22em] px-1.5 py-0.5 border ${
                        i === 0 ? "border-[#ff4500] text-[#ff4500] bg-[#ff4500]/5" : "border-[#525252] text-[#a3a3a3]"
                      }`}
                      title={i === 0 ? "Primary format (drives the card header)" : "Variant"}
                    >
                      {fmt}
                    </span>
                    {i === 0 && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#ff4500]">Primary</span>
                    )}
                    <span className="font-mono text-[10px] text-[#a3a3a3] shrink-0 ml-auto">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                  <span className="font-mono text-xs text-[#e5e5e5] truncate" title={file.name}>
                    {file.name}
                  </span>
                </div>
                {/* Remove control. */}
                <button
                  type="button"
                  onClick={() => removePicked(i)}
                  className="font-mono text-[10px] text-[#525252] hover:text-red-400 self-start"
                  data-testid={`file-preview-remove-${i}`}
                  title="Remove from bundle"
                >
                  ✕
                </button>
              </li>
            );
          })}
          {/* Explicit "add more" affordance — much clearer than asking
              the user to re-trigger the file input above. Clicking
              opens the native picker again; new files are merged
              (deduped) into the existing bundle. */}
          {picked.length < MAX_VARIANTS_PER_BUNDLE && (
            <li>
              <button
                type="button"
                onClick={() => pickerRef.current?.click()}
                className="w-full px-3 py-2 border border-dashed border-[#ff4500]/50 hover:border-[#ff4500] hover:bg-[#ff4500]/5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#ff4500] flex items-center justify-center gap-2 transition"
                data-testid="file-add-another"
              >
                <Plus size={12} /> Add another format ({MAX_VARIANTS_PER_BUNDLE - picked.length} slots left)
              </button>
            </li>
          )}
        </ul>
      )}

      {/* Auto DXF→SVG opt-in — only appears when a DXF is in the bundle
          and no SVG sibling is present. Default-checked because (a) the
          conversion is free, (b) DXFs don't render in browsers so the
          download menu without an SVG sibling looks broken, and (c)
          owners can always remove the generated SVG later. */}
      {mode === "upload" && offerAutoSvg && !busy && (
        <label
          className="flex items-start gap-2 px-3 py-2 border border-dashed border-[#ff4500]/40 bg-[#ff4500]/5 cursor-pointer"
          data-testid="file-auto-svg-toggle"
        >
          <input
            type="checkbox"
            checked={autoSvg}
            onChange={(e) => setAutoSvg(e.target.checked)}
            className="mt-1 accent-[#ff4500]"
            data-testid="file-auto-svg-checkbox"
          />
          <div className="flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">
              ✦ Auto-generate SVG preview
            </div>
            <p className="font-mono text-[10px] text-[#a3a3a3] mt-0.5 leading-relaxed">
              Renders your DXF as an SVG so it previews in browsers + adds an extra download format. Free, runs after upload completes. Uncheck if you'd rather upload your own SVG separately.
            </p>
          </div>
        </label>
      )}

      {/* Upload progress bar — only shown during an in-flight upload. */}
      {busy && mode === "upload" && (
        <div className="space-y-1" data-testid="file-progress">
          <div className="h-1 bg-[#1a1a1a] overflow-hidden">
            <div
              className="h-full bg-[#ff4500] transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="font-mono text-[10px] text-[#a3a3a3]">
            Uploading {picked.length === 1 ? picked[0].name : `${picked.length} files`}… {progress}%
          </div>
        </div>
      )}

      {err && (
        <div className="font-mono text-xs text-red-400" data-testid="file-upload-error">
          {err}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || (mode === "upload" && !picked.length)}
        className="btn-industrial btn-primary w-full disabled:opacity-50"
        data-testid="file-submit"
      >
        {busy
          ? (mode === "upload" ? `Uploading… ${progress}%` : "Publishing…")
          : (picked.length > 1
              ? `Publish bundle (${picked.length} formats) →`
              : "Publish file →")}
      </button>
    </form>
  );
}

function FileCard({ file, canDownload, me, onRefresh }) {
  const [status, setStatus] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [rendering, setRendering] = useState(false);
  // Owner-side variant management: progress + error state for the
  // "Add another format" button rendered below the variant list.
  const [variantUploading, setVariantUploading] = useState(false);
  const [variantErr, setVariantErr] = useState("");
  const variantInputRef = React.useRef(null);
  // Only signed-in users can report (same auth gate as the upload path).
  const canReport = !!localStorage.getItem("cm_maker_jwt") || !!localStorage.getItem("cm_buyer_jwt");
  const variants = Array.isArray(file.variants) ? file.variants : [];
  const hasBundle = variants.length > 0;

  // Owner-only smart prompts. Identity comes from the bundle's
  // `uploader_id` (buyer userid) OR `maker_slug`. We compare against
  // both available JWT subjects so makers who happen to also be buyers
  // see only their own prompts.
  const myMakerSlug = localStorage.getItem("cm_maker_slug") || "";
  const myBuyerId = me?.user_id || "";
  const isOwner = (
    (file.maker_slug && file.maker_slug === myMakerSlug)
    || (file.uploader_id && file.uploader_id === myBuyerId)
  );
  const allFmts = new Set([
    (file.file_type || "").toUpperCase(),
    ...variants.map((v) => (v.format || "").toUpperCase()),
  ]);
  const canConvertDxfToSvg = isOwner && allFmts.has("DXF") && !allFmts.has("SVG");
  const canRenderStlThumb = isOwner && allFmts.has("STL") && !file.thumbnail_url;

  const onConvert = async () => {
    if (converting) return;
    setConverting(true);
    try {
      await convertDxfToSvg(file.id);
      toast.success("SVG preview generated.");
      if (onRefresh) await onRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't generate SVG.");
    } finally {
      setConverting(false);
    }
  };

  const onRenderThumb = async () => {
    if (rendering) return;
    setRendering(true);
    try {
      await renderStlThumbnail(file.id);
      toast.success("Thumbnail rendered.");
      if (onRefresh) await onRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't render thumbnail.");
    } finally {
      setRendering(false);
    }
  };

  const onDownload = async (variantUrl) => {
    if (!canDownload) return;
    setDownloadOpen(false);
    try {
      const r = await downloadDesignFile(file.id);
      if (r.locked) {
        setStatus({ kind: "locked", message: r.message });
      } else {
        // For the primary, use the metered URL (returned by backend).
        // For variants, the metered count was already incremented above
        // — we just open the variant URL directly.
        const url = variantUrl || r.url;
        setStatus({ kind: "ready", url, used: r.downloads_used });
        window.open(url, "_blank", "noopener");
      }
    } catch { setStatus({ kind: "err" }); }
  };
  const unlock = async () => {
    const r = await unlockDownloadsCheckout();
    window.location.href = r.url;
  };
  return (
    <div className="border border-[#262626] hover:border-[#ff4500] transition flex flex-col overflow-hidden" data-testid={`file-${file.id}`}>
      {/* Optional gallery preview — auto-promoted from a raster variant
          on upload, OR rendered later via STL→PNG. The orange "✦ generated"
          ribbon flags the trust signal so buyers don't think they're seeing
          a hand-shot studio photo. */}
      {file.thumbnail_url && (
        <div className="relative aspect-[4/3] bg-[#0a0a0a] overflow-hidden border-b border-[#262626]">
          <img
            src={file.thumbnail_url}
            alt={file.title}
            loading="lazy"
            className="w-full h-full object-contain"
            data-testid={`file-thumbnail-${file.id}`}
          />
          {file.thumbnail_auto_generated && (
            <span
              className="absolute top-2 left-2 px-1.5 py-0.5 border border-[#ff4500]/60 bg-[#0a0a0a]/80 text-[#ff4500] font-mono text-[9px] uppercase tracking-[0.22em]"
              title="Rendered automatically from your STL"
            >
              ✦ rendered
            </span>
          )}
        </div>
      )}
      <div className="p-4 flex flex-col gap-3">
      {/* Format chips row — primary + variants. Click any chip to download
          that specific format. Hides on signed-out users. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="font-mono text-[10px] uppercase tracking-[0.22em] px-1.5 py-0.5 border border-[#ff4500] text-[#ff4500]"
            title="Primary format"
          >
            ◆ {file.file_type}
          </span>
          {variants.map((v) => (
            <span
              key={v.format + (v.url || "")}
              className={`font-mono text-[10px] uppercase tracking-[0.22em] px-1.5 py-0.5 border inline-flex items-center gap-1 ${
                v.auto_generated
                  ? "border-[#ff4500]/50 text-[#ff4500] bg-[#ff4500]/5"
                  : "border-[#525252] text-[#a3a3a3]"
              }`}
              title={
                v.auto_generated
                  ? `Auto-generated from ${v.source_format || "source"}`
                  : (v.filename || `${v.format} variant`)
              }
              data-testid={`file-variant-chip-${file.id}-${v.format}`}
            >
              {v.auto_generated && "✦ "}{v.format}
              {isOwner && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await deleteDesignFileVariant(file.id, v.format);
                      onRefresh && onRefresh();
                    } catch (e) {
                      toast.error(e?.response?.data?.detail || "Couldn't remove variant.");
                    }
                  }}
                  className="ml-0.5 hover:text-red-400 cursor-pointer leading-none"
                  title="Remove this variant (owner only)"
                  data-testid={`file-variant-remove-${file.id}-${v.format}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {isOwner && variants.length < 9 && (
            <>
              <input
                ref={variantInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".dxf,.svg,.stl,.f3d,.gcode,.png,.jpg,.jpeg,.webp,.pdf"
                onChange={async (e) => {
                  setVariantErr("");
                  const fl = Array.from(e.target.files || []);
                  if (!fl.length) return;
                  const tooBig = fl.find((f) => f.size > 25 * 1024 * 1024);
                  if (tooBig) {
                    setVariantErr(`'${tooBig.name}' is over 25 MB.`);
                    e.target.value = "";
                    return;
                  }
                  setVariantUploading(true);
                  try {
                    await addDesignFileVariants(file.id, fl);
                    toast.success(`Added ${fl.length} format${fl.length === 1 ? "" : "s"} to bundle.`);
                    onRefresh && onRefresh();
                  } catch (err) {
                    const msg = err?.response?.data?.detail || "Couldn't add variant(s).";
                    setVariantErr(msg);
                    toast.error(msg);
                  } finally {
                    setVariantUploading(false);
                    e.target.value = "";
                  }
                }}
              />
              <button
                type="button"
                onClick={() => variantInputRef.current?.click()}
                disabled={variantUploading}
                className="font-mono text-[10px] uppercase tracking-[0.22em] px-1.5 py-0.5 border border-dashed border-[#ff4500]/60 text-[#ff4500] hover:bg-[#ff4500]/10 inline-flex items-center gap-1 disabled:opacity-50"
                title="Owner only — add another format (DXF, SVG, STL, F3D, GCODE, JPG, PNG, PDF)"
                data-testid={`file-add-variant-${file.id}`}
              >
                <Plus size={10} /> {variantUploading ? "Uploading…" : "Add format"}
              </button>
            </>
          )}
        </div>
        <span className="font-mono text-[10px] text-[#525252] shrink-0">{file.downloads} downloads</span>
      </div>
      {isOwner && variantErr && (
        <p className="font-mono text-[10px] text-red-400" data-testid={`file-variant-err-${file.id}`}>
          ⊗ {variantErr}
        </p>
      )}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="font-display text-xl leading-tight flex-1 min-w-0">{file.title}</div>
        {file.quality && <QualityBadge quality={file.quality} />}
      </div>
      <p className="font-mono text-[11px] text-[#a3a3a3] leading-relaxed">{file.description}</p>

      {/* SEO tag chips — auto-generated from title+description on upload.
          Visible text doubles as a search-engine signal and makes the
          bundle more discoverable on-platform via filter clicks. */}
      {Array.isArray(file.seo_tags) && file.seo_tags.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          data-testid={`file-tags-${file.id}`}
        >
          {file.seo_tags.slice(0, 8).map((t) => (
            <span
              key={t}
              className="font-mono text-[9px] uppercase tracking-[0.18em] px-1.5 py-0.5 border border-[#262626] text-[#a3a3a3] hover:text-[#ff4500] hover:border-[#ff4500]/40 transition cursor-default"
              title={`Auto-tag: ${t}`}
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* Promote-this-bundle share row. Each button opens the platform's
          web-share endpoint with the canonical /community/files/{id}
          URL — that endpoint is intercepted by the OG prerender for
          bot UAs so the resulting Pin / Tweet / Post gets a rich
          preview (image + title + tags). For Instagram (no web-share
          API), we copy a caption-friendly string to the clipboard. */}
      <ShareFileRow file={file} />

      {/* Owner-only smart prompts: nudge them to enrich the bundle. The
          DXF→SVG one-click is the highest-impact (laser/CNC shops post
          DXFs constantly, but DXFs don't preview in browsers — generated
          SVG sibling fixes both the preview gap AND the variant choice
          for downloaders). */}
      {canConvertDxfToSvg && (
        <div
          className="border border-dashed border-[#ff4500]/40 bg-[#ff4500]/5 px-3 py-2 flex items-center justify-between gap-3"
          data-testid={`file-prompt-missing-svg-${file.id}`}
        >
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] flex items-center gap-1">
              <Sparkles size={11} /> Missing an SVG preview
            </div>
            <p className="font-mono text-[10px] text-[#a3a3a3] mt-0.5 leading-relaxed">
              We can render your DXF as a clean SVG so it shows in browsers.
            </p>
          </div>
          <button
            onClick={onConvert}
            disabled={converting}
            className="btn-industrial text-[10px] py-1.5 px-3 inline-flex items-center gap-1 shrink-0 disabled:opacity-50"
            data-testid={`file-generate-svg-${file.id}`}
          >
            {converting ? "Generating…" : "Generate"}
          </button>
        </div>
      )}

      {canRenderStlThumb && (
        <div
          className="border border-dashed border-[#ff4500]/40 bg-[#ff4500]/5 px-3 py-2 flex items-center justify-between gap-3"
          data-testid={`file-prompt-missing-thumb-${file.id}`}
        >
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] flex items-center gap-1">
              <Sparkles size={11} /> Missing a thumbnail
            </div>
            <p className="font-mono text-[10px] text-[#a3a3a3] mt-0.5 leading-relaxed">
              We'll render your STL into a gallery-ready preview image.
            </p>
          </div>
          <button
            onClick={onRenderThumb}
            disabled={rendering}
            className="btn-industrial text-[10px] py-1.5 px-3 inline-flex items-center gap-1 shrink-0 disabled:opacity-50"
            data-testid={`file-render-thumb-${file.id}`}
          >
            {rendering ? "Rendering…" : "Render"}
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] text-[#525252] uppercase tracking-[0.22em]">by {file.maker_name}</div>
        <div className="flex items-center gap-3">
          {isOwner && (
            <button
              onClick={() => setEditOpen(true)}
              className="font-mono text-[10px] text-[#525252] hover:text-[#ff4500] inline-flex items-center gap-1 transition"
              data-testid={`file-edit-btn-${file.id}`}
              title="Edit title, description, or thumbnail (owner only)"
            >
              <Pencil size={11} /> Edit
            </button>
          )}
          {canReport && (
            <button
              onClick={() => setReportOpen(true)}
              className="font-mono text-[10px] text-[#525252] hover:text-red-400 inline-flex items-center gap-1 transition"
              data-testid={`file-report-btn-${file.id}`}
              title="Flag this file for admin review"
            >
              <Flag size={11} /> Report
            </button>
          )}
        </div>
      </div>
      {status?.kind === "locked" ? (
        <button onClick={unlock} className="btn-industrial btn-primary inline-flex items-center justify-center gap-2" data-testid={`file-unlock-${file.id}`}>
          <Lock size={14} /> Unlock $5 — 6 mo unlimited
        </button>
      ) : !hasBundle ? (
        // Single-format files keep the simple direct-download button.
        <button onClick={() => onDownload(null)} disabled={!canDownload}
                className="btn-industrial inline-flex items-center justify-center gap-2 border border-[#262626] hover:border-[#ff4500] disabled:opacity-50"
                data-testid={`file-download-${file.id}`}>
          <Download size={14} /> {canDownload ? "Download" : "Sign in to download"}
        </button>
      ) : (
        // Multi-format bundles get a dropdown so the user picks the format
        // they actually want. Each click hits the same metered endpoint
        // so quotas stay accurate.
        <div className="relative" data-testid={`file-download-bundle-${file.id}`}>
          <button
            onClick={() => canDownload && setDownloadOpen((s) => !s)}
            disabled={!canDownload}
            className="btn-industrial w-full inline-flex items-center justify-center gap-2 border border-[#262626] hover:border-[#ff4500] disabled:opacity-50"
            data-testid={`file-download-${file.id}`}
          >
            <Download size={14} />
            {canDownload ? `Download · pick format` : "Sign in to download"}
          </button>
          {downloadOpen && canDownload && (
            <div
              className="absolute left-0 right-0 top-full mt-1 z-20 border border-[#262626] bg-[#0a0a0a] shadow-xl"
              data-testid={`file-download-menu-${file.id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => onDownload(null)}
                className="w-full text-left px-3 py-2 font-mono text-xs text-[#e5e5e5] hover:bg-[#1a1a1a] flex items-center justify-between"
                data-testid={`file-download-fmt-${file.id}-${file.file_type}`}
              >
                <span><span className="text-[#ff4500]">◆ {file.file_type}</span> <span className="text-[#525252]">· primary</span></span>
                <Download size={12} />
              </button>
              {variants.map((v) => (
                <button
                  key={v.format + (v.url || "")}
                  onClick={() => onDownload(v.url)}
                  className="w-full text-left px-3 py-2 font-mono text-xs text-[#e5e5e5] hover:bg-[#1a1a1a] flex items-center justify-between border-t border-[#1a1a1a]"
                  data-testid={`file-download-fmt-${file.id}-${v.format}`}
                >
                  <span>
                    {v.format}
                    {v.size_bytes && <span className="text-[#525252] ml-2">{(v.size_bytes / 1024 / 1024).toFixed(2)} MB</span>}
                  </span>
                  <Download size={12} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Silent metering: removed the "X/5 free" counter on purpose so users
          aren't reminded of a quota until they actually hit it. */}
      {reportOpen && (
        <ReportFileModal
          file={file}
          onClose={() => setReportOpen(false)}
        />
      )}
      {editOpen && (
        <EditFileModal
          file={file}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); onRefresh && onRefresh(); }}
        />
      )}
      </div>
    </div>
  );
}

// Owner-only metadata editor — title, description, thumbnail URL. The
// actual files are immutable here; format variants are managed by the
// "+ Add format" button and the × on each chip in the card header.
function EditFileModal({ file, onClose, onSaved }) {
  const [title, setTitle] = useState(file.title || "");
  const [description, setDescription] = useState(file.description || "");
  const [thumbUrl, setThumbUrl] = useState(file.thumbnail_url || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const dirty = (
    title.trim() !== (file.title || "")
    || description.trim() !== (file.description || "")
    || thumbUrl.trim() !== (file.thumbnail_url || "")
  );

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !dirty) return;
    setErr("");
    if (!title.trim() || title.trim().length > 120) {
      setErr("Title is required (max 120 chars)."); return;
    }
    if (!description.trim() || description.trim().length > 800) {
      setErr("Description is required (max 800 chars)."); return;
    }
    setBusy(true);
    try {
      await updateDesignFile(file.id, {
        title: title.trim(),
        description: description.trim(),
        thumbnail_url: thumbUrl.trim(),
      });
      toast.success("Saved.");
      onSaved && onSaved();
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Couldn't save changes.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="edit-file-modal"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-[#0a0a0a] border border-[#ff4500]/50 p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">◆ Edit design</div>
            <h3 className="font-display text-xl mt-1">Update bundle details</h3>
            <p className="font-mono text-[11px] text-[#a3a3a3] mt-1">
              Files themselves stay intact — use × on a chip or "+ Add format" to change formats.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-[#525252] hover:text-[#e5e5e5] disabled:opacity-50"
            data-testid="edit-file-close"
            aria-label="Close edit modal"
          >
            <XIcon size={18} />
          </button>
        </div>

        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            disabled={busy}
            className="mt-1 w-full bg-[#050505] border border-[#262626] px-3 py-2 font-mono text-sm text-[#e5e5e5] focus:border-[#ff4500] outline-none"
            data-testid="edit-file-title"
          />
        </label>

        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={800}
            rows={4}
            disabled={busy}
            className="mt-1 w-full bg-[#050505] border border-[#262626] px-3 py-2 font-mono text-sm text-[#e5e5e5] focus:border-[#ff4500] outline-none resize-y"
            data-testid="edit-file-description"
          />
          <span className="font-mono text-[10px] text-[#525252]">
            {description.length}/800
          </span>
        </label>

        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            Thumbnail URL <span className="text-[#525252] normal-case">(optional)</span>
          </span>
          <input
            value={thumbUrl}
            onChange={(e) => setThumbUrl(e.target.value)}
            maxLength={600}
            disabled={busy}
            placeholder="https://…"
            className="mt-1 w-full bg-[#050505] border border-[#262626] px-3 py-2 font-mono text-sm text-[#e5e5e5] focus:border-[#ff4500] outline-none"
            data-testid="edit-file-thumb-url"
          />
          <span className="font-mono text-[10px] text-[#525252]">
            Clear this field to fall back to an auto-generated thumbnail (if available).
          </span>
        </label>

        {err && (
          <p className="font-mono text-[11px] text-red-400" data-testid="edit-file-err">⊗ {err}</p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="font-mono text-xs uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#e5e5e5] disabled:opacity-50"
            data-testid="edit-file-cancel"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !dirty}
            className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="edit-file-save"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

// Promote-this-file share row — Pinterest/Twitter/Facebook/Copy-link
// buttons that fire each platform's web-share endpoint with the
// canonical /community/files/{id} URL. That URL is intercepted by the
// OG prerender for crawler UAs, so the resulting Pin / Tweet / Post
// gets a rich preview built from the file's seo_tags + thumbnail.
//
// Instagram has no web-share API, so for Instagram users we copy a
// caption-friendly string (title + tags + hashtags + URL) to the
// clipboard and toast — they paste into the Instagram composer.
function ShareFileRow({ file }) {
  // Public share URL — apex domain, never preview. Lives at
  // /community/files/{id}; the backend OG prerender route
  // (/api/og/community/file/{id}) is what crawlers should be sent to
  // (operator action via Cloudflare Worker, same pattern as products).
  const apex = (window.__CM_PUBLIC_SITE_URL__ || "https://craftersmarket.org").replace(/\/$/, "");
  const url = `${apex}/community/files/${file.id}`;
  const text = `${file.title} — Free CNC / laser / plasma design files on Crafters Market`;
  const tags = (file.seo_tags || []).slice(0, 8);
  const hashtags = tags.map((t) => "#" + t.replace(/[^a-z0-9]/g, "")).filter((h) => h.length > 1);

  const open = (href) => window.open(href, "_blank", "noopener,noreferrer,width=720,height=640");

  const onPinterest = () => {
    // media= helps Pinterest skip its own image-detection step and use
    // the actual file thumb directly.
    const media = (file.thumbnail_url || "").trim();
    const params = new URLSearchParams({
      url,
      description: `${text}\n\n${hashtags.join(" ")}`,
    });
    if (media) params.set("media", media);
    open(`https://pinterest.com/pin/create/button/?${params.toString()}`);
  };

  const onTwitter = () => {
    const params = new URLSearchParams({
      url,
      text,
      hashtags: tags.slice(0, 3).map((t) => t.replace(/[^a-z0-9]/g, "")).filter(Boolean).join(","),
    });
    open(`https://twitter.com/intent/tweet?${params.toString()}`);
  };

  const onFacebook = () => {
    open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
  };

  const onCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied — paste anywhere.");
    } catch {
      toast.error("Couldn't copy. Long-press to share manually.");
    }
  };

  const onCopyInstagramCaption = async () => {
    const caption = [
      `${file.title}`,
      file.description ? `\n${file.description.slice(0, 220)}` : "",
      `\n\n${hashtags.slice(0, 6).join(" ")}`,
      `\n\n👉 ${url}`,
    ].join("");
    try {
      await navigator.clipboard.writeText(caption);
      toast.success("Caption + link copied — paste into Instagram.");
    } catch {
      toast.error("Couldn't copy. Long-press to share manually.");
    }
  };

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap"
      data-testid={`file-share-row-${file.id}`}
    >
      <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252] mr-1">
        Promote ↗
      </span>
      <button
        type="button"
        onClick={onPinterest}
        className="font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-1 border border-[#262626] hover:border-[#e60023] hover:text-[#e60023] transition"
        data-testid={`file-share-pinterest-${file.id}`}
        title="Share to Pinterest — your boards drive long-tail SEO traffic for years"
      >
        Pinterest
      </button>
      <button
        type="button"
        onClick={onTwitter}
        className="font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-1 border border-[#262626] hover:border-[#1d9bf0] hover:text-[#1d9bf0] transition"
        data-testid={`file-share-twitter-${file.id}`}
        title="Post on X / Twitter"
      >
        X
      </button>
      <button
        type="button"
        onClick={onFacebook}
        className="font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-1 border border-[#262626] hover:border-[#1877f2] hover:text-[#1877f2] transition"
        data-testid={`file-share-facebook-${file.id}`}
        title="Share to Facebook"
      >
        Facebook
      </button>
      <button
        type="button"
        onClick={onCopyInstagramCaption}
        className="font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-1 border border-[#262626] hover:border-[#e1306c] hover:text-[#e1306c] transition"
        data-testid={`file-share-instagram-${file.id}`}
        title="Copy a ready-to-paste Instagram caption + link to your clipboard"
      >
        IG caption
      </button>
      <button
        type="button"
        onClick={onCopyLink}
        className="font-mono text-[10px] uppercase tracking-[0.22em] px-2 py-1 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] transition"
        data-testid={`file-share-copy-${file.id}`}
        title="Copy the public share link"
      >
        Copy link
      </button>
    </div>
  );
}

// One-off report composer — opened from the ⚑ Report button on any
// design-file card. Any signed-in user can flag for IP/copyright/etc.
// We never show the reporter's identity to the uploader to avoid
// retaliation loops.
const REPORT_REASON_OPTIONS = [
  { id: "stolen",     label: "Stolen work / IP infringement" },
  { id: "copyright",  label: "Copyright violation" },
  { id: "duplicate",  label: "Duplicate listing" },
  { id: "malware",    label: "Malware / suspicious file" },
  { id: "inaccurate", label: "Mislabelled or broken" },
  { id: "other",      label: "Other concern" },
];

// One-off report composer — opened from the ⚑ Report button on any
function ReportFileModal({ file, onClose }) {
  const [reason, setReason] = useState("stolen");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await reportDesignFile(file.id, { reason, details });
      setDone(r.duplicate ? "duplicate" : "sent");
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Report failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="report-file-modal"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="w-full max-w-md bg-[#0a0a0a] border border-red-500/50 p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400">◆ Report file</div>
            <h3 className="font-display text-xl mt-1">Flag for admin review</h3>
            <p className="font-mono text-[11px] text-[#a3a3a3] mt-1 truncate">{file.title}</p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            data-testid="report-file-close"
            className="font-mono text-xl text-[#a3a3a3] hover:text-red-400 disabled:opacity-50"
          >✕</button>
        </div>

        {done ? (
          <div
            className="border border-emerald-700/60 bg-emerald-900/20 p-3 font-mono text-xs text-emerald-300"
            data-testid="report-file-success"
          >
            {done === "duplicate"
              ? "You already reported this file — the admin team has it."
              : "Thanks — the admin team will review this within 24h. Your identity isn't shared with the uploader."}
            <button
              onClick={onClose}
              className="block mt-3 underline hover:text-emerald-200 font-mono text-xs"
              data-testid="report-file-done-close"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3" autoComplete="off">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Reason</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="report-file-reason"
                className="w-full mt-1.5 bg-[#0a0a0a] border border-[#262626] focus:border-red-400 outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
              >
                {REPORT_REASON_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Details (optional)</label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Link to the original, context, anything that helps us verify…"
                data-testid="report-file-details"
                className="w-full mt-1.5 bg-transparent border border-[#262626] focus:border-red-400 outline-none px-3 py-2 font-mono text-xs text-[#e5e5e5] resize-none"
              />
            </div>
            {err && <div className="font-mono text-xs text-red-400" data-testid="report-file-error">{err}</div>}
            <button
              type="submit"
              disabled={busy}
              data-testid="report-file-submit"
              className="w-full px-4 py-2 bg-red-600 hover:bg-red-500 border border-red-600 text-white font-mono text-xs uppercase tracking-[0.22em] font-bold transition disabled:opacity-50"
            >
              {busy ? "Sending…" : "Submit report →"}
            </button>
            <p className="font-mono text-[10px] text-[#525252] leading-relaxed">
              Reports are reviewed by Crafters Market admins. Misuse of this
              tool (mass/false reports) may suspend your account.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// ===================== FORUM =====================
const FORUM_CATEGORY_FALLBACK = [
  { id: "general", label: "General" },
  { id: "machine-help", label: "Machine Help" },
  { id: "techniques", label: "Techniques" },
  { id: "finishing", label: "Finishing" },
  { id: "resources", label: "Resources" },
  { id: "show-tell", label: "Show & Tell" },
];

function ForumTab({ me }) {
  const [threads, setThreads] = useState([]);
  const [active, setActive] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [categories, setCategories] = useState(FORUM_CATEGORY_FALLBACK);
  const [activeCat, setActiveCat] = useState("");  // "" = all
  const refresh = () => fetchForumThreads(activeCat).then(setThreads);
  useEffect(() => {
    fetchForumCategories()
      .then((r) => setCategories(r.categories || FORUM_CATEGORY_FALLBACK))
      .catch(() => {});
  }, []);
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [activeCat]);
  if (active) return <ThreadDetail id={active} me={me} onBack={() => { setActive(null); refresh(); }} />;

  // Pre-select the currently-active category for new threads
  const newDefaultCat = activeCat || "general";

  return (
    <div data-testid="forum-tab">
      {/* Category tab strip */}
      <div className="border-b border-[#262626] mb-5 flex gap-1 overflow-x-auto" data-testid="forum-categories">
        <button
          onClick={() => setActiveCat("")}
          className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] border-b-2 transition whitespace-nowrap ${
            activeCat === "" ? "border-[#ff4500] text-[#ff4500]" : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5]"
          }`}
          data-testid="forum-cat-all"
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] border-b-2 transition whitespace-nowrap ${
              activeCat === c.id ? "border-[#ff4500] text-[#ff4500]" : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5]"
            }`}
            data-testid={`forum-cat-${c.id}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mb-6 flex justify-between items-center">
        <p className="font-mono text-xs text-[#a3a3a3]">
          {threads.length} thread{threads.length === 1 ? "" : "s"}
          {activeCat && ` in ${(categories.find((c) => c.id === activeCat) || {}).label}`}
        </p>
        {me && (
          <button onClick={() => setShowNew((s) => !s)} className="btn-industrial btn-primary inline-flex items-center gap-2" data-testid="forum-new-btn">
            <Plus size={14} /> {showNew ? "Cancel" : "New thread"}
          </button>
        )}
      </div>
      {showNew && (
        <NewThreadForm
          categories={categories}
          defaultCategory={newDefaultCat}
          onSaved={() => { setShowNew(false); refresh(); }}
        />
      )}
      {!threads.length ? (
        <p className="font-mono text-sm text-[#a3a3a3]" data-testid="forum-empty">
          {activeCat
            ? "Nothing here yet — be the first to start a thread."
            : "No threads yet — start the first conversation."}
        </p>
      ) : (
        <ul className="space-y-3" data-testid="forum-list">
          {threads.map((t) => {
            const cat = categories.find((c) => c.id === (t.category || t.tag));
            return (
              <li key={t.id} onClick={() => setActive(t.id)}
                  className="border border-[#262626] hover:border-[#ff4500] p-4 cursor-pointer transition"
                  data-testid={`forum-thread-${t.id}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-display text-xl">{t.title}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                    {t.reply_count} replies · {(cat?.label) || (t.category || t.tag || "general")}
                  </span>
                </div>
                <p className="font-mono text-[11px] text-[#a3a3a3] mt-2 line-clamp-2">{t.body}</p>
                <div className="flex justify-between items-center mt-2">
                  <div className="font-mono text-[10px] text-[#525252] uppercase tracking-[0.22em]">
                    started by {t.user_name || t.user_email}
                  </div>
                  {(t.attachments?.length || 0) > 0 && (
                    <span className="font-mono text-[10px] text-[#ff4500]">📎 {t.attachments.length}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ForumAttachmentPicker({ value, onChange, busy, onBusy }) {
  const inputRef = useRef(null);
  const [err, setErr] = useState("");
  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if ((value.length + files.length) > 6) {
      setErr("Maximum 6 attachments per post.");
      return;
    }
    setErr("");
    onBusy(true);
    try {
      const out = [];
      for (const f of files) {
        // eslint-disable-next-line no-await-in-loop
        const r = await uploadForumAttachment(f);
        out.push(r);
      }
      onChange([...value, ...out]);
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Upload failed.");
    } finally {
      onBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  return (
    <div data-testid="forum-attachment-picker">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.svg,.glb,.gltf,.dxf,image/*,application/pdf"
        onChange={onPick}
        disabled={busy}
        className="hidden"
        data-testid="forum-attachment-input"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] border border-dashed border-[#262626] hover:border-[#ff4500] px-4 py-2 transition disabled:opacity-50"
        data-testid="forum-attach-btn"
      >
        {busy ? "Uploading…" : "+ Attach file"}
      </button>
      {err && <p className="font-mono text-[10px] text-red-400 mt-2">{err}</p>}
      {value.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="forum-attachment-list">
          {value.map((a, i) => (
            <li
              key={a.url}
              className="flex items-center gap-3 border border-[#262626] p-2"
              data-testid={`forum-attachment-${i}`}
            >
              {a.mime?.startsWith("image/") ? (
                <img src={a.url} alt={a.filename} className="w-12 h-12 object-cover" />
              ) : (
                <div className="w-12 h-12 bg-[#1a1a1a] flex items-center justify-center font-mono text-[10px] text-[#ff4500]">
                  {(a.filename || "").split(".").pop()?.toUpperCase() || "FILE"}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-[#e5e5e5] truncate">{a.filename}</div>
                <div className="font-mono text-[10px] text-[#525252]">{Math.round((a.size || 0) / 1024)} KB</div>
              </div>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="font-mono text-[10px] text-[#525252] hover:text-red-400"
                aria-label="Remove attachment"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewThreadForm({ onSaved, categories = FORUM_CATEGORY_FALLBACK, defaultCategory = "general" }) {
  const [t, setT] = useState({ title: "", body: "", category: defaultCategory });
  const [attachments, setAttachments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try { await createForumThread({ ...t, attachments }); onSaved(); }
    catch (e2) { setErr(e2?.response?.data?.detail || "Could not post thread."); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="border border-[#262626] p-5 mb-6 space-y-3" data-testid="thread-new-form">
      <div className="grid md:grid-cols-3 gap-3">
        <input required placeholder="Title" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })}
               className="md:col-span-2 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
               data-testid="thread-title" />
        <select value={t.category} onChange={(e) => setT({ ...t, category: e.target.value })}
                className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
                data-testid="thread-category">
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <textarea required rows={4} placeholder="What do you want to talk about?" value={t.body}
                onChange={(e) => setT({ ...t, body: e.target.value })}
                className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
                data-testid="thread-body" />
      <ForumAttachmentPicker value={attachments} onChange={setAttachments} busy={uploading} onBusy={setUploading} />
      {err && <p className="font-mono text-xs text-red-400" data-testid="thread-error">{err}</p>}
      <button type="submit" disabled={busy || uploading} className="btn-industrial btn-primary disabled:opacity-50" data-testid="thread-submit">
        {busy ? "Posting…" : "Post thread →"}
      </button>
    </form>
  );
}

function AttachmentsList({ items, testIdPrefix = "attachment" }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2" data-testid={`${testIdPrefix}-list`}>
      {items.map((a, i) => (
        <li key={a.url} className="border border-[#262626] hover:border-[#ff4500] transition" data-testid={`${testIdPrefix}-${i}`}>
          {a.mime?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a.filename || "") ? (
            <a href={a.url} target="_blank" rel="noreferrer" className="block">
              <img src={a.url} alt={a.filename} className="w-full aspect-square object-cover" />
            </a>
          ) : (
            <a href={a.url} target="_blank" rel="noreferrer"
               className="block aspect-square flex flex-col items-center justify-center bg-[#1a1a1a] hover:bg-[#222] transition">
              <span className="font-display text-2xl text-[#ff4500]">
                {(a.filename || "FILE").split(".").pop()?.toUpperCase().slice(0, 4) || "FILE"}
              </span>
              <span className="font-mono text-[9px] text-[#a3a3a3] mt-1 px-2 truncate w-full text-center">
                {a.filename}
              </span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function ThreadDetail({ id, me, onBack }) {
  const [data, setData] = useState(null);
  const [body, setBody] = useState("");
  const [replyAttachments, setReplyAttachments] = useState([]);
  const [replyUploading, setReplyUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmModal] = useConfirm();
  const isMod = !!localStorage.getItem("cm_admin_jwt") || !!localStorage.getItem("cm_maker_jwt");
  const seenReplyIdsRef = useRef(new Set());
  const mentionDingRef = useRef(null);
  const refresh = () => fetchForumThread(id).then(setData);
  useEffect(() => { refresh(); }, [id]);

  // Poll for new replies every 12s — but only while the tab is visible.
  // Saves battery + Mongo round-trips when the user has the tab in the
  // background. Refreshes immediately on visibility return.
  useEffect(() => {
    let timer = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => { refresh().catch(() => {}); }, 12000);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        refresh().catch(() => {});       // catch-up on return
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
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
    if (!body.trim() && replyAttachments.length === 0) return;
    setBusy(true);
    try {
      await replyForumThread(id, { body: body || "(see attachment)", attachments: replyAttachments });
      setBody("");
      setReplyAttachments([]);
      refresh();
    } finally { setBusy(false); }
  };
  const delThread = async () => {
    const ok = await confirm({
      title: "Delete this entire thread?",
      body: "The thread and every reply will be removed permanently. This cannot be undone.",
      confirmLabel: "Delete thread",
      tone: "danger",
      testId: "confirm-delete-thread",
    });
    if (!ok) return;
    await deleteForumThread(thread.id);
    onBack();
  };
  const delReply = async (rid) => {
    const ok = await confirm({
      title: "Delete this reply?",
      body: "The reply disappears for everyone. This cannot be undone.",
      confirmLabel: "Delete reply",
      tone: "danger",
      testId: `confirm-delete-reply-${rid}`,
    });
    if (!ok) return;
    await deleteForumReply(rid);
    refresh();
  };
  return (
    <div className="space-y-6" data-testid="thread-detail">
      {confirmModal}
      <button onClick={onBack} className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]" data-testid="thread-back">
        ← back to threads
      </button>
      <div className="border border-[#262626] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              ◆ {thread.tag || "general"} · started by <AuthorLabel name={thread.user_name} email={thread.user_email} />
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
        <AttachmentsList items={thread.attachments} testIdPrefix={`thread-${thread.id}-attachment`} />
      </div>
      {replies.map((r) => {
        const mentioned = isMention(r.body);
        return (
          <div key={r.id}
               className={`border border-[#262626] p-4 ml-6 ${mentioned ? "border-l-2 border-l-[#ff4500] bg-[#ff4500]/5" : ""}`}
               data-testid={mentioned ? "forum-reply-mentioned" : `reply-${r.id}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                <AuthorLabel name={r.user_name} email={r.user_email} />
              </div>
              {isMod && (
                <button onClick={() => delReply(r.id)} className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 hover:text-red-200" data-testid={`reply-mod-delete-${r.id}`}>
                  ⊗
                </button>
              )}
            </div>
            <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed mt-2 whitespace-pre-wrap">{r.body}</p>
            <AttachmentsList items={r.attachments} testIdPrefix={`reply-${r.id}-attachment`} />
          </div>
        );
      })}
      {me && (
        <form onSubmit={reply} className="ml-6 space-y-2" data-testid="reply-form">
          <textarea rows={3} placeholder="Reply… (use @name to mention someone)" value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
                    data-testid="reply-body" />
          <ForumAttachmentPicker value={replyAttachments} onChange={setReplyAttachments} busy={replyUploading} onBusy={setReplyUploading} />
          <button type="submit" disabled={busy || replyUploading} className="btn-industrial btn-primary disabled:opacity-50" data-testid="reply-submit">
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
  const [channel, setChannel] = useState(() => {
    // Honor `?channel=help` deep-link from the floating LiveChatWidget so
    // users can pop the widget open into the full chat without losing context.
    if (typeof window === "undefined") return "general";
    const wanted = new URLSearchParams(window.location.search).get("channel");
    return ["general", "help", "showcase", "makers-only"].includes(wanted) ? wanted : "general";
  });
  const [messagesByCh, setMessagesByCh] = useState({});
  const [buddiesByCh, setBuddiesByCh] = useState({});
  const [unread, setUnread] = useState({});
  const [mentions, setMentions] = useState({}); // per-channel mention count
  const [typing, setTyping] = useState([]);
  const [draft, setDraft] = useState("");
  const [muted, setMuted] = useState(false);
  const [confirm, confirmModal] = useConfirm();
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
  // BUG FIX: Lock the auth tokens to the values present at component mount.
  // Reading `localStorage.getItem("cm_buyer_jwt")` on every render meant
  // that ANY cross-tab localStorage change (e.g. another tab signing
  // in/out, or a normal re-render after localStorage was touched) would
  // flip the dep values for the shadow-socket effect, tearing down all
  // 7 chat sockets and reconnecting them — which kicked the user out
  // of the room and made other users see "X signed off / signed on"
  // every few seconds. The chat session uses whichever account was
  // signed in when the page was opened; a token change requires a
  // page reload (which is what the user expects anyway).
  const tokensRef = useRef(null);
  if (tokensRef.current === null) {
    tokensRef.current = {
      buyer: localStorage.getItem("cm_buyer_jwt") || "",
      maker: localStorage.getItem("cm_maker_jwt") || "",
      admin: localStorage.getItem("cm_admin_jwt") || "",
    };
  }
  const isMaker = !!tokensRef.current.maker;
  const buyerJwt = tokensRef.current.buyer;
  const makerJwt = tokensRef.current.maker;
  const adminJwt = tokensRef.current.admin;
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
      {confirmModal}
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
                        const ok = await confirm({
                          title: "Delete this message?",
                          body: "The message is removed for everyone. This cannot be undone.",
                          confirmLabel: "Delete",
                          tone: "danger",
                          testId: `confirm-delete-chat-msg-${id}`,
                        });
                        if (!ok) return;
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
            #{CHANNEL_LABEL[c] || c}
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
