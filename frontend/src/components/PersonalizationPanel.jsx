/**
 * PersonalizationPanel — buyer-side capture for personalized listings.
 *
 * Rendered on the product detail page when `product.personalization_enabled
 * === true`. Shows the maker's instructions, lets the buyer type a message
 * AND upload one reference image. The image is POSTed to /api/personalization
 * /upload as soon as the buyer picks it (so we don't have to bundle a
 * multi-MB base64 string with every "Add to cart" click), and the returned
 * R2 URL is held in component state.
 *
 * Parent reads state via the `onChange` callback — `{text, image_url}`. The
 * parent's "Add to cart" handler forwards both into cart.add(). They flow
 * through to checkout → order doc → maker order email.
 */
import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { Image as ImageIcon, X, Loader2, Info } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;
const MAX_BYTES = 5 * 1024 * 1024;          // matches backend cap
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "image/heif", "image/gif"];

export default function PersonalizationPanel({
  instructions,
  onChange,
  testIdPrefix = "personalization",
}) {
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);

  // Push the current state up to the parent. Run on every change so the
  // parent's "Add to cart" payload is always in sync without a separate
  // submit step.
  const pushUp = (nextText, nextImage) => {
    onChange?.({
      text: (nextText || "").trim() || null,
      image_url: nextImage || null,
    });
  };

  const onTextChange = (e) => {
    const v = e.target.value;
    setText(v);
    pushUp(v, imageUrl);
  };

  const onPick = () => fileInput.current?.click();

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";    // allow re-picking the same file later
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      toast.error("Please pick a PNG, JPG, WEBP, GIF, or HEIC image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image is too large. Max 5 MB.");
      return;
    }
    setUploading(true);
    try {
      // Read as base64 data URL (the backend endpoint accepts data URLs;
      // same flow makers already use for their own images).
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const r = await fetch(`${API}/api/personalization/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_data_url: dataUrl }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || `Upload failed (HTTP ${r.status}).`);
      }
      const body = await r.json();
      setImageUrl(body.url);
      pushUp(text, body.url);
      toast.success("Reference image attached.");
    } catch (err) {
      toast.error(err.message || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const onRemoveImage = () => {
    setImageUrl("");
    pushUp(text, "");
  };

  return (
    <div
      className="border border-[#ff4500]/30 bg-[#1a0a05] p-5 mt-6"
      data-testid={`${testIdPrefix}-panel`}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-3 inline-flex items-center gap-1.5">
        <Info size={11} /> Personalization required
      </div>
      {instructions && (
        <div
          className="text-sm text-[#e5e5e5] leading-relaxed mb-4 whitespace-pre-wrap"
          data-testid={`${testIdPrefix}-instructions`}
        >
          {instructions}
        </div>
      )}

      <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-1.5">
        Your message to the maker
      </label>
      <textarea
        rows={3}
        value={text}
        onChange={onTextChange}
        placeholder="Names, dates, placement notes, anything the maker needs to know…"
        className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] text-sm text-[#fafafa] p-3 outline-none transition-colors"
        data-testid={`${testIdPrefix}-text`}
        maxLength={2000}
      />

      <div className="mt-4">
        <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
          Reference image (optional)
        </label>
        {imageUrl ? (
          <div className="flex items-start gap-3" data-testid={`${testIdPrefix}-image-preview`}>
            <img
              src={imageUrl}
              alt="Reference"
              className="w-24 h-24 object-cover border border-[#262626]"
            />
            <div className="flex-1">
              <div className="text-xs text-[#a3a3a3] mb-2 break-all">{imageUrl.split("/").slice(-1)[0]}</div>
              <button
                type="button"
                onClick={onRemoveImage}
                className="inline-flex items-center gap-1.5 px-2 py-1 border border-[#525252] hover:border-red-500/50 text-[#a3a3a3] hover:text-red-400 font-mono text-[10px] uppercase tracking-[0.22em]"
                data-testid={`${testIdPrefix}-image-remove`}
              >
                <X size={11} /> Remove
              </button>
            </div>
          </div>
        ) : (
          <>
            <input
              type="file"
              ref={fileInput}
              accept={ALLOWED.join(",")}
              onChange={onFileChange}
              className="hidden"
              data-testid={`${testIdPrefix}-image-input`}
            />
            <button
              type="button"
              onClick={onPick}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-4 py-2 border border-[#262626] hover:border-[#ff4500] text-[#a3a3a3] hover:text-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em] disabled:opacity-50"
              data-testid={`${testIdPrefix}-image-pick`}
            >
              {uploading ? (
                <><Loader2 size={13} className="animate-spin" /> Uploading…</>
              ) : (
                <><ImageIcon size={13} /> ↑ Attach reference image</>
              )}
            </button>
            <div className="font-mono text-[10px] text-[#525252] mt-2">
              PNG · JPG · WEBP · HEIC · GIF · max 5 MB
            </div>
          </>
        )}
      </div>
    </div>
  );
}
