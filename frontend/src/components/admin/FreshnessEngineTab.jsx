import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { http } from "../../lib/api";

// iter413bd — Freshness Engine
//
// Lists content that crossed its staleness threshold:
//   Founders 14d · Blog 21d · Products 30d
//
// Operator can "Accept" (will refresh — logged for adoption tracking)
// or "Dismiss" (snoozes for 7 days). Per the ops doc, this surface is
// queue-only: it does NOT perform any actual content edits. The
// "Open" link drops the operator into the existing editor for that
// entity to make the change themselves.

const BUCKETS = [
  { id: "founders", label: "Founders 14d", colorClass: "text-brand" },
  { id: "blog",     label: "Blog 21d",     colorClass: "text-brand" },
  { id: "products", label: "Products 30d", colorClass: "text-brand" },
];

export default function FreshnessEngineTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [bucket, setBucket] = useState("founders");

  const load = async () => {
    setBusy(true); setErr("");
    try {
      const tok = localStorage.getItem("cm_admin_jwt") || "";
      const r = await http.get("/admin/freshness", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Scan failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data[bucket] || [];
  }, [data, bucket]);

  const record = async (row, decision) => {
    if (decision === "dismiss" && !window.confirm(
      `Snooze "${row.label}" from the freshness queue for 7 days?\n\n` +
      `Use this for entries you've already refreshed elsewhere or that don't need updating.`,
    )) return;
    try {
      const tok = localStorage.getItem("cm_admin_jwt") || "";
      await http.post("/admin/freshness/action",
        { id: row.id, kind: row.kind, decision },
        { headers: { Authorization: `Bearer ${tok}` } });
      toast.success(
        decision === "accept"
          ? `Queued for refresh: ${row.label}.`
          : `Snoozed 7 days: ${row.label}.`,
      );
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || `${decision} failed`);
    }
  };

  return (
    <div className="space-y-5" data-testid="freshness-engine-tab">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Content Quality · Refresh Cadence</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1">Freshness Engine</h2>
          <p className="font-mono text-xs text-ink-muted mt-2 max-w-2xl">
            Founders refresh every <b className="text-ink">14 days</b>, blog posts every{" "}
            <b className="text-ink">21 days</b>, products every <b className="text-ink">30 days</b>.
            Accept logs intent (no auto-edits); Dismiss snoozes 7 days.
          </p>
        </div>
        <button
          onClick={load}
          disabled={busy}
          data-testid="freshness-rescan"
          className="shrink-0 px-3 py-2 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
        >
          {busy ? "Scanning…" : "↻ Rescan"}
        </button>
      </div>

      {err && <div className="font-mono text-xs text-red-400 py-4">{err}</div>}

      {data && (
        <>
          {/* Summary pills */}
          <div className="flex flex-wrap gap-2" data-testid="freshness-summary">
            <span className="px-3 py-1.5 border border-line font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              total stale <b className="text-ink ml-1">{data.counts.total}</b>
            </span>
            {BUCKETS.map((b) => (
              <button
                key={b.id}
                onClick={() => setBucket(b.id)}
                data-testid={`freshness-tab-${b.id}`}
                className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                  bucket === b.id
                    ? "border-brand text-brand bg-brand/5"
                    : "border-line text-ink-muted hover:border-ink-muted hover:text-ink"
                }`}
              >
                {b.label} <b className="ml-1">{data.counts[b.id] ?? 0}</b>
              </button>
            ))}
            <span className="px-3 py-1.5 border border-line font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              snoozed <b className="text-ink ml-1">{data.counts.snoozed}</b>
            </span>
            <span className="px-3 py-1.5 border border-emerald-500/40 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-700">
              accepted 7d <b className="ml-1">{data.counts.accepted_last_7d}</b>
            </span>
          </div>

          {/* Table */}
          {rows.length === 0 ? (
            <div className="font-mono text-xs text-emerald-700 py-6" data-testid="freshness-empty">
              ✓ All {bucket} content within freshness threshold.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs" data-testid="freshness-table">
                <thead>
                  <tr className="text-ink-muted uppercase tracking-[0.22em] text-[10px] border-b border-line">
                    <th className="text-left py-2 pr-3">Page</th>
                    <th className="text-right py-2 pr-3">Days stale</th>
                    <th className="text-left py-2 pr-3">Suggested update</th>
                    <th className="text-left py-2 pr-3">Expected impact</th>
                    <th className="text-right py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={`${r.kind}:${r.id}`}
                      className="border-b border-line align-top hover:bg-surface"
                      data-testid={`freshness-row-${r.kind}-${r.id}`}
                    >
                      <td className="py-2 pr-3 break-all">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink hover:text-brand underline-offset-2 hover:underline"
                        >
                          {r.label || r.url}
                        </a>
                        <div className="text-[9px] text-ink-muted mt-0.5 break-all">{r.url}</div>
                      </td>
                      <td className={`py-2 pr-3 text-right whitespace-nowrap ${
                        r.severity === "alert" ? "text-red-500" : "text-brand"
                      }`}>
                        <div className="font-display text-lg leading-none">{r.days_stale}d</div>
                        <div className="text-[9px] text-ink-muted">
                          threshold {r.threshold_days}d
                        </div>
                      </td>
                      <td className="py-2 pr-3 max-w-sm">
                        <div className="text-ink">{r.suggested_update}</div>
                        <div className="text-[9px] text-ink-muted mt-1">{r.reason}</div>
                      </td>
                      <td className="py-2 pr-3 max-w-xs text-ink-muted">
                        {r.expected_impact}
                      </td>
                      <td className="py-2 text-right space-x-1 whitespace-nowrap">
                        <button
                          onClick={() => record(r, "accept")}
                          data-testid={`freshness-accept-${r.kind}-${r.id}`}
                          className="px-2 py-1 border border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 font-mono text-[10px] uppercase tracking-[0.22em] transition"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => record(r, "dismiss")}
                          data-testid={`freshness-dismiss-${r.kind}-${r.id}`}
                          className="px-2 py-1 border border-line text-ink-muted hover:border-ink-muted hover:text-ink font-mono text-[10px] uppercase tracking-[0.22em] transition"
                        >
                          Snooze 7d
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
