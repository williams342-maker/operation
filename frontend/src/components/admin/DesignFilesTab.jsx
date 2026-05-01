/**
 * Admin · Design Files Tab
 *
 * Full index of every design file uploaded to the community library.
 * Distinct from the existing "File Reports" tab — that one is the
 * moderation queue triggered by user flags. THIS tab is for browsing all
 * files (reported or not) and performing direct admin actions:
 *   • Quarantine (soft-delete, hides from public list)
 *   • Unquarantine (restore)
 *   • DELETE (hard-delete: removes R2 objects + DB rows + reports + downloads)
 *
 * The DELETE action is irreversible and gated by a typed-confirmation
 * dialog so it's not something a tired admin can fire accidentally.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Search, Trash2, AlertTriangle, ExternalLink, Eye, EyeOff, Loader2 } from "lucide-react";
import {
  fetchAdminDesignFiles,
  adminDeleteDesignFile,
  unquarantineDesignFile,
} from "../../lib/api";
import EmptyState from "../EmptyState";
import { timeAgo } from "../../lib/timeAgo";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "quarantined", label: "Quarantined" },
];

export default function DesignFilesTab() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null); // file row
  const [busy, setBusy] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter === "live") params.quarantined = false;
      else if (filter === "quarantined") params.quarantined = true;
      if (search.trim()) params.q = search.trim();
      const r = await fetchAdminDesignFiles(params);
      setItems(r.items || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load files.");
    } finally {
      setLoading(false);
    }
  };

  // Debounce search → refresh
  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search]);

  const onUnquarantine = async (id) => {
    setBusy(id);
    try {
      await unquarantineDesignFile(id);
      toast.success("File restored to public list.");
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't unquarantine.");
    } finally {
      setBusy("");
    }
  };

  const onDelete = async (file) => {
    setBusy(file.id);
    try {
      const r = await adminDeleteDesignFile(file.id);
      toast.success(
        `Deleted "${file.title || file.id}" — ${r.r2_keys_purged} R2 object${r.r2_keys_purged === 1 ? "" : "s"}, ${r.reports_purged} report${r.reports_purged === 1 ? "" : "s"} purged.`,
      );
      setConfirmDelete(null);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-5" data-testid="admin-design-files-tab">
      <header>
        <h2 className="font-display text-3xl text-[#e5e5e5]">Design Files</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-1 max-w-2xl leading-relaxed">
          Every community-uploaded design file. Quarantine hides a file
          without destroying it (reversible). <b className="text-red-400">Delete</b>{" "}
          permanently removes the R2 objects + DB rows + every report and
          download record tied to it (irreversible).
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex border border-[#262626]" data-testid="design-files-filter">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                data-testid={`design-files-filter-${f.id}`}
                className={`px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                  active ? "bg-[#ff4500] text-black" : "text-[#a3a3a3] hover:text-[#e5e5e5]"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#525252]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, maker, uploader…"
            className="w-full pl-9 pr-3 py-2 bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none font-mono text-xs text-[#e5e5e5]"
            data-testid="design-files-search"
          />
        </div>
        <span className="font-mono text-[10px] text-[#525252] ml-auto">
          {items.length} file{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[#a3a3a3] font-mono text-xs">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : !items.length ? (
        <EmptyState
          title="No files match."
          subtitle="Adjust the filter or clear the search."
          icon={Eye}
        />
      ) : (
        <div className="border border-[#262626] divide-y divide-[#1a1a1a]" data-testid="design-files-list">
          {items.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              busy={busy === f.id}
              onUnquarantine={() => onUnquarantine(f.id)}
              onAskDelete={() => setConfirmDelete(f)}
            />
          ))}
        </div>
      )}

      {confirmDelete && (
        <DeleteConfirmDialog
          file={confirmDelete}
          busy={busy === confirmDelete.id}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => onDelete(confirmDelete)}
        />
      )}
    </div>
  );
}

function FileRow({ file, busy, onUnquarantine, onAskDelete }) {
  const isQ = !!file.quarantined_at;
  const sizeMB = file.size_bytes ? (file.size_bytes / 1024 / 1024).toFixed(1) : null;
  return (
    <div className="px-5 py-4 flex items-start gap-4" data-testid={`design-file-row-${file.id}`}>
      {file.thumbnail_url ? (
        <img
          src={file.thumbnail_url}
          alt=""
          className="w-16 h-16 object-cover border border-[#262626] shrink-0"
        />
      ) : (
        <div className="w-16 h-16 border border-[#262626] bg-[#0a0a0a] shrink-0 flex items-center justify-center font-mono text-[9px] uppercase text-[#525252]">
          {file.file_type?.toUpperCase() || "FILE"}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-[#e5e5e5] font-bold truncate max-w-md">
            {file.title || file.id}
          </span>
          {file.file_type && (
            <span className="px-2 py-0.5 border border-[#262626] text-[#a3a3a3] font-mono text-[9px] uppercase tracking-[0.22em]">
              {file.file_type}
            </span>
          )}
          {isQ && (
            <span className="px-2 py-0.5 border border-amber-500/50 text-amber-400 bg-amber-500/10 font-mono text-[9px] uppercase tracking-[0.22em]">
              <EyeOff size={10} className="inline mr-1" />Quarantined
            </span>
          )}
          {file.open_reports > 0 && (
            <span className="px-2 py-0.5 border border-red-500/50 text-red-400 bg-red-500/10 font-mono text-[9px] uppercase tracking-[0.22em]">
              {file.open_reports} report{file.open_reports === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] text-[#a3a3a3] mt-1">
          By {file.maker_name || file.uploader_name || file.uploader_id || "anonymous"}
          <span className="text-[#525252]"> · {timeAgo(file.created_at)}</span>
          {sizeMB && <span className="text-[#525252]"> · {sizeMB} MB</span>}
          {typeof file.download_count === "number" && (
            <span className="text-[#525252]"> · {file.download_count} download{file.download_count === 1 ? "" : "s"}</span>
          )}
        </div>
        {file.download_url && (
          <a
            href={file.download_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500]"
            data-testid={`design-file-link-${file.id}`}
          >
            <ExternalLink size={10} /> Open file
          </a>
        )}
      </div>
      <div className="flex flex-col gap-2 shrink-0">
        {isQ && (
          <button
            type="button"
            onClick={onUnquarantine}
            disabled={busy}
            className="px-3 py-1.5 border border-[#262626] hover:border-emerald-500/60 hover:text-emerald-400 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
            data-testid={`design-file-restore-${file.id}`}
          >
            <Eye size={12} className="inline mr-1" />Restore
          </button>
        )}
        <button
          type="button"
          onClick={onAskDelete}
          disabled={busy}
          className="px-3 py-1.5 border border-red-500/40 text-red-400 hover:bg-red-500/10 hover:border-red-500 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          data-testid={`design-file-delete-${file.id}`}
        >
          <Trash2 size={12} className="inline mr-1" />{busy ? "…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({ file, busy, onCancel, onConfirm }) {
  const [typed, setTyped] = useState("");
  const required = "DELETE";
  const ok = typed === required;
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
      onClick={onCancel}
      data-testid="design-file-delete-confirm"
    >
      <div
        className="bg-[#0a0a0a] border border-red-500/40 w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-red-400">
          <AlertTriangle size={14} /> Permanent delete
        </div>
        <h3 className="font-display text-2xl mt-2 text-[#e5e5e5]">
          Delete "{file.title || file.id}"?
        </h3>
        <p className="font-mono text-xs text-[#a3a3a3] mt-3 leading-relaxed">
          This <b className="text-red-400">cannot be undone</b>. The R2 object, every report tied to this file, and every download record will be purged. If you just want to hide the file from the public list, click <b>Quarantine</b> from the File Reports tab instead.
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-5">
          Type <span className="text-red-400">{required}</span> to confirm:
        </p>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          className="w-full mt-2 bg-[#0a0a0a] border border-[#262626] focus:border-red-500 outline-none px-3 py-2 font-mono text-sm text-[#e5e5e5]"
          data-testid="design-file-delete-confirm-input"
        />
        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-3 py-2 border border-[#262626] hover:border-[#a3a3a3] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]"
            data-testid="design-file-delete-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!ok || busy}
            className="flex-1 px-3 py-2 border border-red-500 bg-red-500/10 hover:bg-red-500/20 font-mono text-[10px] uppercase tracking-[0.22em] text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid="design-file-delete-confirm-btn"
          >
            {busy ? "Deleting…" : "Delete forever →"}
          </button>
        </div>
      </div>
    </div>
  );
}
