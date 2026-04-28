import React, { useCallback, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { X, Check, RotateCcw } from "lucide-react";

/** Crop modal for product photos.
 *  Wraps `react-easy-crop` so the caller just receives the final cropped
 *  data URL. Default aspect is **square** (1:1) since our listing grid uses
 *  aspect-square thumbnails — but the maker can switch to 4:5 portrait or
 *  16:9 wide for lifestyle/video-card shots before confirming.
 */
const ASPECT_PRESETS = [
  { id: "1:1",  ratio: 1,        label: "Square",   hint: "Catalog grid · default" },
  { id: "4:5",  ratio: 4 / 5,    label: "Portrait", hint: "Lifestyle · IG-feed style" },
  { id: "16:9", ratio: 16 / 9,   label: "Wide",     hint: "Video card · banner" },
];

export default function ImageCropModal({
  src, onCancel, onConfirm,
  defaultAspect = 1,
  outputMaxEdge = 1600,        // matches MakerListingEditor compression target
  outputMime = "image/webp",
  outputQuality = 0.86,
}) {
  const [aspect, setAspect] = useState(defaultAspect);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const cropPx = useRef(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_area, areaPx) => {
    cropPx.current = areaPx;
  }, []);

  const apply = async () => {
    if (!cropPx.current || busy) return;
    setBusy(true);
    try {
      const out = await renderCroppedDataUrl({
        src, areaPx: cropPx.current, rotation,
        outputMaxEdge, outputMime, outputQuality,
      });
      onConfirm(out);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onCancel} />
      <div
        className="relative w-full max-w-2xl bg-[#0a0a0a] border border-[#262626] mx-4 max-h-[92vh] flex flex-col"
        data-testid="image-crop-modal"
      >
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#262626]">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-1">
              ◆ Crop & rotate
            </div>
            <h2 className="font-display text-2xl uppercase">Adjust photo</h2>
          </div>
          <button onClick={onCancel} aria-label="Close" className="p-2 text-[#a3a3a3] hover:text-[#ff4500]" data-testid="crop-cancel">
            <X size={18} />
          </button>
        </div>

        <div className="shrink-0 px-5 py-3 border-b border-[#262626] flex items-center gap-2 flex-wrap" data-testid="crop-aspect-row">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mr-1">Aspect</span>
          {ASPECT_PRESETS.map((p) => {
            const active = Math.abs(aspect - p.ratio) < 0.001;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setAspect(p.ratio)}
                title={p.hint}
                className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.18em] ${
                  active
                    ? "border-[#ff4500] bg-[#ff4500]/10 text-[#ff4500]"
                    : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"
                }`}
                data-testid={`crop-aspect-${p.id}`}
              >
                {p.id} <span className="text-[#737373] ml-1 normal-case">{p.label}</span>
              </button>
            );
          })}
        </div>

        {/* Cropper takes whatever vertical space is left — flex-1 + min-h
            ensures we never grow taller than the viewport but still keep
            a usable cropping canvas on tiny screens. */}
        <div className="relative w-full bg-[#000] flex-1 min-h-[260px]">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
            objectFit="contain"
            cropShape="rect"
            showGrid
          />
        </div>

        <div className="shrink-0 p-5 space-y-3 border-t border-[#262626]">
          <ControlRow label="Zoom">
            <input
              type="range" min={1} max={4} step={0.01}
              value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="flex-1 accent-[#ff4500]"
              data-testid="crop-zoom"
            />
            <span className="font-mono text-[10px] text-[#a3a3a3] w-10 text-right">{zoom.toFixed(2)}×</span>
          </ControlRow>
          <ControlRow label="Rotate">
            <input
              type="range" min={-180} max={180} step={1}
              value={rotation} onChange={(e) => setRotation(parseInt(e.target.value, 10))}
              className="flex-1 accent-[#ff4500]"
              data-testid="crop-rotate"
            />
            <button
              type="button" onClick={() => setRotation(0)}
              className="p-1.5 text-[#a3a3a3] hover:text-[#ff4500]"
              aria-label="Reset rotation" data-testid="crop-rotate-reset"
            >
              <RotateCcw size={12} />
            </button>
            <span className="font-mono text-[10px] text-[#a3a3a3] w-10 text-right">{rotation}°</span>
          </ControlRow>
        </div>

        {/* Sticky-bottom action row — must always be visible regardless of
            viewport height. Background pinned solid so it never bleeds
            into the cropper above. */}
        <div className="shrink-0 flex items-center justify-between gap-2 px-5 py-4 border-t border-[#262626] bg-[#0a0a0a]">
          <p className="hidden sm:block font-mono text-[10px] text-[#525252]">
            ◆ Auto-compressed to ≤130KB · output preserves the chosen aspect
          </p>
          <div className="flex gap-2 ml-auto">
            <button
              type="button" onClick={onCancel}
              className="px-4 py-2 border border-[#262626] hover:border-[#ff4500] font-mono text-[11px] uppercase tracking-[0.22em]"
              data-testid="crop-skip"
            >
              Skip
            </button>
            <button
              type="button" onClick={apply} disabled={busy}
              className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="crop-confirm"
            >
              <Check size={14} /> {busy ? "Cropping…" : "Apply crop"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlRow({ label, children }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] w-16">{label}</span>
      {children}
    </div>
  );
}

// ─────────── crop helper ───────────
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

async function renderCroppedDataUrl({ src, areaPx, rotation, outputMaxEdge, outputMime, outputQuality }) {
  const img = await loadImage(src);
  const radians = (rotation * Math.PI) / 180;
  // Render onto a canvas big enough for the rotated image; rotate; then
  // sample the cropped region from the rotated context.
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const bigW = img.width * cos + img.height * sin;
  const bigH = img.width * sin + img.height * cos;
  const big = document.createElement("canvas");
  big.width = bigW; big.height = bigH;
  const bx = big.getContext("2d");
  bx.translate(bigW / 2, bigH / 2);
  bx.rotate(radians);
  bx.drawImage(img, -img.width / 2, -img.height / 2);

  // Now extract the cropped region.
  const out = document.createElement("canvas");
  // Cap output to outputMaxEdge so we don't blow up file size.
  const targetW = Math.min(areaPx.width, outputMaxEdge);
  const scale = targetW / areaPx.width;
  out.width = Math.round(areaPx.width * scale);
  out.height = Math.round(areaPx.height * scale);
  out.getContext("2d").drawImage(
    big,
    areaPx.x, areaPx.y, areaPx.width, areaPx.height,
    0, 0, out.width, out.height,
  );
  // Adaptive quality to stay under 130 KB
  let q = outputQuality;
  let dataUrl = out.toDataURL(outputMime, q);
  if (!dataUrl.startsWith(`data:${outputMime}`)) {
    dataUrl = out.toDataURL("image/jpeg", q);
  }
  while (dataUrl.length / 1024 > 130 && q > 0.4) {
    q -= 0.12;
    dataUrl = out.toDataURL(outputMime, q);
    if (!dataUrl.startsWith(`data:${outputMime}`)) {
      dataUrl = out.toDataURL("image/jpeg", q);
    }
  }
  return dataUrl;
}
