import React, { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

/**
 * Image lightbox for product detail pages.
 *
 * Why a hand-rolled lightbox instead of a library?
 *   • The product page already imports `react-easy-crop` (used by the
 *     listing editor) but that's a cropping interface, not a viewer.
 *   • A full lightbox lib (yet-another-react-lightbox etc.) is ~30 KB
 *     gzipped — overkill for ~10 listings × ~5 photos = our entire
 *     scope. Hand-rolled is ~80 lines and uses primitives we already
 *     ship (lucide icons + tailwind).
 *
 * Features:
 *   • Click-to-open from the hero image; full-bleed overlay.
 *   • Mouse-wheel + button zoom (1× → 4×). Pan by dragging when zoomed.
 *   • Arrow keys to navigate between photos in the listing.
 *   • Esc closes. Click outside the image (on the backdrop) closes.
 *   • Resets zoom + pan whenever the active image changes.
 *
 * Mobile gestures are NOT custom-coded — we lean on the browser's
 * built-in pinch-zoom on the underlying `<img>` because libraries that
 * wire pinch-zoom across all browsers are heavyweight, and mobile users
 * on iOS/Android get pinch-zoom natively when the image fits inside a
 * fixed-position container.
 */
export default function ImageLightbox({ images, startIndex = 0, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  // Touch state for mobile swipe + pinch detection. Two distinct shapes:
  //   • { kind: "swipe", startX, startY }                 — single finger
  //   • { kind: "pinch", startDist, startZoom }           — two fingers
  // Stored in a ref (not state) so the in-flight gesture doesn't trigger
  // re-renders on every move event.
  const touchRef = useRef(null);

  // Reset zoom/pan whenever the image changes — otherwise the buyer
  // would land on the next photo with the previous photo's pan offset
  // applied, which looks broken.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [index]);

  // Keyboard nav. Bound at the document level so the user doesn't have
  // to focus the lightbox first.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + images.length) % images.length);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % images.length);
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(4, z + 0.25));
      if (e.key === "-") setZoom((z) => Math.max(1, z - 0.25));
      if (e.key === "0") { setZoom(1); setPan({ x: 0, y: 0 }); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  // Lock body scroll while the lightbox is open so the page underneath
  // can't scroll by accident on mouse-wheel zoom.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const onWheel = (e) => {
    e.preventDefault();
    setZoom((z) => Math.max(1, Math.min(4, z - e.deltaY * 0.002)));
  };

  const onMouseDown = (e) => {
    if (zoom <= 1) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPan: { ...pan } };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      setPan({
        x: d.startPan.x + (ev.clientX - d.startX),
        y: d.startPan.y + (ev.clientY - d.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // ---- Touch gestures ----------------------------------------------------
  // Single finger at zoom=1 → swipe horizontally to navigate (>50px swipe
  //   triggers prev/next), vertical swipe down >100px closes the lightbox.
  // Single finger when zoomed in → pan the image.
  // Two fingers → pinch to zoom (1× ↔ 4×). Distance ratio between current
  //   touch points and the start distance scales the zoom relative to
  //   the zoom level when the gesture began.
  const distance = (t0, t1) =>
    Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      touchRef.current = {
        kind: "pinch",
        startDist: distance(e.touches[0], e.touches[1]),
        startZoom: zoom,
      };
    } else if (e.touches.length === 1) {
      touchRef.current = {
        kind: zoom > 1 ? "pan" : "swipe",
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startPan: { ...pan },
      };
    }
  };

  const onTouchMove = (e) => {
    const t = touchRef.current;
    if (!t) return;
    if (t.kind === "pinch" && e.touches.length === 2) {
      const ratio = distance(e.touches[0], e.touches[1]) / t.startDist;
      setZoom(Math.max(1, Math.min(4, t.startZoom * ratio)));
    } else if (t.kind === "pan" && e.touches.length === 1) {
      setPan({
        x: t.startPan.x + (e.touches[0].clientX - t.startX),
        y: t.startPan.y + (e.touches[0].clientY - t.startY),
      });
    }
  };

  const onTouchEnd = (e) => {
    const t = touchRef.current;
    touchRef.current = null;
    if (!t || t.kind !== "swipe") return;
    // changedTouches is the finger that just lifted — that's what we
    // measure the swipe distance against.
    const tch = e.changedTouches[0];
    if (!tch) return;
    const dx = tch.clientX - t.startX;
    const dy = tch.clientY - t.startY;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 50) setIndex((i) => (i - 1 + images.length) % images.length);
      else if (dx < -50) setIndex((i) => (i + 1) % images.length);
    } else if (dy > 100) {
      // Swipe-down to dismiss — common pattern in mobile photo viewers.
      onClose();
    }
  };

  const src = images[index];
  const hasMany = images.length > 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      data-testid="image-lightbox"
    >
      {/* Backdrop — click anywhere outside the image to close. */}
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/95 cursor-default"
        aria-label="Close lightbox"
        data-testid="lightbox-backdrop"
      />

      {/* Image stage */}
      <div
        className="relative w-full h-full flex items-center justify-center overflow-hidden"
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ touchAction: "none" }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          onMouseDown={onMouseDown}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? (dragRef.current ? "grabbing" : "grab") : "zoom-in",
            transition: dragRef.current ? "none" : "transform 0.18s ease-out",
          }}
          className="max-w-[90vw] max-h-[88vh] object-contain select-none pointer-events-auto"
          onClick={(e) => {
            e.stopPropagation();
            if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }); }
            else setZoom(2);
          }}
          data-testid="lightbox-image"
        />
      </div>

      {/* Top bar — close + counter + zoom controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <span
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mr-2"
          data-testid="lightbox-counter"
        >
          {index + 1} / {images.length}
        </span>
        <LbButton onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} testid="lightbox-zoom-out" label="Zoom out">
          <ZoomOut size={16} />
        </LbButton>
        <LbButton onClick={() => setZoom((z) => Math.min(4, z + 0.5))} disabled={zoom >= 4} testid="lightbox-zoom-in" label="Zoom in">
          <ZoomIn size={16} />
        </LbButton>
        <LbButton onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} testid="lightbox-reset" label="Reset zoom">
          <Maximize2 size={16} />
        </LbButton>
        <LbButton onClick={onClose} testid="lightbox-close" label="Close">
          <X size={18} />
        </LbButton>
      </div>

      {/* Side arrows — only when there are multiple images. */}
      {hasMany && (
        <>
          <LbArrow side="left" onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)} testid="lightbox-prev">
            <ChevronLeft size={28} />
          </LbArrow>
          <LbArrow side="right" onClick={() => setIndex((i) => (i + 1) % images.length)} testid="lightbox-next">
            <ChevronRight size={28} />
          </LbArrow>
        </>
      )}

      {/* Hint footer — desktop and mobile show different copy. */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted hidden md:block whitespace-nowrap">
        Wheel to zoom · Drag to pan · ← → to navigate · Esc to close
      </div>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted md:hidden whitespace-nowrap">
        Pinch to zoom · Swipe ← → · Swipe down to close
      </div>
    </div>
  );
}

function LbButton({ onClick, disabled, children, testid, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="p-2 border border-line text-ink-muted hover:text-brand hover:border-brand bg-black/60 backdrop-blur transition disabled:opacity-30 disabled:cursor-not-allowed"
      aria-label={label}
      title={label}
      data-testid={testid}
    >
      {children}
    </button>
  );
}

function LbArrow({ side, onClick, children, testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 ${side === "left" ? "left-4" : "right-4"} p-2 text-ink-muted hover:text-brand bg-black/60 backdrop-blur border border-line hover:border-brand transition`}
      aria-label={side === "left" ? "Previous image" : "Next image"}
      data-testid={testid}
    >
      {children}
    </button>
  );
}
