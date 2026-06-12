import React, { useState } from "react";
import { Trash2, Upload, Crop, Loader2, RotateCw, Lightbulb, X, ChevronDown } from "lucide-react";
import { Section, Label, FieldError } from "./FormControls";
import { MAX_IMAGES } from "./constants";

const PHOTO_TIPS_DISMISS_KEY = "cm_editor_photo_tips_dismissed_v1";

// Six concrete, CNC-marketplace-specific tips. Ordered by impact on
// conversion: cover photo first, then lighting, then the things that make
// a listing feel trustworthy (scale + multiple angles + context).
const PHOTO_TIPS = [
  { title: "Cover photo wins the click", body: "Center the product, full frame, clean background. This is the only image buyers see in search results." },
  { title: "Shoot in daylight", body: "Near a window on an overcast day is the gold standard. Avoid harsh shadows from overhead bulbs." },
  { title: "Show scale", body: "Add a coin, hand, or coffee mug in one shot so buyers immediately understand the size." },
  { title: "Capture the craft", body: "Close-ups of cut edges, engraving depth, or wood grain prove your quality — buyers are paying for the craftsmanship." },
  { title: "Show it in context", body: "One styled photo (on a wall, desk, mantel) helps buyers picture it in their own space." },
  { title: "Portrait frames sell", body: "The cropper outputs 4:5 portrait by default — your photos display at exactly 4:5 on the catalog grid and listing page, so what you crop is what buyers see." },
];

/**
 * "Photo tips" inline card — collapsible accordion that shows six concrete
 * shoot-better-photos tips. Dismissal persists in localStorage so seasoned
 * makers only see it on their first listing, but it always re-opens with
 * a click on the small "Show photo tips" pill underneath.
 */
function PhotoTipsCard() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(PHOTO_TIPS_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [open, setOpen] = useState(true);
  const dismiss = () => {
    try { localStorage.setItem(PHOTO_TIPS_DISMISS_KEY, "1"); } catch { /* private mode */ }
    setDismissed(true);
  };
  const reopen = () => {
    try { localStorage.removeItem(PHOTO_TIPS_DISMISS_KEY); } catch { /* private mode */ }
    setDismissed(false);
    setOpen(true);
  };

  if (dismissed) {
    return (
      <div className="mb-4">
        <button
          type="button"
          onClick={reopen}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-line hover:border-brand text-ink-muted hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
          data-testid="editor-photo-tips-reopen"
        >
          <Lightbulb size={11} /> Show photo tips
        </button>
      </div>
    );
  }

  return (
    <div
      className="mb-4 border border-line bg-gradient-to-br from-[#1a1208] to-[#0f0a05]"
      data-testid="editor-photo-tips-card"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-brand/[0.04] transition"
        data-testid="editor-photo-tips-toggle"
      >
        <span className="inline-flex items-center gap-2">
          <Lightbulb size={14} className="text-brand" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
            ◆ Photo tips — shoot listings that sell
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <ChevronDown
            size={14}
            className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
          />
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); dismiss(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); dismiss(); } }}
            className="text-ink-muted hover:text-red-400 transition cursor-pointer"
            aria-label="Dismiss photo tips"
            data-testid="editor-photo-tips-dismiss"
          >
            <X size={13} />
          </span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PHOTO_TIPS.map((tip, idx) => (
            <div
              key={tip.title}
              className="border border-line bg-paper/60 p-3"
              data-testid={`editor-photo-tip-${idx}`}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand mb-1.5">
                ◇ {tip.title}
              </p>
              <p className="text-[12px] text-ink-muted leading-relaxed">
                {tip.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Photos & Video section — 10-photo grid w/ drag-to-reorder + cover badge,
 * plus a single optional video (uploaded to R2 or pasted as a URL).
 *
 * Pure presentation — every piece of state and every handler is passed in
 * by the parent orchestrator. This keeps photo + video logic colocated
 * with the maker editor flow without dragging the entire 1300-line file
 * along whenever you want to peek at the image grid.
 */
export default function MediaSection({
  form, errors,
  // Photos
  fileRef, onPickPhotos, removeImage, promoteCover, recropImage,
  dragSrc, dragOver, onDragStart, onDragOver, onDragLeaveTile, onDrop, onDragEnd,
  // Video
  videoFileRef, onPickVideo, videoUploading, videoErr, removeVideo, set,
  // Per-tile upload status — count of photos still streaming to R2.
  // A tile whose src starts with "data:" while there are pending uploads
  // gets a small spinner overlay so the maker knows it isn't safe to
  // publish yet.
  uploadingPhotos = 0,
  // Per-tile detailed state: { [src]: "uploading" | "error" }. Lets us
  // render a retry CTA on tiles whose initial upload failed, without
  // forcing the maker to remove + re-crop the photo.
  uploadStatus = {},
  retryImageUpload,
  retryAllFailedUploads,
}) {
  // Count of tiles whose initial upload failed — drives the "Retry all
  // failed" banner above the grid. We only render the banner when this
  // is > 0, so happy-path listings never see it.
  const failedCount = form.images.reduce(
    (n, src) => (uploadStatus?.[src] === "error" ? n + 1 : n),
    0,
  );
  return (
    <Section
      eyebrow="◆ Media"
      title="Photos & Video"
      subtitle="Add up to 10 photos. The first image is your cover photo. Drag any photo to reorder, or click 'Set as cover' to promote it."
      counter={`${form.images.length}/${MAX_IMAGES} photos · ${form.video_url ? "1/1" : "0/1"} video`}
    >
      <PhotoTipsCard />
      {failedCount > 0 && (
        <div
          className="mb-3 px-3 py-2 border border-red-500/60 bg-red-950/40 flex items-center justify-between gap-3"
          data-testid="editor-photo-batch-error"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-600">
            ◆ {failedCount} photo{failedCount === 1 ? "" : "s"} failed to upload
          </span>
          <button
            type="button"
            onClick={retryAllFailedUploads}
            className="px-3 py-1 border border-red-400 text-red-600 hover:bg-red-500/20 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2"
            data-testid="editor-retry-all-failed-photos"
          >
            <RotateCw size={11} /> Retry all
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="editor-photo-grid">
        {form.images.map((src, i) => {
          const isDragging = dragSrc === i;
          const isOver = dragOver === i && dragSrc != null && dragSrc !== i;
          const tileStatus = uploadStatus?.[src];
          const isUploading = tileStatus === "uploading";
          const isError = tileStatus === "error";
          return (
            <div
              key={i}
              draggable={true}
              onDragStart={onDragStart(i)}
              onDragOver={onDragOver(i)}
              onDragLeave={onDragLeaveTile(i)}
              onDrop={onDrop(i)}
              onDragEnd={onDragEnd}
              className={`relative aspect-[4/5] border group overflow-hidden cursor-grab active:cursor-grabbing transition ${
                isError
                  ? "border-red-500 border-2 ring-2 ring-red-500/40"
                  : isOver
                    ? "border-brand border-2 ring-2 ring-[#ff4500]/40"
                    : i === 0
                      ? "border-brand"
                      : "border-line"
              } ${isDragging ? "opacity-40" : ""}`}
              data-testid={`editor-image-${i}`}
            >
              <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
              {i === 0 && (
                <span className="absolute top-1 left-1 bg-brand text-[#0a0a0a] text-[9px] font-mono px-1.5 py-0.5 uppercase tracking-[0.18em]">
                  ◆ Cover
                </span>
              )}
              {isUploading && (
                <div
                  className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-2 pointer-events-none"
                  data-testid={`editor-image-uploading-${i}`}
                >
                  <Loader2 size={18} className="text-brand animate-spin" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-brand">
                    Uploading…
                  </span>
                </div>
              )}
              {isError && !isUploading && (
                <div
                  className="absolute inset-0 bg-red-950/85 flex flex-col items-center justify-center gap-3 px-3 z-10"
                  data-testid={`editor-image-error-${i}`}
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-red-600 text-center leading-tight">
                    ◆ Upload failed
                  </span>
                  {/* iter340b — Retry promoted to the PRIMARY action on a
                      failed-upload tile. Big, clearly clickable, full-tile
                      width. Remove sits beneath as the recovery option. */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); retryImageUpload?.(i); }}
                    className="w-full max-w-[140px] px-3 py-2 bg-red-500 hover:bg-red-400 text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center justify-center gap-1.5"
                    data-testid={`editor-image-retry-${i}`}
                  >
                    <RotateCw size={11} /> Retry upload
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                    className="px-2 py-1 border border-red-400/60 text-red-600 hover:bg-red-500/20 font-mono text-[9px] uppercase tracking-[0.22em] inline-flex items-center gap-1"
                    data-testid={`editor-image-error-remove-${i}`}
                  >
                    <Trash2 size={10} /> Remove
                  </button>
                </div>
              )}
              {/* iter340b — Suppress the hover-state overlay (Set as cover /
                  Crop / Trash) on error tiles. Those actions are meaningless
                  on a failed upload (you can't make a failed URL the cover
                  image), and rendering them on top of the error overlay was
                  visually clobbering the Retry button. */}
              {!isError && (
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                  {i !== 0 && (
                    <button
                      onClick={() => promoteCover(i)}
                      className="px-2 py-1 border border-brand text-brand font-mono text-[9px] uppercase tracking-[0.18em] hover:bg-brand/10"
                      data-testid={`editor-set-cover-${i}`}
                    >
                      Set as cover
                    </button>
                  )}
                  <button
                    onClick={() => recropImage(i)}
                    className="p-1.5 border border-line hover:border-brand text-ink-muted hover:text-brand"
                    data-testid={`editor-recrop-image-${i}`}
                    aria-label="Crop or rotate"
                    title="Crop / rotate"
                  >
                    <Crop size={12} />
                  </button>
                  <button
                    onClick={() => removeImage(i)}
                    className="p-1.5 border border-line hover:border-red-500 text-red-400"
                    data-testid={`editor-remove-image-${i}`}
                    aria-label="Remove"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {form.images.length < MAX_IMAGES && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="aspect-[4/5] border border-dashed border-line hover:border-brand hover:text-brand text-ink-muted flex flex-col items-center justify-center gap-2 transition"
            data-testid="editor-add-photo"
          >
            <Upload size={20} />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
              {form.images.length === 0 ? "Add cover" : "Add photo"}
            </span>
          </button>
        )}
      </div>
      <input
        ref={fileRef} type="file" accept="image/*" multiple hidden
        onChange={onPickPhotos} data-testid="editor-photo-input"
      />
      {errors.images && <FieldError msg={errors.images} />}

      <div className="mt-6 pt-6 border-t border-line">
        <Label>Video <span className="text-ink-muted">(optional · MP4 / WebM / MOV up to 50MB)</span></Label>

        {form.video_url ? (
          <div className="border border-line p-3" data-testid="editor-video-preview">
            <video
              src={form.video_url} controls preload="metadata"
              className="w-full max-h-64 bg-black"
            />
            <div className="flex items-center justify-between mt-3 gap-3">
              <span className="font-mono text-[10px] text-ink-muted truncate">{form.video_url}</span>
              <button
                type="button" onClick={removeVideo}
                className="px-2 py-1 border border-line hover:border-red-400 hover:text-red-400 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1"
                data-testid="editor-video-remove"
              >
                <Trash2 size={10} /> Remove
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                type="button" onClick={() => videoFileRef.current?.click()}
                disabled={!!videoUploading}
                className="border border-dashed border-line hover:border-brand hover:text-brand text-ink-muted flex items-center justify-center gap-2 py-6 transition disabled:opacity-50"
                data-testid="editor-video-upload"
              >
                <Upload size={16} />
                <span className="font-mono text-[11px] uppercase tracking-[0.22em]">
                  {videoUploading ? `Uploading… ${videoUploading}%` : "Upload from computer"}
                </span>
              </button>
              <div className="flex items-center justify-center font-mono text-[10px] text-ink-muted uppercase tracking-[0.22em]">
                — or paste URL —
              </div>
            </div>
            <input
              type="url" value={form.video_url}
              onChange={(e) => set({ video_url: e.target.value })}
              placeholder="https://… or hosted YouTube/Vimeo link"
              className="w-full mt-3 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-sm"
              data-testid="editor-video-url"
            />
          </>
        )}
        <input
          ref={videoFileRef} type="file" hidden
          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
          onChange={onPickVideo} data-testid="editor-video-input"
        />
        {videoErr && <FieldError msg={videoErr} />}
        <p className="font-mono text-[10px] text-ink-muted mt-2">
          ◆ JPG · PNG · GIF · WEBP · max 5MB per photo. Videos served from R2 CDN — no transcoding.
        </p>
      </div>
    </Section>
  );
}
