/**
 * iter349 — Theme provider + hook for the Crafters Market light/dark redesign.
 *
 * - Default theme: "light" (per design brief — buyers + makers both start light).
 * - First-visit fallback: respects `prefers-color-scheme: dark` IF user hasn't
 *   set a preference yet.
 * - Persists choice in `localStorage["cm_theme"]`.
 * - Adds/removes `dark` class on `<html>` so Tailwind's `darkMode: ["class"]`
 *   picks it up everywhere.
 */
import { createContext, useContext, useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "cm_theme";
const ThemeContext = createContext({ theme: "light", setTheme: () => {}, toggle: () => {} });

function readInitialTheme() {
  if (typeof window === "undefined") return "light";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* localStorage disabled */ }
  // No explicit preference — respect OS hint, otherwise default LIGHT.
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function applyToDom(theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialTheme);

  useEffect(() => {
    applyToDom(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const setTheme = useCallback((next) => {
    setThemeState(next === "dark" ? "dark" : "light");
  }, []);

  const toggle = useCallback(() => {
    setThemeState((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
