/*
 * Widget framework (iter419) — shared shell + registry pattern
 * used across Crafters Market, Williams Innovation Group, and
 * CortexViral dashboards.
 *
 *   - `WidgetShell` provides the standard container: title bar,
 *     loading state, error state, refresh, and optional actions.
 *   - `widgetRegistry` maps a widget key → { title, defaultRefreshMs,
 *     component }. New widgets are registered in `registry.js`.
 *   - `Dashboard` renders a list of widget keys from a layout config.
 *     Layouts are just arrays — one per product/dashboard variant.
 */
import { useEffect, useRef, useState, useCallback } from "react";

// -------- WidgetShell --------
export function WidgetShell({
  title,
  eyebrow,
  loading,
  error,
  onRefresh,
  refreshMs,
  actions,
  children,
  testId,
  compact,
}) {
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!refreshMs || !onRefresh) return undefined;
    timerRef.current = setInterval(() => {
      onRefresh();
      setLastRefreshed(new Date());
    }, refreshMs);
    return () => clearInterval(timerRef.current);
  }, [onRefresh, refreshMs]);

  useEffect(() => {
    if (!loading && !error) setLastRefreshed(new Date());
  }, [loading, error]);

  const ago = useCallback(() => {
    if (!lastRefreshed) return "";
    const s = Math.round((Date.now() - lastRefreshed.getTime()) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m`;
  }, [lastRefreshed]);

  return (
    <section
      className="border border-line bg-paper/50 relative"
      data-testid={testId}
      data-widget-title={title}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
        <div>
          {eyebrow && (
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand">
              ◆ {eyebrow}
            </div>
          )}
          <h3 className="font-display text-lg leading-tight">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {onRefresh && (
            <button
              type="button"
              onClick={() => { onRefresh(); setLastRefreshed(new Date()); }}
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted hover:text-brand px-2 py-1"
              title={lastRefreshed ? `Refreshed ${ago()} ago` : "Refresh"}
              data-testid={testId ? `${testId}-refresh` : undefined}
            >
              ↻
            </button>
          )}
        </div>
      </header>
      <div className={compact ? "p-3" : "p-4"}>
        {loading && (
          <div className="font-mono text-xs text-ink-muted animate-pulse" data-testid={testId ? `${testId}-loading` : undefined}>
            Loading…
          </div>
        )}
        {error && !loading && (
          <div className="font-mono text-xs text-red-400" data-testid={testId ? `${testId}-error` : undefined}>
            {error}
          </div>
        )}
        {!loading && !error && children}
      </div>
    </section>
  );
}

// -------- Registry + Dashboard --------
const _registry = new Map();

export function registerWidget(key, def) {
  // def: { component, defaultRefreshMs?, title? }
  _registry.set(key, def);
}

export function getWidget(key) {
  return _registry.get(key) || null;
}

export function Dashboard({ layout, className }) {
  return (
    <div className={className || "grid grid-cols-1 xl:grid-cols-2 gap-6"} data-testid="dashboard-grid">
      {layout.map((entry) => {
        const key = typeof entry === "string" ? entry : entry.key;
        const props = typeof entry === "string" ? {} : entry.props || {};
        const def = _registry.get(key);
        if (!def || !def.component) return null;
        const Comp = def.component;
        return (
          <div key={key} className={typeof entry === "object" && entry.span === 2 ? "xl:col-span-2" : ""}>
            <Comp {...props} />
          </div>
        );
      })}
    </div>
  );
}

// -------- Fetch helper (admin scope) --------
export function useAdminFetch(path, { autoRefreshMs } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const API = process.env.REACT_APP_BACKEND_URL;

  const load = useCallback(async () => {
    setError("");
    try {
      const tok = localStorage.getItem("cm_admin_jwt") || "";
      const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${tok}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(e.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }, [path, API]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefreshMs) return undefined;
    const t = setInterval(load, autoRefreshMs);
    return () => clearInterval(t);
  }, [load, autoRefreshMs]);

  return { data, loading, error, refresh: load };
}
