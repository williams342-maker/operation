/**
 * iter428 — Dismissible "NEW · Join Beta App" pill.
 * Modeled on ThemeToggle's light/dark hint (same one-time-show behavior).
 *
 * Shows once per browser, then persists in localStorage. Clicking navigates
 * to /app-testing. Backend config toggle (settings.beta_program.enabled)
 * gates whether the pill renders at all — so admins can hide it globally.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Smartphone, X } from "lucide-react";

const HINT_KEY = "cm-beta-app-hint-dismissed";
const API = process.env.REACT_APP_BACKEND_URL;

export default function BetaTestingHint() {
  const [show, setShow] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // Only mount the pill if the beta program is currently enabled
    // AND the user hasn't dismissed it before.
    fetch(`${API}/api/beta-program/config`, { credentials: "omit" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.enabled) return;
        setEnabled(true);
        try {
          if (localStorage.getItem(HINT_KEY) !== "1") {
            const t = setTimeout(() => setShow(true), 1400);
            return () => clearTimeout(t);
          }
        } catch { /* noop */ }
      })
      .catch(() => {});
  }, []);

  const dismiss = (e) => {
    e?.stopPropagation?.();
    setShow(false);
    try { localStorage.setItem(HINT_KEY, "1"); } catch { /* noop */ }
  };

  if (!enabled || !show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="beta-hint-pill"
      className="fixed z-40 right-4 bottom-24 md:bottom-6 md:right-6 select-none max-w-[calc(100vw-2rem)]"
    >
      {/* Downward arrow tip anchored to the pill's top edge */}
      <span
        aria-hidden="true"
        className="absolute -bottom-1.5 right-4 w-3 h-3 rotate-45 bg-brand border-r border-b border-brand"
      />
      <Link
        to="/app-testing"
        onClick={dismiss}
        className="flex items-center gap-2 bg-brand text-paper px-3 py-2 shadow-[0_6px_24px_rgba(0,0,0,0.35)] whitespace-nowrap hover:opacity-90 transition"
      >
        <Smartphone size={12} aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
          New · Join Beta App
        </span>
        <button
          type="button"
          onClick={dismiss}
          data-testid="beta-hint-close"
          aria-label="Dismiss beta app hint"
          className="ml-1 -mr-1 p-0.5 hover:opacity-70 transition-opacity"
        >
          <X size={12} />
        </button>
      </Link>
    </div>
  );
}
