import React, { useRef, useState, useMemo, useEffect } from "react";
import { createMakerProduct, uploadMakerModel } from "../../lib/api";
import { LabeledField } from "./_shared";
import { CATEGORIES } from "../MakerListingEditor/constants";
import { techniquesForCategory } from "../../lib/techniqueOptions";
// Retina-friendly: 2048px longest edge looks crisp on 2x/3x displays even
// after the browser downscales for tile rendering.
const MAX_IMG_W = 2048;
// Was 130 KB which forced quality down to ~0.4–0.5 (visible banding + soft
// detail). 500 KB lets WebP keep its native quality on photo-rich uploads
// while staying CDN-friendly.
const MAX_IMG_KB = 500;
const MAX_IMAGES = 8;

/**
 * Compress an image File → data URL. Tries WebP first (much smaller for
 * photos), falls back to JPEG when the browser can't encode WebP.
 * Iteratively lowers quality until the result is below MAX_IMG_KB.
 */
function compressImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMG_W / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        // High-quality resampling (Lanczos-grade in Chrome/Safari/Firefox)
        // — the difference vs default bilinear is dramatic on photos.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);

        const tryEncode = (mime, q) => canvas.toDataURL(mime, q);
        let mime = "image/webp";
        // Start higher — 0.92 is visually lossless for WebP on photos.
        let q = 0.92;
        let dataUrl = tryEncode(mime, q);
        // toDataURL falls back to PNG silently when the mime is unsupported.
        if (!dataUrl.startsWith(`data:${mime}`)) {
          mime = "image/jpeg";
          dataUrl = tryEncode(mime, q);
        }
        // Step quality down if still too large. Floor at 0.6 — anything
        // below that introduces visible artifacts.
        while (dataUrl.length / 1024 > MAX_IMG_KB && q > 0.6) {
          q -= 0.08;
          dataUrl = tryEncode(mime, q);
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function NewListingModal({ onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  // iter413co — Technique list is now category-aware. When the maker
  // switches category, the technique resets to the first option of the
  // new list so they don't accidentally submit a CNC term against a
  // fiber-art listing.
  const techOptions = useMemo(() => techniquesForCategory(category), [category]);
  const [technique, setTechnique] = useState(techOptions[0]);
  // Keep technique in sync when category changes.
  useEffect(() => { setTechnique(techOptions[0]); }, [techOptions]);
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState(4);
  const [description, setDescription] = useState("");
  const [materials, setMaterials] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [images, setImages] = useState([]);     // array of data URLs
  const [modelUrl, setModelUrl] = useState("");
  const [uploadingModel, setUploadingModel] = useState(false);
  const [variants, setVariants] = useState([]); // [{label, price_delta, in_stock, axis1?, axis2?, image?}]
  const [axis1Name, setAxis1Name] = useState("");
  const [axis2Name, setAxis2Name] = useState("");
  const [variantImageBusy, setVariantImageBusy] = useState({}); // idx → bool
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const modelFileRef = useRef(null);

  const handleFiles = async (files) => {
    setErr("");
    const incoming = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!incoming.length) {
      setErr("Only image files are accepted (PNG / JPG / WebP).");
      return;
    }
    if (images.length + incoming.length > MAX_IMAGES) {
      setErr(`Maximum ${MAX_IMAGES} images per listing.`);
      return;
    }
    try {
      const compressed = await Promise.all(incoming.map(compressImageToDataUrl));
      setImages((prev) => [...prev, ...compressed].slice(0, MAX_IMAGES));
    } catch (e) {
      setErr(e.message || "Could not process one of the images.");
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const removeImage = (i) =>
    setImages((prev) => prev.filter((_, idx) => idx !== i));

  const onModelFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.(glb|gltf)$/i.test(f.name)) {
      setErr("3D model must be .glb or .gltf");
      return;
    }
    setErr("");
    setUploadingModel(true);
    try {
      const { url } = await uploadMakerModel(f);
      setModelUrl(url);
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Model upload failed.");
    } finally {
      setUploadingModel(false);
      if (modelFileRef.current) modelFileRef.current.value = "";
    }
  };

  const addVariantRow = () =>
    setVariants((prev) => [...prev, { label: "", price_delta: 0, in_stock: 0, axis1: "", axis2: "", image: "" }]);
  const updateVariant = (i, key, val) =>
    setVariants((prev) => prev.map((v, idx) => idx === i ? { ...v, [key]: val } : v));
  const removeVariant = (i) =>
    setVariants((prev) => prev.filter((_, idx) => idx !== i));

  const onVariantImageFile = async (i, file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Variant image must be an image file."); return;
    }
    setVariantImageBusy((b) => ({ ...b, [i]: true }));
    try {
      const dataUrl = await compressImageToDataUrl(file);
      updateVariant(i, "image", dataUrl);
    } catch (e) {
      setErr(e.message || "Could not process variant image.");
    } finally {
      setVariantImageBusy((b) => ({ ...b, [i]: false }));
    }
  };

  const buildPayload = (status) => ({
    title: title.trim(),
    category, technique,
    price: parseFloat(price) || 0,
    in_stock: parseInt(stock, 10) || 0,
    description: description.trim(),
    materials: materials.split(",").map((s) => s.trim()).filter(Boolean),
    dimensions: dimensions.trim() || null,
    images,
    model_url: modelUrl.trim() || null,
    status,
    variant_axis1_name: axis1Name.trim() || null,
    variant_axis2_name: axis2Name.trim() || null,
    variants: variants
      .filter((v) => v.label.trim())
      .map((v) => ({
        label: v.label.trim(),
        price_delta: parseFloat(v.price_delta) || 0,
        in_stock: parseInt(v.in_stock, 10) || 0,
        axis1: (v.axis1 || "").trim() || null,
        axis2: (v.axis2 || "").trim() || null,
        image: v.image || null,
      })),
  });

  const submit = async (e, status = "published") => {
    if (e?.preventDefault) e.preventDefault();
    setErr("");
    if (!title.trim()) { setErr("Title is required."); return; }
    const priceNum = parseFloat(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setErr("Price must be a non-negative number.");
      return;
    }
    if (status === "published" && !description.trim()) {
      setErr("Tell buyers a little about this piece.");
      return;
    }
    setBusy(true);
    try {
      await createMakerProduct(buildPayload(status));
      onCreated && onCreated();
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Could not create listing.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-paper/85 backdrop-blur-sm z-[100] flex items-start justify-center overflow-y-auto p-4 md:p-12"
      data-testid="new-listing-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={submit}
        className="bg-paper border border-line w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h3 className="font-display text-2xl uppercase">New Listing.</h3>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs text-ink-muted hover:text-brand"
            data-testid="new-listing-close"
          >
            ✕ Close
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Drag-drop image dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed p-8 text-center cursor-pointer transition ${
              dragOver ? "border-brand bg-brand/5" : "border-line hover:border-brand"
            }`}
            data-testid="new-listing-dropzone"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
              data-testid="new-listing-file-input"
            />
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              ◆ Drop up to {MAX_IMAGES} images, or click to browse
            </div>
            <div className="font-mono text-[10px] text-ink-muted mt-2">
              Auto-compressed to ~120KB each · WebP when supported
            </div>
          </div>

          {images.length > 0 && (
            <div className="grid grid-cols-3 md:grid-cols-5 gap-2" data-testid="new-listing-image-grid">
              {images.map((src, i) => (
                <div key={i} className="relative aspect-square border border-line">
                  <img src={src} alt={`upload-${i}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 bg-paper/80 px-1.5 py-0.5 font-mono text-[9px] uppercase text-red-400 hover:text-red-600 border border-red-400/40"
                    data-testid={`new-listing-remove-${i}`}
                  >
                    ✕
                  </button>
                  {i === 0 && (
                    <div className="absolute bottom-1 left-1 bg-brand px-1.5 py-0.5 font-mono text-[9px] uppercase text-ink">
                      Primary
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Title + slug auto */}
          <div className="grid md:grid-cols-2 gap-4">
            <LabeledField label="Title">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={100}
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
                data-testid="new-listing-title"
              />
            </LabeledField>
            <LabeledField label="Price (USD)">
              <input
                type="number"
                step="1"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
                data-testid="new-listing-price"
              />
            </LabeledField>
            <LabeledField label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
                data-testid="new-listing-category"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} className="bg-paper">{c}</option>
                ))}
              </select>
            </LabeledField>
            <LabeledField label="Technique">
              <select
                value={technique}
                onChange={(e) => setTechnique(e.target.value)}
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
                data-testid="new-listing-technique"
              >
                {techOptions.map((t) => (
                  <option key={t} className="bg-paper">{t}</option>
                ))}
              </select>
            </LabeledField>
            <LabeledField label="Stock">
              <input
                type="number"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
                data-testid="new-listing-stock"
              />
            </LabeledField>
            <LabeledField label="Dimensions (optional)">
              <input
                value={dimensions}
                onChange={(e) => setDimensions(e.target.value)}
                placeholder='24" × 36" × 0.25"'
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
                data-testid="new-listing-dimensions"
              />
            </LabeledField>
          </div>

          <LabeledField label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={4}
              className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink resize-y"
              data-testid="new-listing-description"
            />
          </LabeledField>

          <LabeledField label="Materials (comma separated)">
            <input
              value={materials}
              onChange={(e) => setMaterials(e.target.value)}
              placeholder="Mild steel, Powder coat, Walnut"
              className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
              data-testid="new-listing-materials"
            />
          </LabeledField>

          <LabeledField label="3D model (optional, .glb / .gltf)">
            <div className="space-y-2">
              <input
                ref={modelFileRef}
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                onChange={onModelFile}
                className="hidden"
                data-testid="new-listing-model-file"
              />
              <button
                type="button"
                onClick={() => modelFileRef.current?.click()}
                disabled={uploadingModel}
                className="w-full border border-dashed border-line hover:border-brand/60 px-3 py-3 text-left font-mono text-[11px] text-ink-muted hover:text-brand transition disabled:opacity-50"
                data-testid="new-listing-model-upload"
              >
                {uploadingModel
                  ? "Uploading model…"
                  : modelUrl
                  ? "✓ Model uploaded · click to replace"
                  : "+ Upload .glb / .gltf"}
              </button>
              <input
                type="url"
                value={modelUrl}
                onChange={(e) => setModelUrl(e.target.value)}
                placeholder="…or paste a public model URL"
                className="w-full bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
                data-testid="new-listing-model-url"
              />
            </div>
          </LabeledField>

          {/* Variants section */}
          <div data-testid="new-listing-variants">
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                Options / variants (optional)
              </div>
              <button
                type="button"
                onClick={addVariantRow}
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand hover:text-brand-hover"
                data-testid="new-listing-variant-add"
              >
                + Add option
              </button>
            </div>

            {variants.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                <input
                  value={axis1Name}
                  onChange={(e) => setAxis1Name(e.target.value)}
                  placeholder="Axis 1 name (e.g. Size)"
                  className="bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                  data-testid="new-listing-axis1-name"
                />
                <input
                  value={axis2Name}
                  onChange={(e) => setAxis2Name(e.target.value)}
                  placeholder="Axis 2 name (e.g. Finish · optional)"
                  className="bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                  data-testid="new-listing-axis2-name"
                />
              </div>
            )}

            {variants.length === 0 ? (
              <p className="font-mono text-[10px] text-ink-muted">
                Skip if this piece has no choices. Add rows for sizes, finishes, or colors — each with its own price delta and stock. Need a 2D grid (size × finish)? Fill both axis names + per-variant axis cells.
              </p>
            ) : (
              <div className="space-y-2">
                {variants.map((v, i) => (
                  <div
                    key={i}
                    className="border border-line p-3 space-y-2"
                    data-testid={`new-listing-variant-row-${i}`}
                  >
                    <div className="grid grid-cols-12 gap-2">
                      <input
                        value={v.label}
                        onChange={(e) => updateVariant(i, "label", e.target.value)}
                        placeholder='Display label e.g. 24" Walnut'
                        className="col-span-6 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                        data-testid={`new-listing-variant-label-${i}`}
                      />
                      <input
                        type="number"
                        value={v.price_delta}
                        onChange={(e) => updateVariant(i, "price_delta", e.target.value)}
                        placeholder="+$"
                        className="col-span-3 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                        data-testid={`new-listing-variant-delta-${i}`}
                      />
                      <input
                        type="number"
                        min="0"
                        value={v.in_stock}
                        onChange={(e) => updateVariant(i, "in_stock", e.target.value)}
                        placeholder="Qty"
                        className="col-span-2 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                        data-testid={`new-listing-variant-stock-${i}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeVariant(i)}
                        className="col-span-1 font-mono text-[11px] text-ink-muted hover:text-red-400"
                        data-testid={`new-listing-variant-remove-${i}`}
                        aria-label="Remove variant"
                      >
                        ✕
                      </button>
                    </div>
                    {(axis1Name || axis2Name) && (
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={v.axis1 || ""}
                          onChange={(e) => updateVariant(i, "axis1", e.target.value)}
                          placeholder={axis1Name ? `${axis1Name} value` : "Axis 1 value"}
                          className="bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                          data-testid={`new-listing-variant-axis1-${i}`}
                        />
                        <input
                          value={v.axis2 || ""}
                          onChange={(e) => updateVariant(i, "axis2", e.target.value)}
                          placeholder={axis2Name ? `${axis2Name} value` : "Axis 2 value (optional)"}
                          className="bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs"
                          data-testid={`new-listing-variant-axis2-${i}`}
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      {v.image && (
                        <img
                          src={v.image}
                          alt={`variant-${i}`}
                          className="w-12 h-12 object-cover border border-line"
                          data-testid={`new-listing-variant-image-${i}`}
                        />
                      )}
                      <label className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => onVariantImageFile(i, e.target.files?.[0])}
                          className="hidden"
                          data-testid={`new-listing-variant-image-input-${i}`}
                        />
                        {variantImageBusy[i]
                          ? "Uploading…"
                          : v.image
                          ? "↻ Replace image"
                          : "+ Variant image (optional)"}
                      </label>
                      {v.image && (
                        <button
                          type="button"
                          onClick={() => updateVariant(i, "image", "")}
                          className="font-mono text-[10px] text-ink-muted hover:text-red-400"
                        >
                          remove img
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {err && (
            <p className="font-mono text-xs text-red-400" data-testid="new-listing-error">{err}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand"
            data-testid="new-listing-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(e) => submit(e, "draft")}
            disabled={busy}
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand hover:text-brand disabled:opacity-50 px-3 py-2 border border-amber-400/40"
            data-testid="new-listing-save-draft"
          >
            Save as draft
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn-industrial btn-primary disabled:opacity-50"
            data-testid="new-listing-submit"
          >
            {busy ? "Creating…" : "Publish Listing →"}
          </button>
        </div>
      </form>
    </div>
  );
}
