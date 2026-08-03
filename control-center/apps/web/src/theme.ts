// Reusable theme primitives for the whole platform (Mission Control, Foundry,
// administration, future workspaces). Pure, framework-free, and unit-testable —
// React bindings live in ThemeToggle.tsx.
//
// Design tokens are CSS variables (see styles.css); switching themes only flips
// document.documentElement[data-theme], so every token-based component re-themes
// with no per-workspace overrides.

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "cc.theme";

// The platform-wide default. Kept as "dark" this pass — do not change without
// explicit approval. The no-flash init script in index.html applies this same
// default before first paint, so the two must stay in sync.
export const DEFAULT_THEME: Theme = "dark";

// When the user has made no explicit choice, we intentionally do NOT follow the
// OS preference in this pass, so the global default cannot silently change from
// dark. The mechanism exists (systemTheme) and can be enabled once following the
// OS default is explicitly approved.
export const FOLLOW_OS_WHEN_UNSET = false;

export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return DEFAULT_THEME;
  }
}

// The effective theme: an explicit stored choice always wins; otherwise the
// preserved default (see FOLLOW_OS_WHEN_UNSET).
export function resolveTheme(): Theme {
  const stored = storedTheme();
  if (stored) return stored;
  return FOLLOW_OS_WHEN_UNSET ? systemTheme() : DEFAULT_THEME;
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage may be unavailable (private mode); still apply for this session */
  }
  applyTheme(theme);
}
