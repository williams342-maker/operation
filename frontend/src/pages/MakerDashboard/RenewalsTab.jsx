import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { RefreshCw, Pause, Check } from "lucide-react";
import {
  fetchMakerRenewalsSummary, bulkRenewMakerProducts,
  bulkSetRenewalOption, bulkPauseMakerProducts,
} from "../../lib/api";
import { useConfirm } from "../../hooks/useConfirm";
import RenewalSummary from "./RenewalSummary";

/**
 * Renewals tab — combines the Renewal Summary + Calendar widgets
 * (re-used as `<RenewalSummary />`) with the Bulk Renewal Manager
 * table view in a single dashboard tab.
 *
 * Replaces the standalone `/maker/renewals` page (which now redirects
 * here). One tab, one source of truth.
 *
 * Data source: `/api/maker/renewals/summary` for the table. The
 * `RenewalSummary` widget makes its OWN fetch — duplicate request is
 * fine (both cached at HTTP layer; the redundancy keeps each widget
 * standalone and easier to lift back out if we ever revert).
 */
const FILTERS = [
  { key: "7d", label: "Next 7d", max: 7 },
  { key: "14d", label: "Next 14d", max: 14 },
  { key: "30d", label: "Next 30d", max: 30 },
  { key: "all", label: "All", max: 999 },
];

export default function RenewalsTab() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("30d");
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState("");
  const [confirm, confirmModal] = useConfirm();

  useEffect(() => {
    if (!localStorage.getItem("cm_maker_jwt")) {
      navigate("/maker/login", { replace: true });
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const d = await fetchMakerRenewalsSummary();
      setData(d);
    } catch (e) {
      if (e?.response?.status === 401) {
        navigate("/maker/login", { replace: true });
      } else {
        setErr(e?.response?.data?.detail || "Couldn't load renewal data.");
      }
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const cap = FILTERS.find((f) => f.key === filter)?.max ?? 30;
    return data.listings.filter((l) => l.days_left == null || l.days_left <= cap);
  }, [data, filter]);

  const toggle = (slug) => {
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  };
  const toggleAll = () => {
    if (selected.size === filtered.length && filtered.length > 0) setSelected(new Set());
    else setSelected(new Set(filtered.map((l) => l.slug)));
  };

  const runBulk = async (label, fn, msg) => {
    if (selected.size === 0) {
      toast.error("Select at least one listing.");
      return;
    }
    setBusy(label);
    try {
      const slugs = Array.from(selected);
      const res = await fn(slugs);
      toast.success(msg(res, slugs.length));
      setSelected(new Set());
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || `${label} failed.`);
    } finally {
      setBusy("");
    }
  };

  const doBulkRenew = async () => {
    const ok = await confirm({
      title: `Renew ${selected.size} listing${selected.size === 1 ? "" : "s"}?`,
      body: "Each renewal extends the listing's expiry by 4 months and may accrue the standard listing fee. Free for Founders/Plus members within their monthly quota.",
      confirmLabel: "Renew now",
      tone: "primary",
      testId: "confirm-bulk-renew",
    });
    if (!ok) return;
    await runBulk(
      "Renew",
      bulkRenewMakerProducts,
      (res, n) => `Renewed ${res.renewed?.length ?? n} listing${(res.renewed?.length ?? n) === 1 ? "" : "s"}.`,
    );
  };
  const doBulkPause = async () => {
    const ok = await confirm({
      title: `Pause ${selected.size} listing${selected.size === 1 ? "" : "s"}?`,
      body: "Selected listings will flip to draft. Buyers won't see them until you republish.",
      confirmLabel: "Pause",
      tone: "danger",
      testId: "confirm-bulk-pause",
    });
    if (!ok) return;
    await runBulk(
      "Pause",
      bulkPauseMakerProducts,
      (res, n) => `Paused ${res.paused ?? n} listing${(res.paused ?? n) === 1 ? "" : "s"}.`,
    );
  };
  const doBulkSetMode = async (mode) => {
    await runBulk(
      `Set ${mode}`,
      (slugs) => bulkSetRenewalOption(slugs, mode),
      (res, n) => `Updated ${res.updated ?? n} listing${(res.updated ?? n) === 1 ? "" : "s"} → ${mode}.`,
    );
  };

  return (
    <div data-testid="maker-renewals-tab">
      {confirmModal}

      <div className="mb-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#ff4500] mb-3">
          ◆ Lifecycle
        </div>
        <h1 className="font-display text-4xl md:text-5xl uppercase">Renewals</h1>
        <p className="font-mono text-xs text-[#a3a3a3] mt-3 max-w-2xl leading-relaxed">
          Manage every listing's renewal lifecycle. The widgets below summarise what's coming up; the table lets you renew, pause, or flip modes in bulk.
        </p>
      </div>

      {/* Summary card + calendar — re-used unchanged */}
      <div className="mb-8">
        <RenewalSummary />
      </div>

      {/* Filter pills + bulk manager */}
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">
        ◆ Bulk manager
      </div>

      <div className="flex items-center gap-2 mb-6 flex-wrap" data-testid="renewals-filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => { setFilter(f.key); setSelected(new Set()); }}
              className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                filter === f.key
                  ? "border-[#ff4500] bg-[#ff4500] text-[#0a0a0a]"
                  : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500] hover:text-[#ff4500]"
              }`}
              data-testid={`renewals-filter-${f.key}`}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={load}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] text-[#a3a3a3] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
            data-testid="renewals-refresh"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {err && (
          <div className="border border-amber-500/40 bg-amber-500/5 p-4 text-amber-200 font-mono text-xs mb-6">
            {err}
          </div>
        )}

        {loading ? (
          <div className="space-y-2" data-testid="renewals-skeleton">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border border-[#262626] p-3 flex items-center gap-3 animate-pulse">
                <div className="w-5 h-5 bg-[#1a1a1a]" />
                <div className="w-10 h-10 bg-[#1a1a1a] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 bg-[#1a1a1a]" />
                  <div className="h-2 w-1/4 bg-[#1a1a1a]" />
                </div>
                <div className="h-3 w-16 bg-[#1a1a1a]" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="border border-dashed border-[#262626] p-10 text-center">
            <div className="font-mono text-xs text-[#a3a3a3]">
              Nothing in this window. Try widening to "All".
            </div>
          </div>
        ) : (
          <RenewalsTable
            rows={filtered}
            selected={selected}
            toggle={toggle}
            toggleAll={toggleAll}
          />
        )}

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 bg-[#0d0d0d] border-t border-[#ff4500] py-3 px-4 md:px-8"
          data-testid="renewals-bulk-bar"
        >
          <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-3">
            <div className="font-mono text-xs text-[#ff4500] mr-auto">
              ◆ {selected.size} selected
            </div>
            <button
              onClick={doBulkRenew}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 bg-[#ff4500] hover:bg-[#ff5f1f] text-[#0a0a0a] font-mono text-[10px] uppercase tracking-[0.22em] px-4 py-2 disabled:opacity-50"
              data-testid="bulk-renew-btn"
            >
              <Check size={12} /> {busy === "Renew" ? "Renewing…" : "Renew now"}
            </button>
            <button
              onClick={() => doBulkSetMode("automatic")}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 font-mono text-[10px] uppercase tracking-[0.22em] px-4 py-2 disabled:opacity-50"
              data-testid="bulk-set-auto-btn"
            >
              → Auto-renew
            </button>
            <button
              onClick={() => doBulkSetMode("manual")}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 font-mono text-[10px] uppercase tracking-[0.22em] px-4 py-2 disabled:opacity-50"
              data-testid="bulk-set-manual-btn"
            >
              → Manual
            </button>
            <button
              onClick={doBulkPause}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 border border-red-500/40 text-red-400 hover:bg-red-500/10 font-mono text-[10px] uppercase tracking-[0.22em] px-4 py-2 disabled:opacity-50"
              data-testid="bulk-pause-btn"
            >
              <Pause size={12} /> {busy === "Pause" ? "Pausing…" : "Pause"}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={!!busy}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] hover:text-[#ff4500]"
              data-testid="bulk-clear-btn"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


function RenewalsTable({ rows, selected, toggle, toggleAll }) {
  const allOn = rows.length > 0 && selected.size === rows.length;
  return (
    <div className="border border-[#262626] overflow-x-auto" data-testid="renewals-table">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#0d0d0d] border-b border-[#262626] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            <th className="px-3 py-2 w-8 text-left">
              <input
                type="checkbox"
                checked={allOn}
                onChange={toggleAll}
                className="accent-[#ff4500]"
                data-testid="renewals-select-all"
              />
            </th>
            <th className="px-3 py-2 text-left">Listing</th>
            <th className="px-3 py-2 text-left">Mode</th>
            <th className="px-3 py-2 text-left">Expires</th>
            <th className="px-3 py-2 text-right">Days left</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const checked = selected.has(r.slug);
            return (
              <tr
                key={r.slug}
                className={`border-b border-[#1a1a1a] ${checked ? "bg-[#ff4500]/5" : "hover:bg-[#121212]"}`}
                data-testid={`renewals-row-${r.slug}`}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(r.slug)}
                    className="accent-[#ff4500]"
                    data-testid={`renewals-row-cb-${r.slug}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {r.image && (
                      <img src={r.image} alt="" className="w-10 h-10 object-cover border border-[#262626] shrink-0" />
                    )}
                    <Link to={`/maker/listings/${r.slug}/edit`} className="font-display text-base truncate hover:text-[#ff4500]">
                      {r.title}
                    </Link>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
                    r.renewal_mode === "automatic" ? "text-emerald-400" : "text-amber-400"
                  }`}>
                    {r.renewal_mode}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[#a3a3a3]">
                  {r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={`font-mono text-xs ${
                    r.days_left != null && r.days_left <= 7 ? "text-[#ff4500]" : "text-[#a3a3a3]"
                  }`}>
                    {r.days_left ?? "—"}{r.days_left != null ? "d" : ""}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
