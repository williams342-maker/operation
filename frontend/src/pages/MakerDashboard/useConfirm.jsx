import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polished industrial-themed confirmation dialog. Returns a tuple
 * `[confirm, modal]`:
 *   • `confirm({title, body, confirmLabel, tone})` → Promise<boolean>
 *   • `modal` is the JSX you must render inside your component tree
 *
 * Replaces native `window.confirm()` so every "are you sure?" matches the
 * Crafters Market aesthetic and is testable. Closing via Esc, X, or outside
 * click resolves to false.
 */
export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState({});
  const resolverRef = useRef(null);
  const confirmBtnRef = useRef(null);

  const confirm = useCallback((options = {}) => {
    setOpts({
      title: options.title || "Are you sure?",
      body: options.body || "",
      confirmLabel: options.confirmLabel || "Confirm",
      cancelLabel: options.cancelLabel || "Cancel",
      tone: options.tone || "primary",  // "primary" | "danger" | "warn"
      testId: options.testId || "confirm-modal",
    });
    setOpen(true);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((result) => {
    setOpen(false);
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Auto-focus the confirm button so Enter triggers it.
    setTimeout(() => confirmBtnRef.current?.focus(), 30);
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const toneClasses = {
    primary: "bg-[#ff4500] text-black border-[#ff4500] hover:bg-[#ff6a2c]",
    danger: "bg-red-500 text-black border-red-500 hover:bg-red-400",
    warn: "bg-amber-400 text-black border-amber-400 hover:bg-amber-300",
  };

  const accentClasses = {
    primary: "text-[#ff4500]",
    danger: "text-red-400",
    warn: "text-amber-400",
  };

  const modal = open ? (
    <div
      className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid={opts.testId}
      onClick={(e) => { if (e.target === e.currentTarget) close(false); }}
    >
      <div
        className="bg-[#0a0a0a] border border-[#262626] w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 py-5 border-b border-[#262626]">
          <div>
            <div className={`font-mono text-[10px] uppercase tracking-[0.3em] ${accentClasses[opts.tone] || accentClasses.primary} mb-2`}>
              ◆ Confirm
            </div>
            <h3 className="font-display text-2xl uppercase leading-tight" data-testid={`${opts.testId}-title`}>
              {opts.title}
            </h3>
          </div>
          <button
            onClick={() => close(false)}
            aria-label="Close"
            className="font-mono text-xs text-[#525252] hover:text-[#ff4500] transition pl-3"
            data-testid={`${opts.testId}-close`}
          >
            ✕
          </button>
        </div>

        {opts.body && (
          <div className="px-6 py-5 font-mono text-xs text-[#a3a3a3] leading-relaxed" data-testid={`${opts.testId}-body`}>
            {opts.body}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#262626]">
          <button
            onClick={() => close(false)}
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition px-3 py-2"
            data-testid={`${opts.testId}-cancel`}
          >
            {opts.cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={() => close(true)}
            className={`font-mono text-[11px] uppercase tracking-[0.22em] px-5 py-2.5 border transition ${toneClasses[opts.tone] || toneClasses.primary}`}
            data-testid={`${opts.testId}-confirm`}
          >
            {opts.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [confirm, modal];
}
