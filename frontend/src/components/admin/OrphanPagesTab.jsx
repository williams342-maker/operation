import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { http } from "../../lib/api";

// iter413bc — Orphan Pages Detector
//
// Lists internal-link health problems: pages with 0 incoming links,
// pages with 1-2 incoming links, and pages > 3 clicks deep from the
// homepage. Operator can promote (adds a link from a parent surface)
// or dismiss (intentionally orphan — won't surface again).

const TABS = [
  { id: "orphans",    label: "Orphan",      countKey: "orphan_count"     },
  { id: "low_linked", label: "Low-linked",  countKey: "low_linked_count" },
  { id: "deep",       label: "Deep (>3)",   countKey: "deep_count"       },
];

export default function OrphanPagesTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("orphans");
  const [typeFilter, setTypeFilter] = useState("all");

  const load = async () => {
    setBusy(true); setErr("");
    try {
      const tok = localStorage.getItem("cm_admin_jwt") || "";
      const r = await http.get("/admin/orphan-pages", {
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
    const r = data[tab] || [];
    if (typeFilter === "all") return r;
    return r.filter((x) => x.type === typeFilter);
  }, [data, tab, typeFilter]);

  const types = useMemo(() => {
    if (!data) return [];
    const all = [
      ...(data.orphans || []),
      ...(data.low_linked || []),
      ...(data.deep || []),
    ];
    return Array.from(new Set(all.map((r) => r.type))).sort();
  }, [data]);

  const promote = async (row) => {
    const parent = window.prompt(
      `Add a link to:\n  ${row.url}\n\nFrom which parent surface?`,
      row.suggested_parent || "/",
    );
    if (!parent) return;
    try {
      const tok = localStorage.getItem("cm_admin_jwt") || "";
      await http.post("/admin/orphan-pages/promote",
        { url: row.url, parent: parent.trim() },
        { headers: { Authorization: `Bearer ${tok}` } },
      );
      toast.success(`Linked ${row.url} from ${parent}.`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Promote failed");
    }
  };

  const dismiss = async (row) => {
    if (!window.confirm(`Dismiss ${row.url}?\n\nWon't surface in future scans (use for intentionally-orphan URLs).`)) return;
    try {
      const tok = localStorage.getItem("cm_admin_jwt") || "";
      await http.post("/admin/orphan-pages/dismiss",
        { url: row.url }, { headers: { Authorization: `Bearer ${tok}` } });
      toast.success(`Dismissed ${row.url}.`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Dismiss failed");
    }
  };

  return (
    <div className="space-y-5" data-testid="orphan-pages-tab">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Internal Linking · Discoverability</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1">Orphan Pages</h2>
          <p className="font-mono text-xs text-ink-muted mt-2 max-w-2xl">
            Pages with 0–2 incoming internal links, plus pages buried more than 3 clicks from
            the homepage. Promote = add a link from a parent surface (homepage / shop / journal).
            Dismiss = intentionally-orphan, hide from future scans.
          </p>
        </div>
        <button
          onClick={load}
          disabled={busy}
          data-testid="orphan-scan"
          className="shrink-0 px-3 py-2 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
        >
          {busy ? "Scanning…" : "↻ Rescan"}
        </button>
      </div>

      {err && <div className="font-mono text-xs text-red-400 py-4">{err}</div>}

      {data && (
        <>
          {/* Summary pills */}
          <div className="flex flex-wrap gap-2" data-testid="orphan-summary">
            <span className="px-3 py-1.5 border border-line font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              total pages <b className="text-ink ml-1">{data.total_pages}</b>
            </span>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                data-testid={`orphan-tab-${t.id}`}
                className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                  tab === t.id
                    ? "border-brand text-brand bg-brand/5"
                    : "border-line text-ink-muted hover:border-ink-muted hover:text-ink"
                }`}
              >
                {t.label} <b className="ml-1">{data[t.countKey]}</b>
              </button>
            ))}
            {data.dismissed_count > 0 && (
              <span className="px-3 py-1.5 border border-line font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                dismissed <b className="text-ink ml-1">{data.dismissed_count}</b>
              </span>
            )}
          </div>

          {/* Type filter */}
          {types.length > 1 && (
            <div className="flex flex-wrap gap-1 pb-3 border-b border-line">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted self-center mr-2">filter</span>
              {["all", ...types].map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  data-testid={`orphan-typefilter-${t}`}
                  className={`px-2 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                    typeFilter === t
                      ? "border-brand text-brand"
                      : "border-line text-ink-muted hover:border-ink-muted hover:text-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          {/* Table */}
          {rows.length === 0 ? (
            <div className="font-mono text-xs text-emerald-700 py-6" data-testid="orphan-empty">
              ✓ No {tab.replace("_", "-")} pages of this type.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs" data-testid="orphan-table">
                <thead>
                  <tr className="text-ink-muted uppercase tracking-[0.22em] text-[10px] border-b border-line">
                    <th className="text-left py-2 pr-3">URL</th>
                    <th className="text-left py-2 pr-3">Type</th>
                    <th className="text-right py-2 pr-3">In</th>
                    <th className="text-right py-2 pr-3">Depth</th>
                    <th className="text-left py-2 pr-3">Suggested parent</th>
                    <th className="text-right py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.url} className="border-b border-line hover:bg-surface" data-testid={`orphan-row-${r.url}`}>
                      <td className="py-2 pr-3 break-all">
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-brand underline-offset-2 hover:underline">
                          {r.url}
                        </a>
                        {r.incoming_from?.length > 0 && (
                          <div className="text-[9px] text-ink-muted mt-0.5">
                            from: {r.incoming_from.slice(0, 3).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">{r.type}</td>
                      <td className={`py-2 pr-3 text-right ${r.incoming_count === 0 ? "text-red-500" : r.incoming_count <= 2 ? "text-brand" : "text-ink-muted"}`}>
                        {r.incoming_count}
                      </td>
                      <td className={`py-2 pr-3 text-right ${r.depth < 0 ? "text-red-500" : r.depth > 3 ? "text-brand" : "text-ink-muted"}`}>
                        {r.depth < 0 ? "—" : r.depth}
                      </td>
                      <td className="py-2 pr-3 text-ink-muted">{r.suggested_parent || "—"}</td>
                      <td className="py-2 text-right space-x-1 whitespace-nowrap">
                        <button
                          onClick={() => promote(r)}
                          data-testid={`orphan-promote-${r.url}`}
                          className="px-2 py-1 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
                        >
                          Promote →
                        </button>
                        <button
                          onClick={() => dismiss(r)}
                          data-testid={`orphan-dismiss-${r.url}`}
                          className="px-2 py-1 border border-line hover:border-warn hover:text-warn font-mono text-[10px] uppercase tracking-[0.22em] transition"
                        >
                          Dismiss
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
