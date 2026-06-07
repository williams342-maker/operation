/**
 * iter316c — Admin "Feed health" widget.
 *
 * Per-channel snapshot of how each external catalog feed will publish
 * once the next downstream sync pulls it. Surfaces:
 *   • # ready listings
 *   • # blocked listings
 *   • top blocker reasons (missing image, shallow GPC, etc.)
 *   • up-to-5 example blocked listings per channel (click to copy
 *     the slug)
 *
 * Designed to live as a card inside SettingsTab (or any tab — it's
 * self-contained). Reads from `/api/admin/feeds/health` which mirrors
 * the exact eligibility logic used by the live feeds.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import axios from "axios";
import { fetchAdminFeedHealth } from "../../lib/api";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CHANNEL_LABELS = {
  google_merchant: "Google Merchant",
  pinterest: "Pinterest",
  meta: "Meta Commerce",
  enrichlabs: "EnrichLabs API",
  showcase: "Community Showcase",
  design_files: "Free Design Files",
};

const BLOCKER_LABELS = {
  missing_image: "No image",
  missing_price: "Price = $0",
  out_of_stock: "Out of stock",
  shallow_gpc: "GPC < 3 levels",
  short_description: "Description < 50 chars",
  missing_preview: "No thumbnail",
  missing_file_url: "No download URL",
  empty_stub: "Empty stub (no file + no thumb)",
};

export default function FeedHealthCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState({});

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetchAdminFeedHealth();
      setData(r);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load feed health.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const jwt = localStorage.getItem("cm_admin_jwt") || "";
        const r = await axios.get(`${API}/admin/feeds/health`, {
          headers: { Authorization: `Bearer ${jwt}` }, timeout: 30000,
        });
        if (!cancelled) setData(r.data);
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.detail || "Failed to load feed health.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = (channel) => setExpanded((p) => ({ ...p, [channel]: !p[channel] }));

  // iter319b — One-click quarantine of empty design-file stubs.
  // Clears the 155+ leftover test/AI-generated rows that have neither
  // a download URL nor a thumbnail so they stop showing as feed
  // blockers. Idempotent — safe to re-run.
  const [quarantineBusy, setQuarantineBusy] = useState(false);
  const quarantineStubs = async () => {
    if (!window.confirm(
      "Quarantine all empty design-file stubs (rows with no download URL and no thumbnail)?\n\nThis hides them from the public feed but doesn't delete — you can restore later.",
    )) return;
    setQuarantineBusy(true);
    try {
      const jwt = localStorage.getItem("cm_admin_jwt") || "";
      const r = await axios.post(
        `${API}/admin/feeds/design-files/quarantine-stubs`,
        null,
        { headers: { Authorization: `Bearer ${jwt}` } },
      );
      toast.success(`Quarantined ${r.data.quarantined_count} empty stub${r.data.quarantined_count === 1 ? "" : "s"}.`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Quarantine failed.");
    } finally {
      setQuarantineBusy(false);
    }
  };

  // iter319c — Bulk auto-generate thumbnails for design files that
  // have a download URL but no preview. Renders SVG / DXF / STL /
  // raster sources via the auto_thumbnail module on the backend.
  const [autoThumbBusy, setAutoThumbBusy] = useState(false);
  const autoThumb = async () => {
    setAutoThumbBusy(true);
    try {
      const jwt = localStorage.getItem("cm_admin_jwt") || "";
      const r = await axios.post(
        `${API}/admin/feeds/design-files/auto-thumbnail?limit=25`,
        null,
        { headers: { Authorization: `Bearer ${jwt}` }, timeout: 120000 },
      );
      if (r.data.succeeded > 0) {
        toast.success(`Generated ${r.data.succeeded} thumbnail${r.data.succeeded === 1 ? "" : "s"} · ${r.data.failed} skipped.`);
      } else if (r.data.attempted === 0) {
        toast.info("No thumbnailless files to render — feed is clean.");
      } else {
        toast.error(`Couldn't render any thumbnails (${r.data.failed} skipped — sources not renderable).`);
      }
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Auto-thumbnail failed.");
    } finally {
      setAutoThumbBusy(false);
    }
  };

  // iter320 — LLM-powered SEO tag backfill. Same UX shape as autoThumb
  // (one button, batched at 25 per click) but works for either
  // `design-files` or `showcase` surface.
  const [seoBusy, setSeoBusy] = useState({});
  const autoSeo = async (surface) => {
    setSeoBusy((p) => ({ ...p, [surface]: true }));
    try {
      const jwt = localStorage.getItem("cm_admin_jwt") || "";
      const r = await axios.post(
        `${API}/admin/seo/auto-tag/${surface}?limit=25`,
        null,
        { headers: { Authorization: `Bearer ${jwt}` }, timeout: 180000 },
      );
      if (r.data.succeeded > 0) {
        toast.success(`Tagged ${r.data.succeeded} row${r.data.succeeded === 1 ? "" : "s"} · ${r.data.failed} skipped.`);
      } else if (r.data.attempted === 0) {
        toast.info(`No untagged ${surface.replace("-", " ")} — feed is clean.`);
      } else {
        toast.error(`LLM failed on all ${r.data.failed} rows. Re-run to retry.`);
      }
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Auto-tag failed.");
    } finally {
      setSeoBusy((p) => ({ ...p, [surface]: false }));
    }
  };

  // iter338 — Bulk-attach each maker's hero_image_url to showcase
  // posts that have no image. Mirrors the design-files auto-thumb
  // flow: idempotent, batched, only acts on currently-missing rows.
  const [attachBusy, setAttachBusy] = useState(false);
  // iter338b — Per-row Quick Edit modal for blocked design files.
  // Holds the example dict (or null when closed); fields edit
  // locally; Save calls PATCH and reloads feed health.
  const [editing, setEditing] = useState(null);
  const attachMakerImages = async () => {
    setAttachBusy(true);
    try {
      const jwt = localStorage.getItem("cm_admin_jwt") || "";
      const r = await axios.post(
        `${API}/admin/feeds/showcase/auto-attach-maker-image?limit=100`,
        null,
        { headers: { Authorization: `Bearer ${jwt}` }, timeout: 60000 },
      );
      if (r.data.attached > 0) {
        toast.success(`Attached ${r.data.attached} maker image${r.data.attached === 1 ? "" : "s"} · ${r.data.skipped} skipped.`);
      } else if (r.data.attempted === 0) {
        toast.info("No imageless showcase posts — feed is clean.");
      } else {
        toast.error(`Couldn't attach any (${r.data.skipped} skipped — makers without hero images).`);
      }
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Auto-attach failed.");
    } finally {
      setAttachBusy(false);
    }
  };

  if (loading) {
    return (
      <div data-testid="feed-health-card-loading" className="font-mono text-xs text-[#a3a3a3] py-3">
        Loading feed health…
      </div>
    );
  }
  if (err) {
    return (
      <div data-testid="feed-health-card-err" className="font-mono text-xs text-red-400 py-3">
        {err}
      </div>
    );
  }
  if (!data) return null;

  return (
    <section
      className="border border-[#262626] p-5 md:p-6 space-y-4"
      data-testid="feed-health-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
            ◆ Feed health · {data.products_fully_ready}/{data.products_total} fully ready
          </div>
          <h3 className="font-display text-xl uppercase mt-1">Catalog distribution status</h3>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition"
          data-testid="feed-health-refresh"
        >
          ↻ Refresh
        </button>
      </div>
      <p className="font-mono text-xs text-[#a3a3a3] max-w-3xl leading-relaxed">
        Counts per-channel match the exact eligibility rules used by the live feed routes (`shop_feeds.py`,
        `pinterest_feed.py`, `enrichlabs.py`). A listing showing as <span className="text-emerald-400">ready</span>{" "}
        for one channel may still be <span className="text-amber-400">blocked</span> elsewhere because of stricter
        per-channel rules (Pinterest needs ≥50-char descriptions; Meta drops out-of-stock; etc.).
      </p>

      <div className="space-y-2">
        {data.channels.map((c) => {
          const pct = c.total ? Math.round((c.ready / c.total) * 100) : 0;
          const isOpen = expanded[c.channel];
          return (
            <div
              key={c.channel}
              className="border border-[#1f1f1f] hover:border-[#262626] transition"
              data-testid={`feed-health-${c.channel}`}
            >
              <button
                type="button"
                onClick={() => toggle(c.channel)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`inline-block w-1.5 h-1.5 shrink-0 rounded-full ${
                      pct >= 95 ? "bg-emerald-400"
                      : pct >= 80 ? "bg-amber-400"
                      : "bg-red-400"
                    }`}
                  />
                  <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#e5e5e5]">
                    {CHANNEL_LABELS[c.channel] || c.channel}
                  </span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-mono text-[11px] text-emerald-400" data-testid={`feed-health-${c.channel}-ready`}>
                    ✓ {c.ready}
                  </span>
                  {c.blocked > 0 && (
                    <span className="font-mono text-[11px] text-amber-400" data-testid={`feed-health-${c.channel}-blocked`}>
                      ✗ {c.blocked}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-[#525252] w-12 text-right">{pct}%</span>
                  <span className="font-mono text-[10px] text-[#525252]">{isOpen ? "▾" : "▸"}</span>
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-[#1f1f1f] px-4 py-3 space-y-3 bg-[#080808]">
                  {c.top_blockers.length === 0 ? (
                    <p className="font-mono text-[10px] text-emerald-400" data-testid={`feed-health-${c.channel}-clean`}>
                      ✓ No blockers — every eligible listing is ready to publish.
                    </p>
                  ) : (
                    <>
                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1.5">
                          Top blockers
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {c.top_blockers.map((b) => (
                            <span
                              key={b.reason}
                              className="px-2 py-1 border border-amber-500/30 text-amber-300 font-mono text-[10px]"
                              title={data.blocker_glossary?.[b.reason] || ""}
                              data-testid={`feed-health-${c.channel}-blocker-${b.reason}`}
                            >
                              {BLOCKER_LABELS[b.reason] || b.reason} · {b.count}
                            </span>
                          ))}
                        </div>
                      </div>
                      {/* iter319b — surface the one-click cleanup for the
                          design-files channel when empty stubs are
                          contributing to the blocked count. */}
                      {c.channel === "design_files" &&
                       c.top_blockers.some((b) => b.reason === "empty_stub") && (
                        <div className="pt-1">
                          <button
                            onClick={quarantineStubs}
                            disabled={quarantineBusy}
                            className="px-3 py-1.5 border border-red-500/40 text-red-300 hover:bg-red-500/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                            data-testid="feed-health-design-files-quarantine"
                          >
                            {quarantineBusy
                              ? "Quarantining…"
                              : `↯ Quarantine ${c.top_blockers.find((b) => b.reason === "empty_stub")?.count || 0} empty stubs`}
                          </button>
                          <p className="font-mono text-[10px] text-[#525252] mt-1.5 max-w-xl leading-relaxed">
                            Empty stubs (no download URL + no thumbnail) are leftover test or AI-generated rows that pollute the count without being distributable. This hides them from the public feed — restorable from the DB.
                          </p>
                        </div>
                      )}
                      {/* iter319c — surface the auto-thumbnail action when
                          missing_preview rows exist (these have a download
                          URL but no thumbnail — we can render one). */}
                      {c.channel === "design_files" &&
                       c.top_blockers.some((b) => b.reason === "missing_preview") && (
                        <div className="pt-1">
                          <button
                            onClick={autoThumb}
                            disabled={autoThumbBusy}
                            className="px-3 py-1.5 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                            data-testid="feed-health-design-files-auto-thumb"
                          >
                            {autoThumbBusy
                              ? "Rendering thumbnails…"
                              : `⟲ Auto-generate up to 25 thumbnails`}
                          </button>
                          <p className="font-mono text-[10px] text-[#525252] mt-1.5 max-w-xl leading-relaxed">
                            Renders a PNG preview from the source SVG / DXF / STL / image. Up to 25 per click (each render takes a few seconds). Re-run for the next batch.
                          </p>
                        </div>
                      )}
                      {/* iter338 — Showcase: bulk-attach maker hero
                          images to imageless posts. Surfaces only when
                          missing_image is in the top blockers. */}
                      {c.channel === "showcase" &&
                       c.top_blockers.some((b) => b.reason === "missing_image") && (
                        <div className="pt-1">
                          <button
                            onClick={attachMakerImages}
                            disabled={attachBusy}
                            className="px-3 py-1.5 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                            data-testid="feed-health-showcase-attach-maker-image"
                          >
                            {attachBusy
                              ? "Attaching maker images…"
                              : `⟲ Auto-attach maker images (up to 100)`}
                          </button>
                          <p className="font-mono text-[10px] text-[#525252] mt-1.5 max-w-xl leading-relaxed">
                            For showcase posts missing an image, copies the maker&apos;s shop hero image into the post so it can publish to the showcase / Pinterest feed. Skips posts whose maker has no hero image (those need a manual upload).
                          </p>
                        </div>
                      )}
                      {/* iter320 — surface SEO auto-tagging on both
                          design_files and showcase channels. Always
                          available (re-runnable for force-refresh) since
                          a row can have a thumbnail but still lack
                          SEO metadata. */}
                      {(c.channel === "design_files" || c.channel === "showcase") && (
                        <div className="pt-1">
                          <button
                            onClick={() => autoSeo(c.channel === "design_files" ? "design-files" : "showcase")}
                            disabled={seoBusy[c.channel === "design_files" ? "design-files" : "showcase"]}
                            className="px-3 py-1.5 border border-orange-500/40 text-orange-300 hover:bg-orange-500/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                            data-testid={`feed-health-${c.channel}-auto-seo`}
                          >
                            {seoBusy[c.channel === "design_files" ? "design-files" : "showcase"]
                              ? "Tagging…"
                              : `⟲ Auto-tag SEO (up to 25)`}
                          </button>
                          <p className="font-mono text-[10px] text-[#525252] mt-1.5 max-w-xl leading-relaxed">
                            Claude Sonnet 4.5 generates SEO title, meta description, keyword tags, and alt-text for any row missing them. ~$0.001 per row. Skips rows that already have all four fields (use ?force=true to re-tag).
                          </p>
                        </div>
                      )}
                      {c.blocked_examples?.length > 0 && (
                        <div>
                          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1.5">
                            Example blocked listings (click to copy slug)
                          </div>
                          <ul className="space-y-1">
                            {c.blocked_examples.map((ex) => (
                              <li key={ex.slug} className="font-mono text-[10px] flex items-center justify-between gap-3">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(ex.slug);
                                      toast.success(`Slug copied · ${ex.slug}`);
                                    } catch { /* noop */ }
                                  }}
                                  className="text-[#e5e5e5] hover:text-[#ff4500] transition text-left truncate"
                                >
                                  {ex.title || ex.slug}
                                </button>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[#525252]">
                                    {ex.blockers.slice(0, 2).join(" · ")}
                                  </span>
                                  {c.channel === "design_files" && ex.id && (
                                    <button
                                      type="button"
                                      onClick={() => setEditing(ex)}
                                      className="px-2 py-0.5 border border-cyan-700/50 text-cyan-300 hover:bg-cyan-500/10 font-mono text-[9px] uppercase tracking-[0.18em] transition"
                                      data-testid={`feed-health-edit-${ex.id}`}
                                    >
                                      Edit
                                    </button>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="font-mono text-[10px] text-[#525252] pt-2">
        Snapshot · {data.as_of ? new Date(data.as_of).toLocaleString() : "—"}
      </p>

      {/* iter338b — Quick Edit modal for blocked design files */}
      {editing && (
        <QuickEditDesignFile
          example={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </section>
  );
}


// ──────────────────────────────────────────────────────────────────
// iter338b — Quick Edit modal for a single blocked design file.
// Pre-fills thumbnail_url + primary_url + title from the example dict,
// PATCHes the row, then asks the parent to reload feed health.
// ──────────────────────────────────────────────────────────────────
function QuickEditDesignFile({ example, onClose, onSaved }) {
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

