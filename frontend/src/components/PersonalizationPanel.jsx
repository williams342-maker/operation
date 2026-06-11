/**
 * PersonalizationPanel — buyer-side capture for personalized listings.
 *
 * Rendered on the product detail page when `product.personalization_enabled
 * === true`. Shows the maker's instructions, lets the buyer type a message
 * AND upload up to 10 photos (iter364 — engraving art, fingerprints, pet
 * nose prints, memorial portraits…). Each file is POSTed individually as
 * multipart to /api/personalization/files (max 25 MB each) the moment
 * it's picked; the returned ids are held in component state.
 *
 * Parent reads state via the `onChange` callback —
 *   { text, image_url, upload_ids, uploads }
 * `image_url` is the absolute URL of the FIRST upload (legacy field —
 * keeps the iter150 email/cart surfaces working). `upload_ids` flow into
 * cart.add() → checkout → order doc → maker order detail.
 *
 * When `requiresUpload` is true (maker checked "Requires customer upload")
 * the parent blocks Add-to-cart until at least one photo is attached.
 */
import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { Image as ImageIcon, X, Loader2, Info, FileImage } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;
const MAX_BYTES = 25 * 1024 * 1024;          // 25 MB per file (matches backend)
const MAX_FILES = 10;
const ALLOWED_MIMES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "image/heif"];
const ALLOWED_EXTS = ["png", "jpg", "jpeg", "webp", "heic", "heif"];

const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function PersonalizationPanel({
  instructions,
  onChange,
  testIdPrefix = "personalization",
  requiresUpload = false,
  productSlug = "",
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);        // [{id,url,name,size}]
  const [uploading, setUploading] = useState(0); // in-flight count
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);

  const pushUp = (nextText, nextFiles) => {
    onChange?.({
      text: (nextText || "").trim() || null,
      image_url: nextFiles[0] ? `${API}${nextFiles[0].url}` : null,
      upload_ids: nextFiles.map((f) => f.id),
      uploads: nextFiles,
    });
  };

  const onTextChange = (e) => {
    const v = e.target.value;
    setText(v);
    pushUp(v, files);
  };

  const validFile = (file) => {
    const ext = (file.name || "").split(".").pop()?.toLowerCase() || "";
    if (!ALLOWED_MIMES.includes(file.type) && !ALLOWED_EXTS.includes(ext)) {
      toast.error(`"${file.name}" isn't a supported format. Use JPG, PNG, WEBP, or HEIC.`);
      return false;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`"${file.name}" is too large. Max 25 MB per photo.`);
      return false;
    }
    return true;
  };

  const processFiles = async (fileList) => {
    const picked = Array.from(fileList || []).filter(Boolean);
    if (!picked.length) return;
    const room = MAX_FILES - files.length;
    if (room <= 0) {
      toast.error(`Maximum ${MAX_FILES} photos per item.`);
      return;
    }
    const batch = picked.slice(0, room).filter(validFile);
    if (picked.length > room) toast.message(`Only ${room} more photo${room === 1 ? "" : "s"} can be added (max ${MAX_FILES}).`);
    if (!batch.length) return;

    setUploading((n) => n + batch.length);
    let current = files;
    await Promise.all(batch.map(async (file) => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("product_slug", productSlug || "");
        const r = await fetch(`${API}/api/personalization/files`, { method: "POST", body: fd });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || `Upload failed (HTTP ${r.status}).`);
        }
        const body = await r.json();
        current = [...current, { id: body.id, url: body.url, name: file.name, size: file.size }];
        setFiles(current);
        pushUp(text, current);
      } catch (err) {
        toast.error(err.message || `Couldn't upload "${file.name}". Please try again.`);
      } finally {
        setUploading((n) => n - 1);
      }
    }));
    if (current.length > files.length) toast.success("Photo(s) attached.");
  };

  const onFileChange = async (e) => {
    const list = e.target.files;
    e.target.value = "";
    await processFiles(list);
  };

  const removeFile = (id) => {
    const next = files.filter((f) => f.id !== id);
    setFiles(next);
    pushUp(text, next);
  };

  return (
    <div
      className="border border-brand/30 bg-brand/10 p-5 mt-6"
      data-testid={`${testIdPrefix}-panel`}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3 inline-flex items-center gap-1.5">
        <Info size={11} /> Personalization required
      </div>
      {instructions && (
        <div
          className="text-sm text-ink leading-relaxed mb-4 whitespace-pre-wrap"
          data-testid={`${testIdPrefix}-instructions`}
        >
          {instructions}
        </div>
      )}

      <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-1.5">
        Your message to the maker
      </label>
      <textarea
        rows={3}
        value={text}
        onChange={onTextChange}
        placeholder="Names, dates, placement notes, anything the maker needs to know…"
        className="w-full bg-paper border border-line focus:border-brand text-sm text-ink p-3 outline-none transition-colors"
        data-testid={`${testIdPrefix}-text`}
        maxLength={2000}
      />

      <div className="mt-4">
        <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
          {requiresUpload ? "Your photos (required)" : "Your photos (optional)"}
          {files.length > 0 && <span className="ml-2 text-brand">{files.length}/{MAX_FILES}</span>}
        </label>
        {requiresUpload && files.length === 0 && (
          <p className="font-mono text-[10px] text-brand mb-2" data-testid={`${testIdPrefix}-required-hint`}>
            ◆ This item is made from your photo(s) — upload at least one before adding to cart.
          </p>
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-3" data-testid={`${testIdPrefix}-uploads`}>
            {files.map((f) => (
              <div key={f.id} className="relative w-24" data-testid={`${testIdPrefix}-upload-${f.id}`}>
                <img
                  src={`${API}${f.url}`}
                  alt={f.name}
                  className="w-24 h-24 object-cover border border-line bg-paper"
                  onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "flex"; }}
                />
                {/* HEIC previews can't render in most browsers — fall back to a file chip. */}
                <div className="w-24 h-24 border border-line bg-paper hidden items-center justify-center">
                  <FileImage size={22} className="text-ink-muted" />
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  className="absolute -top-2 -right-2 bg-paper border border-line rounded-full p-1 text-ink-muted hover:text-red-400"
                  aria-label={`Remove ${f.name}`}
                  data-testid={`${testIdPrefix}-upload-remove-${f.id}`}
                >
                  <X size={11} />
                </button>
                <div className="font-mono text-[9px] text-ink-muted mt-1 truncate" title={f.name}>
                  {f.name} · {fmtSize(f.size)}
                </div>
              </div>
            ))}
          </div>
        )}

        {files.length < MAX_FILES && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              processFiles(e.dataTransfer.files);
            }}
            className={`border-2 border-dashed transition-colors p-4 ${
              dragOver ? "border-brand bg-brand/5" : "border-line"
            }`}
          >
            <input
              type="file"
              ref={fileInput}
              accept={[...ALLOWED_MIMES, ".heic", ".heif"].join(",")}
              multiple
              onChange={onFileChange}
              className="hidden"
              data-testid={`${testIdPrefix}-image-input`}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading > 0}
              className="inline-flex items-center gap-2 px-4 py-2 border border-line hover:border-brand text-ink-muted hover:text-brand font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
              data-testid={`${testIdPrefix}-image-pick`}
            >
              {uploading > 0 ? (
                <><Loader2 size={13} className="animate-spin" /> Uploading {uploading}…</>
              ) : dragOver ? (
                <><ImageIcon size={13} /> ↓ Release to upload</>
              ) : (
                <><ImageIcon size={13} /> ↑ Drop or click to add photos</>
              )}
            </button>
            <div className="font-mono text-[10px] text-ink-muted mt-2">
              JPG · PNG · WEBP · HEIC — up to {MAX_FILES} files · max 25 MB each
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
