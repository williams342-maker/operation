/**
 * iter338c — Quick Edit modal for a single blocked community showcase post.
 *
 * Sister component to QuickEditDesignFile.jsx. Pre-fills `image_url`,
 * `caption`, and `title` from the example dict, PATCHes the row via
 * `/api/admin/feeds/showcase/{post_id}`, then asks the parent to
 * reload feed health.
 *
 * Props:
 *   - example : the blocked-example object from `/api/admin/feeds/health`
 *               showcase channel (requires `id`, optional `slug`, `title`,
 *               `caption`, `image_url`, `maker_slug`, `blockers[]`).
 *   - onClose : () => void
 *   - onSaved : () => void
 */
import React, { useState } from "react";
import { toast } from "sonner";
import axios from "axios";
import SeoFieldsSection from "./SeoFieldsSection";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function QuickEditShowcase({ example, onClose, onSaved }) {
  const [imageUrl, setImageUrl] = useState(example.image_url || "");
  const [caption, setCaption] = useState(example.caption || "");
  const [title, setTitle] = useState(example.title || "");
  // iter338d — SEO fields (collapsible section)
  const [seoTitle, setSeoTitle] = useState(example.seo_title || "");
  const [seoDescription, setSeoDescription] = useState(example.seo_description || "");
  const [seoTagsCsv, setSeoTagsCsv] = useState((example.seo_tags || []).join(", "));
  const [altText, setAltText] = useState(example.alt_text || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const payload = {};
    if (imageUrl !== (example.image_url || "")) payload.image_url = imageUrl.trim();
    if (caption !== (example.caption || "")) payload.caption = caption.trim();
    if (title !== (example.title || "")) payload.title = title.trim();
    if (seoTitle !== (example.seo_title || "")) payload.seo_title = seoTitle.trim();
    if (seoDescription !== (example.seo_description || "")) payload.seo_description = seoDescription.trim();
    const originalTagsCsv = (example.seo_tags || []).join(", ");
    if (seoTagsCsv !== originalTagsCsv) payload.seo_tags = seoTagsCsv; // server normalizes
    if (altText !== (example.alt_text || "")) payload.alt_text = altText.trim();
    if (Object.keys(payload).length === 0) {
      toast.info("No changes to save.");
      return;
    }
    setSaving(true);
    try {
      const jwt = localStorage.getItem("cm_admin_jwt") || "";
      await axios.patch(
        `${API}/admin/feeds/showcase/${example.id}`,
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
      className="fixed inset-0 bg-paper/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="quick-edit-showcase-modal"
    >
      <div
        className="bg-paper border border-line max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-emerald-700 mb-1">
              Quick Edit · Showcase Post
            </div>
            <div className="font-display text-xl text-ink truncate">
              {example.title || example.slug}
            </div>
            <div className="font-mono text-[10px] text-ink-muted mt-1 truncate">
              maker: {example.maker_slug || "—"} · id: {example.id}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-ink font-mono text-lg leading-none shrink-0 ml-3"
            data-testid="quick-edit-showcase-close"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Title
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled"
              className="mt-1 w-full bg-paper border border-line focus:border-emerald-400 px-3 py-2 font-mono text-sm text-ink outline-none"
              data-testid="quick-edit-showcase-title"
            />
          </label>

          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Image URL <span className="text-red-400">{example.blockers.includes("missing_image") && "* missing"}</span>
            </span>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…/photo.jpg"
              className="mt-1 w-full bg-paper border border-line focus:border-emerald-400 px-3 py-2 font-mono text-sm text-ink outline-none"
              data-testid="quick-edit-showcase-image-url"
            />
            {imageUrl && (
              <img
                src={imageUrl}
                alt="Preview"
                className="mt-2 max-h-32 border border-line"
                onError={(e) => { e.target.style.display = "none"; }}
              />
            )}
          </label>

          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              Caption
            </span>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Describe the build, materials, or process…"
              rows={3}
              className="mt-1 w-full bg-paper border border-line focus:border-emerald-400 px-3 py-2 font-mono text-sm text-ink outline-none resize-none"
              data-testid="quick-edit-showcase-caption"
            />
          </label>
        </div>

        <SeoFieldsSection
          values={{ seoTitle, seoDescription, seoTagsCsv, altText }}
          setters={{ setSeoTitle, setSeoDescription, setSeoTagsCsv, setAltText }}
          testidPrefix="quick-edit-showcase"
          focusBorder="focus:border-emerald-400"
        />

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-2 border border-line hover:border-ink-muted font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted"
            data-testid="quick-edit-showcase-cancel"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-emerald-400 text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="quick-edit-showcase-save"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
