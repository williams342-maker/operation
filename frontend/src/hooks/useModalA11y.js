import { useEffect, useRef } from "react";

/**
 * Esc-to-cancel + focus-trap a11y for modal dialogs.
 *
 * Usage:
 *   const dialogRef = useModalA11y(onCancel);
 *   return <div ref={dialogRef} role="dialog" aria-modal="true">…</div>;
 *
 * - Esc → calls onCancel
 * - Tab / Shift+Tab → cycles focus inside the dialog only
 * - Auto-focuses the first input/textarea/[autofocus] / fallback button on mount
 */
export default function useModalA11y(onCancel, options = {}) {
  const { autoFocusSelector } = options;
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const focusables = ref.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      const node =
        (autoFocusSelector && ref.current?.querySelector(autoFocusSelector)) ||
        ref.current?.querySelector("[autofocus], textarea, input, button[type=submit]") ||
        ref.current?.querySelector("button");
      node?.focus?.();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [onCancel, autoFocusSelector]);

  return ref;
}
