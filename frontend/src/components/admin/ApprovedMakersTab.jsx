import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { fetchAdminApprovedMakers, toggleMakerBeta } from "../../lib/api";
import { formatDate } from "./_shared";

// Directory of every approved maker. Separates the long-tail roster
// from the daily Applications queue so admins can find / audit sellers
// without scrolling through decided applications.
export default function ApprovedMakersTab() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all"); // all | beta | plus | veteran
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const refresh = async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await fetchAdminApprovedMakers();
      setRows(data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load makers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "beta" && !r.is_beta) return false;
      if (filter === "plus" && !["active", "trialing"].includes(r.subscription_status)) return false;
      if (filter === "veteran" && !r.is_veteran_owned) return false;
      if (!needle) return true;
      const hay = `${r.name || ""} ${r.email || ""} ${r.slug || ""} ${r.location || ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, filter]);

  const counts = useMemo(() => ({
    all: rows.length,
    beta: rows.filter((r) => r.is_beta).length,
    plus: rows.filter((r) => ["active", "trialing"].includes(r.subscription_status)).length,
    veteran: rows.filter((r) => r.is_veteran_owned).length,
  }), [rows]);

  const flipBeta = async (slug, next) => {
    try {
      await toggleMakerBeta(slug, next);
      toast.success(next ? "Beta access granted · 90 days." : "Beta access removed.");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to toggle beta.");
    }
  };

  return (
    <div className="space-y-4" data-testid="approved-makers-tab">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Member Directory</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1">Approved Makers</h2>
        </div>
        <input
          type="text"
          placeholder="Search name, email, slug…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="approved-makers-search"
          className="md:w-72 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
        />
      </div>

      <div className="flex flex-wrap gap-2 pb-3 border-b border-line" data-testid="approved-filters">
        {[
          { id: "all", label: "All" },
          { id: "beta", label: "Beta" },
          { id: "plus", label: "Plus" },
          { id: "veteran", label: "Veteran" },
        ].map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              data-testid={`approved-filter-${f.id}`}
              className={`px-2.5 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] inline-flex items-center gap-2 transition ${
                active
                  ? "border-brand text-brand bg-brand/5"
                  : "border-line text-ink-muted hover:border-ink-muted hover:text-ink"
              }`}
            >
              {f.label}
              <span className={`text-[9px] ${active ? "text-brand" : "text-ink-muted"}`}>{counts[f.id]}</span>
            </button>
          );
        })}
      </div>

      {loading && <div className="font-mono text-xs text-ink-muted py-6">Loading makers…</div>}
      {err && <div className="font-mono text-xs text-red-400 py-6">{err}</div>}
      {!loading && filtered.length === 0 && (
        <div className="font-mono text-xs text-ink-muted py-6" data-testid="approved-empty">
          No makers match.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-xs" data-testid="approved-makers-table">
            <thead>
              <tr className="text-ink-muted uppercase tracking-[0.22em] text-[10px] border-b border-line">
                <th className="text-left py-2 pr-3">Studio</th>
                <th className="text-left py-2 pr-3">Email</th>
                <th className="text-left py-2 pr-3">Badges</th>
                <th className="text-right py-2 pr-3">Listings</th>
                <th className="text-right py-2 pr-3">Lifetime GMV</th>
                <th className="text-left py-2 pr-3">Approved</th>
                <th className="text-right py-2">Beta</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.slug} className="border-b border-line hover:bg-surface" data-testid={`approved-row-${r.slug}`}>
                  <td className="py-3 pr-3">
                    <div className="text-ink">{r.name || r.slug}</div>
                    <div className="text-[9px] text-ink-muted">/{r.slug}</div>
                  </td>
                  <td className="py-3 pr-3 break-all">
                    <a href={`mailto:${r.email}`} className="text-ink-muted hover:text-brand">{r.email}</a>
                  </td>
                  <td className="py-3 pr-3 space-x-1">
                    {r.is_beta && <span className="inline-block px-1.5 py-0.5 bg-brand text-ink text-[9px] font-bold">BETA</span>}
                    {["active", "trialing"].includes(r.subscription_status) && (
                      <span className="inline-block px-1.5 py-0.5 border border-emerald-500/60 text-emerald-400 text-[9px] font-bold">★ PLUS</span>
                    )}
                    {r.is_veteran_owned && <span className="inline-block px-1.5 py-0.5 border border-[#60a5fa]/60 text-[#60a5fa] text-[9px] font-bold">◆ VET</span>}
                  </td>
                  <td className="py-3 pr-3 text-right text-ink">{r.listings_count || 0}</td>
                  <td className="py-3 pr-3 text-right text-brand">${(r.lifetime_gmv || 0).toFixed(2)}</td>
                  <td className="py-3 pr-3 text-ink-muted">{formatDate(r.approved_at)}</td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => flipBeta(r.slug, !r.is_beta)}
                      data-testid={`approved-beta-toggle-${r.slug}`}
                      className={`px-2 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                        r.is_beta
                          ? "border-brand text-brand hover:bg-brand/10"
                          : "border-line text-ink-muted hover:border-brand hover:text-brand"
                      }`}
                    >
                      {r.is_beta ? "Revoke" : "Grant"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
