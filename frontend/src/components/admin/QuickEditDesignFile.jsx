/**
 * iter338b — Quick Edit modal for a single blocked design file.
 *
 * Extracted from FeedHealthCard.jsx (iter338c refactor — split for
 * readability; behavior unchanged).
 *
 * Pre-fills `thumbnail_url`, `primary_url`, and `title` from the
 * example dict passed in via props, PATCHes the row through
 * `/api/admin/feeds/design-files/{id}`, then asks the parent to
 * reload feed health via `onSaved()`.
 *
 * Props:
 *   - example : the blocked-example object from `/api/admin/feeds/health`
 *               (requires `id`, optional `slug`, `title`, `thumbnail_url`,
 *               `primary_url`, `blockers[]`).
 *   - onClose : () => void — close without saving.
 *   - onSaved : () => void — invoked on successful PATCH.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function QuickEditDesignFile({ example, onClose, onSaved }) {
  const [thumbnailUrl, setThumbnailUrl] = useState(example.thumbnail_url || "");
  const [primaryUrl, setPrimaryUrl] = useState(example.primary_url || "");
  const [title, setTitle] = useState(example.title || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const payload = {};
    if (thumbnailUrl !== (example.thumbnail_url || "")) payload.thumbnail_url = thumbnailUrl.trim();
    if (primaryUrl !== (example.primary_url || "")) payload.primary_url = primaryUrl.trim();
    if (title !== (example.title || "")) payload.title = title.trim();
    if (Object.keys(payload).length === 0) {
      toast.info("No changes to save.");
      return;
    }
    setSaving(true);
    try {
      const jwt = localStorage.getItem("cm_admin_jwt") || "";
      await axios.patch(
        `${API}/admin/feeds/design-files/${example.id}`,
        payload,
        { headers: { Authorization: `Bearer ${jwt}` }, timeout: 30000 },
      );
      toast.success(`Saved · ${Object.keys(payload).length} field${Object.keys(payload).length === 1 ? "" : "s"} updated.`);
      onSaved?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="quick-edit-design-file-modal"
    >
      <div
        className="bg-[#0a0a0a] border border-[#262626] max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-300 mb-1">
              Quick Edit · Design File
            </div>
            <div className="font-display text-xl text-[#f5f5f5] truncate">
              {example.title || example.slug}
            </div>
            <div className="font-mono text-[10px] text-[#737373] mt-1 truncate">
              id: {example.id}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#737373] hover:text-[#f5f5f5] font-mono text-lg leading-none"
            data-testid="quick-edit-close"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              Title
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled"
              className="mt-1 w-full bg-[#050505] border border-[#262626] focus:border-cyan-400 px-3 py-2 font-mono text-sm text-[#f5f5f5] outline-none"
              data-testid="quick-edit-title"
            />
          </label>

          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              Thumbnail URL <span className="text-red-400">{example.blockers.includes("missing_preview") && "* missing"}</span>
            </span>
            <input
              type="url"
              value={thumbnailUrl}
              onChange={(e) => setThumbnailUrl(e.target.value)}
              placeholder="https://…/preview.png"
              className="mt-1 w-full bg-[#050505] border border-[#262626] focus:border-cyan-400 px-3 py-2 font-mono text-sm text-[#f5f5f5] outline-none"
              data-testid="quick-edit-thumbnail-url"
            />
            {thumbnailUrl && (
              <img
                src={thumbnailUrl}
                alt="Preview"
                className="mt-2 max-h-32 border border-[#262626]"
                onError={(e) => { e.target.style.display = "none"; }}
              />
            )}
          </label>

          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
              Primary File URL <span className="text-red-400">{example.blockers.includes("missing_file_url") && "* missing"}</span>
            </span>
            <input
              type="url"
              value={primaryUrl}
              onChange={(e) => setPrimaryUrl(e.target.value)}
              placeholder="https://…/file.svg"
              className="mt-1 w-full bg-[#050505] border border-[#262626] focus:border-cyan-400 px-3 py-2 font-mono text-sm text-[#f5f5f5] outline-none"
              data-testid="quick-edit-primary-url"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-2 border border-[#262626] hover:border-[#525252] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]"
            data-testid="quick-edit-cancel"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-cyan-400 text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="quick-edit-save"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
