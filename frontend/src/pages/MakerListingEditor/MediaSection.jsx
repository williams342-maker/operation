import React from "react";
import { Trash2, Upload, Crop, Loader2, RotateCw } from "lucide-react";
import { Section, Label, FieldError } from "./FormControls";
import { MAX_IMAGES } from "./constants";

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
}) {
  return (
    <Section
      eyebrow="◆ Media"
      title="Photos & Video"
      subtitle="Add up to 10 photos. The first image is your cover photo. Drag any photo to reorder, or click 'Set as cover' to promote it."
      counter={`${form.images.length}/${MAX_IMAGES} photos · ${form.video_url ? "1/1" : "0/1"} video`}
    >
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
              className={`relative aspect-square border group overflow-hidden cursor-grab active:cursor-grabbing transition ${
                isError
                  ? "border-red-500 border-2 ring-2 ring-red-500/40"
                  : isOver
                    ? "border-[#ff4500] border-2 ring-2 ring-[#ff4500]/40"
                    : i === 0
                      ? "border-[#ff4500]"
                      : "border-[#262626]"
              } ${isDragging ? "opacity-40" : ""}`}
              data-testid={`editor-image-${i}`}
            >
              <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
              {i === 0 && (
                <span className="absolute top-1 left-1 bg-[#ff4500] text-[#0a0a0a] text-[9px] font-mono px-1.5 py-0.5 uppercase tracking-[0.18em]">
                  ◆ Cover
                </span>
              )}
              {isUploading && (
                <div
                  className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-2 pointer-events-none"
                  data-testid={`editor-image-uploading-${i}`}
                >
                  <Loader2 size={18} className="text-[#ff4500] animate-spin" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#ff4500]">
                    Uploading…
                  </span>
                </div>
              )}
              {isError && !isUploading && (
                <div
                  className="absolute inset-0 bg-red-950/85 flex flex-col items-center justify-center gap-2 px-2"
                  data-testid={`editor-image-error-${i}`}
                >
                  <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-red-300 text-center leading-tight">
                    Upload failed
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); retryImageUpload?.(i); }}
                    className="px-2 py-1 border border-red-400 text-red-200 hover:bg-red-500/20 font-mono text-[9px] uppercase tracking-[0.22em] inline-flex items-center gap-1"
                    data-testid={`editor-image-retry-${i}`}
                  >
                    <RotateCw size={10} /> Retry
                  </button>
                </div>
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                {i !== 0 && (
                  <button
                    onClick={() => promoteCover(i)}
                    className="px-2 py-1 border border-[#ff4500] text-[#ff4500] font-mono text-[9px] uppercase tracking-[0.18em] hover:bg-[#ff4500]/10"
                    data-testid={`editor-set-cover-${i}`}
                  >
                    Set as cover
                  </button>
                )}
                <button
                  onClick={() => recropImage(i)}
                  className="p-1.5 border border-[#262626] hover:border-[#ff4500] text-[#a3a3a3] hover:text-[#ff4500]"
                  data-testid={`editor-recrop-image-${i}`}
                  aria-label="Crop or rotate"
                  title="Crop / rotate"
                >
                  <Crop size={12} />
                </button>
                <button
                  onClick={() => removeImage(i)}
                  className="p-1.5 border border-[#262626] hover:border-red-500 text-red-400"
                  data-testid={`editor-remove-image-${i}`}
                  aria-label="Remove"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
        {form.images.length < MAX_IMAGES && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="aspect-square border border-dashed border-[#404040] hover:border-[#ff4500] hover:text-[#ff4500] text-[#737373] flex flex-col items-center justify-center gap-2 transition"
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

      <div className="mt-6 pt-6 border-t border-[#262626]">
        <Label>Video <span className="text-[#525252]">(optional · MP4 / WebM / MOV up to 50MB)</span></Label>

        {form.video_url ? (
          <div className="border border-[#262626] p-3" data-testid="editor-video-preview">
            <video
              src={form.video_url} controls preload="metadata"
              className="w-full max-h-64 bg-black"
            />
            <div className="flex items-center justify-between mt-3 gap-3">
              <span className="font-mono text-[10px] text-[#737373] truncate">{form.video_url}</span>
              <button
                type="button" onClick={removeVideo}
                className="px-2 py-1 border border-[#262626] hover:border-red-400 hover:text-red-400 font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-1"
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
                className="border border-dashed border-[#404040] hover:border-[#ff4500] hover:text-[#ff4500] text-[#a3a3a3] flex items-center justify-center gap-2 py-6 transition disabled:opacity-50"
                data-testid="editor-video-upload"
              >
                <Upload size={16} />
                <span className="font-mono text-[11px] uppercase tracking-[0.22em]">
                  {videoUploading ? `Uploading… ${videoUploading}%` : "Upload from computer"}
                </span>
              </button>
              <div className="flex items-center justify-center font-mono text-[10px] text-[#525252] uppercase tracking-[0.22em]">
                — or paste URL —
              </div>
            </div>
            <input
              type="url" value={form.video_url}
              onChange={(e) => set({ video_url: e.target.value })}
              placeholder="https://… or hosted YouTube/Vimeo link"
              className="w-full mt-3 bg-transparent border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-sm"
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
        <p className="font-mono text-[10px] text-[#525252] mt-2">
          ◆ JPG · PNG · GIF · WEBP · max 5MB per photo. Videos served from R2 CDN — no transcoding.
        </p>
      </div>
    </Section>
  );
}
