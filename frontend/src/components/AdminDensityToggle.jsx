/**
 * iter353 — Admin density toggle (Phase E bonus).
 *
 * Mounted in the AdminDashboard sidebar so admins managing 30+ tabs can
 * switch between Compact (tight rows, more on screen) and Comfortable
 * (default, breathing room). Persists in `localStorage["cm_admin_density"]`.
 *
 * Strategy: toggles `admin-compact` class on `<html>`. CSS rules in
 * `index.css` then tighten padding/gap/space-y inside any element with
 * `data-testid="admin-dashboard"` ancestor. Opt-in via the data-testid
 * means it only affects the admin surface, not maker or buyer pages.
 */
import { useEffect, useState, useCallback } from "react";
import { Rows3, AlignJustify } from "lucide-react";

const STORAGE_KEY = "cm_admin_density";

function readInitial() {
  if (typeof window === "undefined") return "comfortable";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "compact" || v === "comfortable") return v;
  } catch { /* localStorage disabled */ }
  return "comfortable";
}

function applyToDom(density) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (density === "compact") root.classList.add("admin-compact");
  else root.classList.remove("admin-compact");
}

export default function AdminDensityToggle({ className = "" }) {
  const [density, setDensity] = useState(readInitial);

  useEffect(() => {
    applyToDom(density);
    try { localStorage.setItem(STORAGE_KEY, density); } catch { /* ignore */ }
    return () => {
      // Don't leave the class behind when admin navigates away from /admin
      // — the compact rules are scoped by `[data-testid="admin-dashboard"]`
      // so they're harmless elsewhere, but clean up anyway.
      document.documentElement.classList.remove("admin-compact");
    };
  }, [density]);

  const toggle = useCallback(() => {
    setDensity((d) => (d === "compact" ? "comfortable" : "compact"));
  }, []);

  const isCompact = density === "compact";
  return (
    <button
      type="button"
      onClick={toggle}
      className={`px-2 py-1.5 border border-line hover:border-brand text-ink-muted hover:text-brand transition-colors font-mono text-[9px] uppercase tracking-[0.22em] flex items-center gap-1.5 ${className}`}
      data-testid="admin-density-toggle"
      title={isCompact ? "Switch to comfortable density" : "Switch to compact density"}
      aria-label={isCompact ? "Switch to comfortable density" : "Switch to compact density"}
    >
      {isCompact ? <Rows3 size={11} /> : <AlignJustify size={11} />}
      <span className="hidden lg:inline">{isCompact ? "Compact" : "Comfortable"}</span>
    </button>
  );
}
