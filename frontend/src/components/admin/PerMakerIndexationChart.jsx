/**
 * iter355b/iter356 — Per-maker indexation chart drill-down (shared).
 *
 * Originally inline in SettingsTab.jsx as iter355b; extracted to its
 * own module in iter356 so ApprovedMakersTab and the maker admin
 * detail row can render the same chart inline next to each maker.
 *
 * Props:
 *   initialSlug   — preset the maker_slug (and auto-load if set)
 *   hideInput     — hide the maker-slug picker (when slug comes from props)
 *   height        — chart height in px (default 80)
 *   endpoint      — `"admin"` (default) hits the admin GSC route;
 *                   `"maker"` hits the maker-scoped self-serve route at
 *                   `/api/maker/seo/indexation-trend` (slug is ignored
 *                   server-side — token derives it).
 *
 * Backed by `/api/admin/gsc/snapshots-trend/maker/{slug}` (admin) or
 * `/api/maker/seo/indexation-trend` (maker), both reading the
 * `per_maker` rollup persisted in `gsc_indexed_snapshots` since
 * iter354.
 */
import React, { useEffect, useState } from "react";
import { LineChart, Line, ResponsiveContainer, Tooltip as RTooltip, YAxis } from "recharts";
import { fetchAdminApprovedMakers } from "../../lib/api";

// iter357 — module-scope cache so the makers list is only fetched
// once per page load no matter how many chart instances mount.
let _MAKER_OPTIONS_CACHE = [];


export default function PerMakerIndexationChart({
  initialSlug = "", hideInput = false, height = 80, endpoint = "admin",
}) {
  const API = process.env.REACT_APP_BACKEND_URL;
  const [slug, setSlug] = useState(initialSlug);
  const [submitted, setSubmitted] = useState(initialSlug);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [makerOptions, setMakerOptions] = useState(_MAKER_OPTIONS_CACHE);

  const isMakerMode = endpoint === "maker";

  const loadOptions = async () => {
    if (_MAKER_OPTIONS_CACHE.length > 0) return;
    try {
      const r = await fetchAdminApprovedMakers();
      const opts = (r?.makers || r || []).map((m) => ({
        slug: m.slug, name: m.name || m.slug,
      }));
      _MAKER_OPTIONS_CACHE = opts;
      setMakerOptions(opts);
    } catch {
      // Silent — picker still works as free-text input.
    }
  };

  useEffect(() => {
    // Maker mode: always auto-load (slug derives from the bearer token).
    if (!submitted && !isMakerMode) return;
    let cancelled = false;
    (async () => {
      setBusy(true); setErr(""); setData(null);
      try {
        const tokenKey = isMakerMode ? "cm_maker_jwt" : "cm_admin_jwt";
        const token = localStorage.getItem(tokenKey) || "";
        const url = isMakerMode
          ? `${API}/api/maker/seo/indexation-trend?days=30`
          : `${API}/api/admin/gsc/snapshots-trend/maker/${encodeURIComponent(submitted)}?days=30`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (!cancelled) setData(await r.json());
      } catch (e) {
        if (!cancelled) setErr(e.message || "Failed to load");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [API, submitted, isMakerMode]);

  const onSubmit = (e) => {
    e.preventDefault();
    setSubmitted(slug.trim().toLowerCase());
  };

  return (
    <div className="border border-line bg-paper p-3 mb-3" data-testid="gsc-per-maker-chart-card">
      <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          {isMakerMode
            ? "◆ Your indexed % trend · last 30 days"
            : hideInput
              ? `◆ Indexed % trend · ${submitted || "—"}`
              : "◆ Drill into one maker"}
        </div>
        {data && data.snapshot_count >= 2 && (
          <div className="font-mono text-[10px] text-ink-muted">
            {data.snapshot_count} snapshot{data.snapshot_count === 1 ? "" : "s"} ·
            first {data.first_snapshot_at} ·
            latest {data.latest_indexed_pct?.toFixed(1)}%
          </div>
        )}
      </div>
      {!hideInput && !isMakerMode && (
        <form onSubmit={onSubmit} className="flex gap-2 mb-2">
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onFocus={loadOptions}
            list="per-maker-slug-options"
            placeholder={makerOptions.length
              ? `maker-slug (${makerOptions.length} known)`
              : "maker-slug (e.g. williams-cnc)"}
            className="flex-1 bg-paper border border-line focus:border-brand outline-none px-3 py-1.5 font-mono text-xs text-ink"
            data-testid="gsc-per-maker-slug-input"
            autoComplete="off"
          />
          <datalist id="per-maker-slug-options">
            {makerOptions.map((m) => (
              <option key={m.slug} value={m.slug}>{m.name}</option>
            ))}
          </datalist>
          <button
            type="submit"
            disabled={busy || !slug.trim()}
            className="px-3 py-1.5 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
            data-testid="gsc-per-maker-load-btn"
          >
            {busy ? "Loading…" : "Load chart"}
          </button>
        </form>
      )}

      {err && (
        <p className="font-mono text-xs text-red-400 mb-2"
           data-testid="gsc-per-maker-error">{err}</p>
      )}

      {busy && (hideInput || isMakerMode) && (
        <div className="font-mono text-[10px] text-ink-muted">Loading…</div>
      )}

      {data && data.snapshot_count >= 2 && (
        <div style={{ width: "100%", height }} data-testid="gsc-per-maker-chart">
          <ResponsiveContainer>
            <LineChart data={data.series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <YAxis type="number" domain={[0, 100]} hide />
              <RTooltip
                contentStyle={{
                  background: "var(--paper)",
                  border: "1px solid var(--line)",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "11px",
                }}
                formatter={(v) => (v === null ? ["—", "Indexed %"] : [`${v.toFixed(1)}%`, "Indexed"])}
                labelFormatter={(d) => d}
              />
              <Line
                type="monotone"
                dataKey="indexed_pct"
                stroke="#06b6d4"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {data && data.snapshot_count < 2 && (submitted || isMakerMode) && !err && (
        <div className="font-mono text-[10px] text-ink-muted"
             data-testid="gsc-per-maker-bootstrap">
          {isMakerMode
            ? `Collecting baseline for your shop (need ≥2 snapshots; have ${data.snapshot_count}). The daily GSC sweep usually populates this within 48 h of approval.`
            : `Collecting baseline for ${submitted} (need ≥2 snapshots; have ${data.snapshot_count}). Once iter354 has run twice for this maker, the trend renders here.`}
        </div>
      )}
    </div>
  );
}
