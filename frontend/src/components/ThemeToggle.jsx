/**
 * iter349 — Sun/Moon theme toggle button.
 * iter410 — First-visit "New feature" hint with floating arrow pointing
 *           at the icon. Auto-dismisses when the user presses the toggle
 *           OR the explicit close (X). Persists in localStorage so it
 *           never shows again for that browser.
 */
import { useEffect, useState } from "react";
import { Sun, Moon, X } from "lucide-react";
import { useTheme } from "./ThemeProvider";

const HINT_KEY = "cm-theme-hint-dismissed";

export default function ThemeToggle({ className = "" }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const [showHint, setShowHint] = useState(false);

  // Defer hint mount until after first paint so SSR / hydration is clean.
  useEffect(() => {
    try {
      if (localStorage.getItem(HINT_KEY) !== "1") {
        // Tiny delay so the bubble animates in after the page settles.
        const t = setTimeout(() => setShowHint(true), 900);
        return () => clearTimeout(t);
      }
    } catch {
      // localStorage blocked — silently skip the hint.
    }
  }, []);

  const dismissHint = () => {
    setShowHint(false);
    try { localStorage.setItem(HINT_KEY, "1"); } catch { /* noop */ }
  };

  const handleClick = () => {
    if (showHint) dismissHint();
    toggle();
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleClick}
        className={`p-2 border border-line hover:border-brand text-ink hover:text-brand transition-colors ${className}`}
        data-testid="theme-toggle"
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      >
        {isDark ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      {showHint && (
        <div
          role="status"
          aria-live="polite"
          data-testid="theme-toggle-hint"
          className="theme-hint-bubble absolute right-0 top-full mt-3 z-50 select-none"
        >
          {/* Upward-pointing arrow tip, aligned to the button center */}
          <span
            aria-hidden="true"
            className="absolute -top-1.5 right-3 w-3 h-3 rotate-45 bg-brand border-l border-t border-brand"
          />
          <div className="flex items-center gap-2 bg-brand text-paper px-3 py-2 shadow-[0_6px_24px_rgba(0,0,0,0.35)] whitespace-nowrap">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em]">
              New · Light / Dark
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); dismissHint(); }}
              data-testid="theme-toggle-hint-close"
              aria-label="Dismiss light/dark hint"
              className="ml-1 -mr-1 p-0.5 hover:opacity-70 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
