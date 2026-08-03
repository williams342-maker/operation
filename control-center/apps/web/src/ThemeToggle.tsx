import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, resolveTheme, setTheme, type Theme } from "./theme";

// Single source of truth for the active theme. Initialises from the resolved
// preference, keeps document[data-theme] in sync, and persists explicit choices.
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => resolveTheme());
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const update = (next: Theme) => {
    setTheme(next);
    setThemeState(next);
  };
  return [theme, update];
}

// Accessible theme toggle. The label states the ACTION (the theme it switches
// to), not just an icon, so screen-reader and pointer users get the same meaning.
export function ThemeToggle({ theme, onChange, variant = "full", className = "" }: {
  theme: Theme;
  onChange: (theme: Theme) => void;
  variant?: "full" | "icon";
  className?: string;
}) {
  const next: Theme = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;
  const label = `Switch to ${next} theme`;
  const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => onChange(next)}
        aria-label={label}
        title={label}
        className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border text-text transition-colors hover:bg-background ${focusRing} ${className}`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      aria-label={label}
      title={label}
      className={`flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-background md:min-h-0 ${focusRing} ${className}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
