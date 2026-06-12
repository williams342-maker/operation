import React from "react";

/**
 * Tiny CSS-only sparkline. Each bar is 1/12 of the width minus a 2px gap.
 * `data` is [{week_start, total}] in chronological order (oldest first).
 *
 * Renders a flat line if all totals are zero (no data yet).
 */
export function Sparkline({ data = [], height = 56, label = "Weekly", testId }) {
  const max = data.reduce((m, d) => Math.max(m, Number(d.total || 0)), 0);
  const total = data.reduce((s, d) => s + Number(d.total || 0), 0);
  const last = data.length ? Number(data[data.length - 1].total || 0) : 0;
  const prev = data.length > 1 ? Number(data[data.length - 2].total || 0) : 0;
  const delta = prev === 0
    ? (last > 0 ? "new" : "flat")
    : last > prev ? "up"
    : last < prev ? "down" : "flat";
  const fmtDate = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch { return ""; }
  };

  return (
    <div className="border border-line p-6" data-testid={testId}>
      <div className="flex items-baseline justify-between mb-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
          ◆ {label} GMV · last {data.length} weeks
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-ink-muted uppercase tracking-[0.22em]">
            ${last.toFixed(0)} this week
          </span>
          {delta === "up" && (
            <span className="font-mono text-[10px] text-emerald-700">▲</span>
          )}
          {delta === "down" && (
            <span className="font-mono text-[10px] text-red-400">▼</span>
          )}
          {delta === "flat" && (
            <span className="font-mono text-[10px] text-ink-muted">—</span>
          )}
          {delta === "new" && (
            <span className="font-mono text-[10px] text-brand">NEW</span>
          )}
        </div>
      </div>
      {total === 0 ? (
        <p className="font-mono text-xs text-ink-muted">
          No paid orders in the last {data.length} weeks.
        </p>
      ) : (
        <div className="flex items-end gap-[2px]" style={{ height }}>
          {data.map((d, i) => {
            const v = Number(d.total || 0);
            const h = max > 0 ? Math.max(2, (v / max) * height) : 2;
            const isLast = i === data.length - 1;
            return (
              <div
                key={d.week_start}
                title={`${fmtDate(d.week_start)} · $${v.toFixed(0)}`}
                className={`flex-1 transition-colors ${
                  isLast ? "bg-brand" : "bg-ink-muted/30 hover:bg-ink-muted"
                }`}
                style={{ height: `${h}px` }}
                data-testid={`sparkline-bar-${i}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 7d-vs-prior-7d delta badge for the Web Analytics headline numbers.
 * `delta` shape: { current, prior, delta_pct, direction: 'up'|'down'|'flat'|'new' }
 */
export function DeltaBadge({ delta, testId }) {
  if (!delta) return null;
  const { direction, delta_pct } = delta;
  const cls =
    direction === "up" ? "text-emerald-700"
    : direction === "down" ? "text-red-400"
    : direction === "new" ? "text-brand"
    : "text-ink-muted";
  const arrow =
    direction === "up" ? "▲"
    : direction === "down" ? "▼"
    : direction === "new" ? "✦"
    : "—";
  const label =
    direction === "new" ? "NEW"
    : delta_pct === null || delta_pct === undefined ? ""
    : `${delta_pct > 0 ? "+" : ""}${delta_pct}%`;
  return (
    <span
      className={`font-mono text-[9px] uppercase tracking-[0.18em] ${cls}`}
      data-testid={testId}
    >
      {arrow} {label}
    </span>
  );
}
