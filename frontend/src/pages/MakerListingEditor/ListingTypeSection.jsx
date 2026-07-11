import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, X, Upload, AlertCircle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Section } from "./FormControls";
import { uploadDigitalFile } from "../../lib/chunkedUpload"; // iter453
import { updateDigitalSettings } from "../../lib/api"; // iter453

/**
 * iter327 — Listing type selector + digital file uploader.
 *
 * Renders three sub-controls in one card:
 *   1. Radio strip — physical / digital / both
 *   2. (digital + both only) — drag-drop / click-to-upload zone for
 *      digital deliverables (SVG/DXF/DWG/AI/EPS/STL/STEP/PDF/ZIP, ≤25 MB
 *      each, 10 files max).
 *   3. Uploaded-file manifest with per-row delete.
 *
 * Files are uploaded immediately on selection via
 *   POST /api/maker/listings/{slug}/digital-files
 * NOT inside the main form submit. This lets the editor save the file
 * metadata even if the maker abandons the rest of the form, and avoids
 * stuffing 25 MB of base64 into the create/update JSON payload.
 *
 * The listing must exist first — so this card auto-hides on the create
 * path (no productSlug yet) with a "Save as draft first to upload
 * files" hint, matching how the photo grid behaves on first save.
 */
const TYPE_OPTIONS = [
  {
    value: "physical",
    label: "Physical",
    blurb: "Ship the item to the buyer.",
  },
  {
    value: "digital",
    label: "Digital",
    blurb: "Instant download · no shipping.",
  },
  {
    value: "both",
    label: "Physical + Digital",
    blurb: "Ship + include source files.",
  },
];

const ALLOWED_EXTS = ["pdf", "svg", "dxf", "dwg", "ai", "eps", "stl", "step", "stp",
  "3mf", "zip", "png", "jpg", "jpeg", "epub", "mp3", "mp4"];
const MAX_BYTES = 100 * 1024 * 1024; // iter453 — 100MB via chunked uploads
const MAX_FILES = 5;                 // iter453 — new cap (legacy 10-file listings grandfathered)

function formatBytes(n) {
  if (!n) return "0 KB";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ListingTypeSection({ form, set, productSlug, api }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef(null);

  const isDigital = form.listing_type === "digital" || form.listing_type === "both";
  const files = form.digital_files || [];
  const atCap = files.length >= Math.max(MAX_FILES, Math.min(files.length, 10));
  const needsSave = isDigital && !productSlug;

  const uploadFile = async (file, replaceFileId = null, releaseNotes = null) => {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      toast.error(`File type ".${ext}" not allowed`, {
        description: `Allowed: ${ALLOWED_EXTS.map((e) => "." + e).join(" · ")}`,
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File too large", {
        description: `${file.name} is ${formatBytes(file.size)} · max is ${formatBytes(MAX_BYTES)}`,
      });
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const entry = await uploadDigitalFile({
        productSlug, file, replaceFileId, releaseNotes,
        onProgress: setProgress,
      });
      if (replaceFileId) {
        set({ digital_files: files.map((f) => (f.id === replaceFileId ? entry : f)) });
        toast.success(`New version uploaded (v${entry.version})`, { description: entry.filename });
      } else {
        set({ digital_files: [...files, entry] });
        toast.success("File uploaded & scanned", { description: entry.filename });
      }
    } catch (e) {
      toast.error("Upload failed", { description: e.message || "Try again." });
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleReplace = (entry) => {
    const notes = window.prompt(
      `Uploading a new version of "${entry.filename}".\nOptional release notes for buyers (leave blank to skip):`, "");
    if (notes === null) return;
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ALLOWED_EXTS.map((e) => "." + e).join(",");
    picker.onchange = () => {
      const f = picker.files?.[0];
      if (f) uploadFile(f, entry.id, notes.trim() || null);
    };
    picker.click();
  };

  const handlePick = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = ""; // reset so the same file can be re-picked
    const room = MAX_FILES - files.length;
    if (picked.length > room) {
      toast.warning(`Max ${MAX_FILES} files — only the first ${room} will be uploaded.`);
    }
    picked.slice(0, room).forEach(uploadFile);
  };

  const handleRemove = async (entry) => {
    if (!window.confirm(`Remove "${entry.filename}" from this listing?`)) return;
    try {
      const token = localStorage.getItem("cm_maker_jwt");
      const res = await fetch(
        `${api}/api/maker/listings/${encodeURIComponent(productSlug)}/digital-files/${entry.id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set({ digital_files: files.filter((f) => f.id !== entry.id) });
      toast.success("Removed");
    } catch (e) {
      toast.error("Remove failed", { description: e.message || "Try again." });
    }
  };

  return (
    <Section
      eyebrow="◆ Fulfilment"
      title="Listing Type"
      subtitle="Sell a physical item, an instant digital download, or bundle both. Digital files are delivered automatically after payment."
    >
      {/* Type selector */}
      <div
        className="grid md:grid-cols-3 gap-2 mb-6"
        role="radiogroup"
        data-testid="editor-listing-type-radio"
      >
        {TYPE_OPTIONS.map((opt) => {
          const selected = form.listing_type === opt.value;
          return (
            <button
              type="button"
              key={opt.value}
              role="radio"
              aria-checked={selected}
              onClick={() => set({ listing_type: opt.value })}
              className={`text-left p-4 border transition ${
                selected
                  ? "border-brand bg-brand/[0.08]"
                  : "border-line hover:border-line"
              }`}
              data-testid={`editor-listing-type-${opt.value}`}
            >
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink">
                {opt.label}
              </div>
              <div className="font-mono text-[10px] text-ink-muted mt-1.5">
                {opt.blurb}
              </div>
              {selected && (
                <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-brand mt-2">
                  ◆ Selected
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Digital file uploader */}
      {isDigital && (
        <div data-testid="editor-digital-files-card">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink">
              Digital deliverables
            </div>
            <div className="font-mono text-[10px] text-ink-muted">
              {files.length} / {MAX_FILES} files
            </div>
          </div>

          {needsSave && (
            <div className="flex items-start gap-2 p-3 border border-amber-500/40 bg-amber-500/[0.08] mb-3">
              <AlertCircle size={14} className="text-brand shrink-0 mt-0.5" />
              <div className="font-mono text-[10.5px] text-ink leading-relaxed">
                Save this listing as draft first — then come back to upload files.
              </div>
            </div>
          )}

          {!needsSave && !atCap && (
            <>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ALLOWED_EXTS.map((e) => "." + e).join(",")}
                onChange={handlePick}
                className="hidden"
                data-testid="editor-digital-files-input"
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="w-full p-6 border border-dashed border-line hover:border-brand disabled:opacity-50 transition flex flex-col items-center gap-2"
                data-testid="editor-digital-files-upload-btn"
              >
                {uploading ? (
                  <>
                    <Loader2 size={20} className="text-brand animate-spin" />
                    <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink">
                      Uploading… {progress}%
                    </span>
                  </>
                ) : (
                  <>
                    <Upload size={20} className="text-ink-muted" />
                    <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink">
                      Click to upload digital files
                    </span>
                    <span className="font-mono text-[9.5px] text-ink-muted">
                      {ALLOWED_EXTS.map((e) => "." + e).join(" · ")} · ≤ 100 MB each
                    </span>
                  </>
                )}
              </button>
            </>
          )}

          {atCap && (
            <div className="p-3 border border-line bg-paper font-mono text-[10.5px] text-ink-muted">
              Max {MAX_FILES} files reached. Remove one to upload another.
            </div>
          )}

          {/* Uploaded file list */}
          {files.length > 0 && (
            <ul className="mt-4 space-y-1.5" data-testid="editor-digital-files-list">
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center gap-3 p-3 border border-line hover:border-line bg-paper transition"
                  data-testid={`editor-digital-file-row-${f.id}`}
                >
                  <FileText size={14} className="text-brand shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[11px] text-ink truncate">
                      {f.filename}
                      {(f.version || 1) > 1 && (
                        <span className="ml-2 border border-brand/40 text-brand px-1 py-0.5 text-[8px] uppercase tracking-[0.1em]">
                          v{f.version}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[9.5px] text-ink-muted mt-0.5 flex items-center gap-1.5">
                      {f.ext} · {formatBytes(f.size_bytes)}
                      {f.scan?.status === "clean" && (
                        <span className="inline-flex items-center gap-0.5 text-green-500" title="Passed security scan">
                          <ShieldCheck size={9} /> scanned
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleReplace(f)}
                    disabled={uploading}
                    className="p-1.5 text-ink-muted hover:text-brand transition disabled:opacity-40"
                    title="Upload a new version (buyers get the latest)"
                    data-testid={`editor-digital-file-replace-${f.id}`}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(f)}
                    className="p-1.5 text-ink-muted hover:text-red-400 transition"
                    title="Remove file"
                    data-testid={`editor-digital-file-remove-${f.id}`}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* iter453 — delivery settings (optional limit / expiry override) */}
          {!needsSave && (
            <DeliverySettings form={form} productSlug={productSlug} />
          )}

          {/* Buyer-facing reminder */}
          <p
            className="font-mono text-[10px] text-ink-muted mt-4 leading-relaxed"
            data-testid="editor-digital-files-help"
          >
            ◆ Buyers see the file list (names + types) on the listing page. They get
            secure download links by email + on the order confirmation page the
            moment payment clears — and can re-download anytime from their
            Purchases page. All digital sales are final — no refunds.
          </p>
        </div>
      )}
    </Section>
  );
}

/** iter453 — optional per-listing download limit + link expiry override. */
function DeliverySettings({ form, productSlug }) {
  const [limit, setLimit] = useState(form.download_limit ?? "");
  const [ttl, setTtl] = useState(form.download_ttl_days ?? 30);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateDigitalSettings(productSlug, {
        download_limit: limit === "" ? null : Number(limit),
        clear_limit: limit === "",
        download_ttl_days: Number(ttl) || 30,
      });
      toast.success("Delivery settings saved");
    } catch (e) {
      toast.error("Could not save settings", { description: e?.response?.data?.detail });
    } finally { setSaving(false); }
  };

  return (
    <div className="mt-4 border border-line/70 p-3" data-testid="editor-delivery-settings">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted mb-2">
        Delivery settings (optional)
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="font-mono text-[9.5px] text-ink-muted block mb-1">
            Download limit per purchase
          </span>
          <input type="number" min="1" max="1000" value={limit}
                 onChange={(e) => setLimit(e.target.value)}
                 placeholder="Unlimited"
                 className="w-32 bg-paper border border-line px-2 py-1.5 font-mono text-xs text-ink focus:border-brand outline-none"
                 data-testid="editor-download-limit" />
        </label>
        <label className="block">
          <span className="font-mono text-[9.5px] text-ink-muted block mb-1">
            Link expiry (days)
          </span>
          <input type="number" min="1" max="365" value={ttl}
                 onChange={(e) => setTtl(e.target.value)}
                 className="w-24 bg-paper border border-line px-2 py-1.5 font-mono text-xs text-ink focus:border-brand outline-none"
                 data-testid="editor-download-ttl" />
        </label>
        <button type="button" onClick={save} disabled={saving}
                className="border border-brand text-brand hover:bg-brand hover:text-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition disabled:opacity-40"
                data-testid="editor-delivery-settings-save">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="font-mono text-[9px] text-ink-muted mt-2 leading-relaxed">
        Default: unlimited downloads, links valid 30 days. Buyers can always
        mint fresh links from their Purchases page, so they never lose access.
      </p>
    </div>
  );
}
