/**
 * iter349 — Sun/Moon theme toggle button.
 *
 * Mounts in the top nav right cluster. Keyboard accessible, persists via
 * the ThemeProvider's `toggle()`.
 */
import { Sun, Moon } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export default function ThemeToggle({ className = "" }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      className={`p-2 border border-line hover:border-brand text-ink hover:text-brand transition-colors ${className}`}
      data-testid="theme-toggle"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
