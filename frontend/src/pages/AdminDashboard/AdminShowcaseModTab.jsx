import React, { useEffect, useState, useCallback } from "react";
import { Check, Star, Pencil, Trash2, Filter, AlertTriangle, ShieldCheck, ShieldOff, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  adminListShowcase, adminEditShowcase, adminApproveShowcase, adminDeleteShowcase,
  adminShowcaseModStats,
} from "../../lib/api";

/**
 * AdminShowcaseModTab
 * -------------------
 * Per-post moderation queue for community showcase posts.
 *
 * Surfaces:
 *   • Filter chips: All · Pending · Approved · Featured
 *   • Card grid showing cover image OR video clip + title/description/poster
 *   • Inline actions per card:
 *       - Approve (idempotent flag, sets mod_status=approved)
 *       - Feature (promotes to mod_status=featured — surfaces in feeds)
 *       - Edit title / description
 *       - Delete (snapshot kept in admin_moderation_actions audit log)
 *
 * Backend endpoints:
 *   GET    /admin/community/showcase?status=…&limit=…&skip=…
 *   PATCH  /admin/community/showcase/{id}
 *   POST   /admin/community/showcase/{id}/approve   (body: {featured: bool})
 *   DELETE /admin/community/showcase/{id}
 */
const STATUS_OPTIONS = [
  { id: "all",          label: "All" },
  { id: "quarantined",  label: "Quarantined" },
  { id: "reported",     label: "Reported" },
  { id: "pending",      label: "Pending" },
  { id: "approved",     label: "Approved" },
  { id: "featured",     label: "Featured" },
];

const PAGE_SIZE = 24;

export default function AdminShowcaseModTab() {
  const [filter, setFilter] = useState("all");
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  const refresh = useCallback(async () => {
    setRows(null);
    try {
      const r = await adminListShowcase({
        status: filter,
        limit: PAGE_SIZE,
        skip: page * PAGE_SIZE,
      });
      setRows(r.rows || []);
      setTotal(r.total || 0);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load showcase posts.");
      setRows([]);
    }
  }, [filter, page]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="space-y-6" data-testid="admin-showcase-mod-tab">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">
          ◆ Community moderation
        </div>
        <h1 className="font-display text-3xl md:text-5xl uppercase leading-none">Showcase</h1>
        <p className="font-mono text-sm text-[#a3a3a3] mt-2">
          Approve, feature, edit, or remove community showcase posts. Featured posts surface higher in the homepage + product strip feeds.
        </p>
      </div>

      <ModStatsBlock onFilter={(k) => { setFilter(k); setPage(0); }} />

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={14} className="text-[#525252]" />
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => { setFilter(s.id); setPage(0); }}
            className={`font-mono text-[10px] uppercase tracking-[0.22em] px-3 py-1.5 border transition ${
              filter === s.id
                ? "border-[#ff4500] text-[#ff4500] bg-[#ff4500]/10"
                : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500] hover:text-[#ff4500]"
            }`}
            data-testid={`admin-showcase-filter-${s.id}`}
          >
            {s.label}
          </button>
        ))}
        <span className="font-mono text-[10px] text-[#525252] ml-2" data-testid="admin-showcase-total">
          {total} total
        </span>
      </div>

      {/* Grid */}
      {rows === null ? (
        <p className="font-mono text-sm text-[#a3a3a3]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="font-mono text-sm text-[#a3a3a3]" data-testid="admin-showcase-empty">
          No posts match this filter.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="admin-showcase-grid">
          {rows.map((p) => (
            <AdminShowcaseCard key={p.id} post={p} onChanged={refresh} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex justify-between items-center pt-4 border-t border-[#262626]">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] disabled:opacity-30"
            data-testid="admin-showcase-prev"
          >
            ← Prev
          </button>
          <span className="font-mono text-[10px] text-[#525252]">
            Page {page + 1} / {Math.ceil(total / PAGE_SIZE)}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * PAGE_SIZE >= total}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] disabled:opacity-30"
            data-testid="admin-showcase-next"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}


function AdminShowcaseCard({ post, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: post.title || "", description: post.description || "" });
  const [busy, setBusy] = useState(false);

  const cover = (post.image_urls && post.image_urls[0]) || post.image_url;
  const hasVideo = !!post.video_url;
  const status = post.mod_status || "pending";

  const doAction = async (label, fn) => {
    setBusy(true);
    try {
      await fn();
      toast.success(`${label}.`);
      onChanged && onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || `Couldn't ${label.toLowerCase()}.`);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    const title = draft.title.trim();
    const description = draft.description.trim();
    if (!title || !description) {
      toast.error("Title and description are required.");
      return;
    }
    await doAction("Saved", () => adminEditShowcase(post.id, { title, description }));
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!window.confirm("Permanently delete this post? A snapshot is kept in the moderation audit log.")) return;
    await doAction("Deleted", () => adminDeleteShowcase(post.id));
  };

  return (
    <div className="border border-[#262626] overflow-hidden" data-testid={`admin-showcase-card-${post.id}`}>
      <div className="aspect-[4/3] bg-[#121212] relative">
        {hasVideo ? (
          <video src={post.video_url} poster={cover || undefined} controls playsInline preload="metadata" className="w-full h-full object-cover bg-black" />
        ) : cover ? (
          <img src={cover} alt={post.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center font-mono text-xs text-[#525252]">no media</div>
        )}
        {hasVideo && (
          <span className="absolute top-2 left-2 bg-[#ff4500] text-[#0a0a0a] font-mono text-[9px] uppercase tracking-[0.18em] px-2 py-1 font-bold">◆ Video</span>
        )}
        {post.open_reports > 0 && (
          <span
            className="absolute bottom-2 left-2 bg-red-500 text-white font-mono text-[9px] uppercase tracking-[0.18em] px-2 py-1 font-bold flex items-center gap-1"
            data-testid={`admin-showcase-${post.id}-reports`}
          >
            ⚠ {post.open_reports} report{post.open_reports === 1 ? "" : "s"}
          </span>
        )}
        <span
          className={`absolute top-2 right-2 font-mono text-[9px] uppercase tracking-[0.18em] px-2 py-1 font-bold ${
            status === "featured" ? "bg-yellow-500 text-[#0a0a0a]"
            : status === "approved" ? "bg-emerald-500 text-[#0a0a0a]"
            : status === "quarantined" ? "bg-red-600 text-white"
            : status === "reported" ? "bg-orange-500 text-[#0a0a0a]"
            : "bg-[#0a0a0a]/85 text-[#a3a3a3] border border-[#262626]"
          }`}
          data-testid={`admin-showcase-status-${post.id}`}
        >
          {post.auto_quarantined && status === "quarantined" ? "⚠ AUTO" : status}
        </span>
      </div>
      <div className="p-4 space-y-3">
        {editing ? (
          <>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
              data-testid={`admin-showcase-${post.id}-edit-title`}
            />
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              className="w-full bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs resize-y"
              data-testid={`admin-showcase-${post.id}-edit-description`}
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave} disabled={busy}
                className="btn-industrial btn-primary text-[10px] px-3 py-2 disabled:opacity-50"
                data-testid={`admin-showcase-${post.id}-edit-save`}
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setEditing(false); setDraft({ title: post.title, description: post.description }); }}
                disabled={busy}
                className="btn-industrial btn-secondary text-[10px] px-3 py-2 disabled:opacity-50"
                data-testid={`admin-showcase-${post.id}-edit-cancel`}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="font-display text-lg leading-tight">{post.title}</div>
            <p className="font-mono text-[11px] text-[#a3a3a3] leading-relaxed line-clamp-3">{post.description}</p>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#525252]">
              <div>By: {post.user_name || post.user_email}</div>
              <div className="mt-1">Role: {post.user_role || "buyer"} · {new Date(post.created_at).toLocaleDateString()}</div>
              {post.maker_slug && <div className="mt-1">Maker: @{post.maker_slug}</div>}
            </div>

            {/* Action row */}
            <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[#262626]">
              <button
                onClick={() => doAction("Approved", () => adminApproveShowcase(post.id))}
                disabled={busy}
                className="font-mono text-[10px] uppercase tracking-[0.22em] border border-emerald-500 text-emerald-400 hover:bg-emerald-500/10 px-2 py-1 flex items-center gap-1 disabled:opacity-50"
                data-testid={`admin-showcase-${post.id}-approve`}
              >
                <Check size={11} /> Approve
              </button>
              <button
                onClick={() => doAction("Featured", () => adminApproveShowcase(post.id, { featured: true }))}
                disabled={busy}
                className="font-mono text-[10px] uppercase tracking-[0.22em] border border-yellow-500 text-yellow-400 hover:bg-yellow-500/10 px-2 py-1 flex items-center gap-1 disabled:opacity-50"
                data-testid={`admin-showcase-${post.id}-feature`}
              >
                <Star size={11} /> Feature
              </button>
              <button
                onClick={() => setEditing(true)}
                disabled={busy}
                className="font-mono text-[10px] uppercase tracking-[0.22em] border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] px-2 py-1 flex items-center gap-1 disabled:opacity-50"
                data-testid={`admin-showcase-${post.id}-edit`}
              >
                <Pencil size={11} /> Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="font-mono text-[10px] uppercase tracking-[0.22em] border border-red-500/60 text-red-400 hover:bg-red-500/10 px-2 py-1 flex items-center gap-1 disabled:opacity-50"
                data-testid={`admin-showcase-${post.id}-delete`}
              >
                <Trash2 size={11} /> Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}



/**
 * ModStatsBlock — at-a-glance moderation health card.
 *
 * Six metrics in a responsive grid:
 *   • Pending review / Reported (open flags) / Quarantined  — actionable
 *   • Approved 24h / Removed 24h / Auto-quarantined 24h     — activity
 *
 * Each "actionable" card is also a button — clicking it sets the parent
 * filter so the operator can jump straight from the metric to the queue.
 */
function ModStatsBlock({ onFilter }) {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    adminShowcaseModStats()
      .then((d) => { if (!cancelled) setStats(d); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.detail || "Couldn't load mod stats."); });
    return () => { cancelled = true; };
  }, []);

  if (err) {
    return (
      <div className="border border-amber-500/40 bg-amber-500/5 p-3 font-mono text-xs text-amber-200" data-testid="mod-stats-error">
        {err}
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2" data-testid="mod-stats-loading">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border border-[#262626] bg-[#0d0d0d] p-3 animate-pulse">
            <div className="h-2 w-16 bg-[#1a1a1a] mb-2" />
            <div className="h-6 w-10 bg-[#1a1a1a]" />
          </div>
        ))}
      </div>
    );
  }

  const cells = [
    { k: "pending_review", label: "Pending", icon: Clock, tone: "amber",
      filter: "pending", testid: "mod-stat-pending" },
    { k: "reported", label: "Reported", icon: AlertTriangle, tone: stats.reported > 0 ? "red" : "neutral",
      filter: "reported", testid: "mod-stat-reported" },
    { k: "quarantined", label: "Quarantined", icon: ShieldOff, tone: stats.quarantined > 0 ? "red" : "neutral",
      filter: "quarantined", testid: "mod-stat-quarantined" },
    { k: "approved_24h", label: "Approved · 24h", icon: ShieldCheck, tone: "emerald",
      testid: "mod-stat-approved-24h" },
    { k: "removed_24h", label: "Removed · 24h", icon: Trash2, tone: "neutral",
      testid: "mod-stat-removed-24h" },
    { k: "auto_quarantined_24h", label: "Auto-quar · 24h", icon: ShieldOff, tone: "neutral",
      testid: "mod-stat-auto-quarantined-24h" },
  ];

  const toneClasses = {
    amber: "text-amber-400 border-amber-500/40",
    red: "text-red-400 border-red-500/50",
    emerald: "text-emerald-400 border-emerald-500/30",
    neutral: "text-[#a3a3a3] border-[#262626]",
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2" data-testid="mod-stats-block">
      {cells.map(({ k, label, icon: Icon, tone, filter, testid }) => {
        const n = stats[k] ?? 0;
        const clickable = !!filter;
        const cls = `border bg-[#0d0d0d] p-3 transition ${toneClasses[tone] || toneClasses.neutral} ${
          clickable ? "hover:bg-[#ff4500]/5 hover:border-[#ff4500] cursor-pointer" : ""
        }`;
        const inner = (
          <>
            <div className="flex items-center gap-1.5 mb-1">
              <Icon size={11} />
              <span className="font-mono text-[9px] uppercase tracking-[0.22em]">{label}</span>
            </div>
            <div className="font-display text-2xl text-[#e5e5e5]">{n}</div>
          </>
        );
        return clickable ? (
          <button
            key={k}
            type="button"
            className={cls + " text-left"}
            onClick={() => onFilter(filter)}
            data-testid={testid}
          >
            {inner}
          </button>
        ) : (
          <div key={k} className={cls} data-testid={testid}>{inner}</div>
        );
      })}
    </div>
  );
}
