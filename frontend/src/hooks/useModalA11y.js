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
 * - Auto-focuses the first input/textarea/[autofocus] / fallback button
 *   ONCE on mount — it used to run on every render because `onCancel`
 *   was usually an inline arrow function (unstable reference), which
 *   stole focus back to the first input on every keystroke and made
 *   any form inside a modal feel "flaky when entering data" — typing
 *   in the email field would bounce back to the name field mid-word.
 *
 *   The fix: keep `onCancel` in a ref so the keydown listener always
 *   sees the latest callback without needing to re-attach, and split
 *   the auto-focus into its own mount-only effect.
 */
export default function useModalA11y(onCancel, options = {}) {
  const { autoFocusSelector } = options;
  const ref = useRef(null);
  // Stable callback container — callers pass `() => setOpen(false)` which
  // is a new function each render. Stashing it in a ref lets the keydown
  // listener always see the freshest callback without ever re-attaching
  // (the listener reads `onCancelRef.current` at event time).
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  // Key handling — attached once on mount, removed on unmount. No deps
  // on onCancel, so it never re-runs and never re-triggers auto-focus.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelRef.current?.();
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
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Auto-focus — mount-only. Runs after the dialog DOM is mounted.
  // autoFocusSelector is captured once; callers don't rebuild it between
  // renders in practice, and if they did, the old behaviour (re-focus
  // on every change) was what caused the bug in the first place.
  useEffect(() => {
    const t = setTimeout(() => {
      const node =
        (autoFocusSelector && ref.current?.querySelector(autoFocusSelector)) ||
        ref.current?.querySelector("[autofocus], textarea, input, button[type=submit]") ||
        ref.current?.querySelector("button");
      node?.focus?.();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
