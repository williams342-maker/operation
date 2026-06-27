import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  fetchAdminApprovedMakers, toggleMakerBeta,
  purgeApprovedMaker, approvedMakersCsvUrl,
  sendEnrichlabsExportNow, fetchEnrichlabsExportStatus,
  adminImpersonateMaker, promoteMakerToFounder,
} from "../../lib/api";
import { startImpersonation } from "../../lib/impersonate";
import { formatDate } from "./_shared";
import PerMakerIndexationChart from "./PerMakerIndexationChart";

// Directory of every approved maker. Separates the long-tail roster
// from the daily Applications queue so admins can find / audit sellers
// without scrolling through decided applications.
export default function ApprovedMakersTab() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all"); // all | beta | plus | veteran
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // iter356 — slug of the currently-expanded row showing the per-maker
  // GSC indexation sparkline. Only one row expands at a time to keep
  // the table tidy and avoid simultaneous /snapshots-trend/maker fetches.
  const [expandedSlug, setExpandedSlug] = useState("");

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

  // iter413bm — Roster-wide KPIs. Sum the per-row counts already in
  // memory so we don't burn a second round trip. These tiles double as
  // a silent regression alarm: if listings_total ever flips back to 0
  // (the bug we just fixed), it's visible at a glance instead of
  // buried in the table.
  const kpis = useMemo(() => {
    const listingsTotal = rows.reduce((acc, r) => acc + (r.listings_count || 0), 0);
    const sellersWithListings = rows.filter((r) => (r.listings_count || 0) > 0).length;
    const avgListings = rows.length
      ? Math.round((listingsTotal / rows.length) * 10) / 10
      : 0;
    return { listingsTotal, sellersWithListings, avgListings };
  }, [rows]);

  const flipBeta = async (slug, next) => {
    try {
      await toggleMakerBeta(slug, next);
      toast.success(next ? "Founding Access granted · 90 days." : "Founding Access removed.");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to toggle Founding Access.");
    }
  };

  // iter413ca — Sign in as this maker (new tab, 2-hour session, audit-logged).
  const [impersonatingSlug, setImpersonatingSlug] = useState("");
  const impersonate = async (slug) => {
    setImpersonatingSlug(slug);
    try {
      const res = await adminImpersonateMaker(slug);
      startImpersonation({ ...res, token: res.token });
      toast.success(`Impersonating ${res.target_name} — opening new tab…`);
      window.open("/maker/dashboard", "_blank", "noopener");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to impersonate maker.");
    } finally {
      setImpersonatingSlug("");
    }
  };

  // iter413da — One-click founder promotion. Confirms (founder_number is
  // monotonic + lifetime for inaugural), POSTs to /admin/founders/promote,
  // refreshes the table. Idempotent on the backend so a re-click is safe.
  const [promotingSlug, setPromotingSlug] = useState("");
  const promoteToFounder = async (slug, name) => {
    const ok = window.confirm(
      `Promote "${name || slug}" to Inaugural Founder?\n\n` +
      `• Sets tier=founder, founder_status=inaugural, lifetime expiry.\n` +
      `• Assigns the next monotonic Founder number (#NNN).\n` +
      `• Sends the Inaugural Founder welcome email (only on first promotion).\n` +
      `• Unlocks the vanity URL + Founder dashboard tab + 3% commission + 50 listings/mo.\n\n` +
      `Safe to re-run — re-promotion reuses the existing Founder number.`,
    );
    if (!ok) return;
    setPromotingSlug(slug);
    try {
      const res = await promoteMakerToFounder(slug, "inaugural");
      toast.success(
        `${name || slug} → Inaugural Founder #${res.founder_number}.`,
      );
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to promote maker.");
    } finally {
      setPromotingSlug("");
    }
  };

  // iter413az — Hard purge a maker. Two-step confirm (`prompt` for the
  // slug) so the admin can't fat-finger it. Backend soft-deletes their
  // listings + tags payouts, then hard-deletes the maker doc.
  const [purgingSlug, setPurgingSlug] = useState("");
  const purgeMaker = async (slug, name) => {
    const typed = window.prompt(
      `Permanently delete maker "${name || slug}"?\n\n` +
      `• Their listings will be soft-deleted (404 on the storefront).\n` +
      `• Their payouts stay in finance reports but get owner-purged tag.\n` +
      `• This cannot be undone from inside the admin.\n\n` +
      `Type the slug "${slug}" to confirm:`,
    );
    if (typed == null) return; // user cancelled
    if (typed.trim() !== slug) {
      toast.error("Slug didn't match — purge cancelled.");
      return;
    }
    setPurgingSlug(slug);
    try {
      const res = await purgeApprovedMaker(slug);
      toast.success(`Maker purged · ${res.products_soft_deleted} listing(s) hidden.`);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to purge maker.");
    } finally {
      setPurgingSlug("");
    }
  };

  // iter413az — Download the directory as CSV. We can't use a plain
  // <a href> because the endpoint requires Authorization: Bearer; the
  // workaround is to fetch as a blob then trigger a browser download
  // via a dynamic anchor element.
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const r = await fetch(approvedMakersCsvUrl(), {
        headers: { Authorization: `Bearer ${localStorage.getItem("cm_admin_jwt") || ""}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Server already sets Content-Disposition with a date-stamped
      // filename, but Safari ignores it without an explicit `download`.
      a.download = `crafters-market-approved-makers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revoke a tick so Safari's "save dialog" can read the URL.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Exported ${rows.length} maker${rows.length === 1 ? "" : "s"} to CSV.`);
    } catch (e) {
      toast.error(e.message || "CSV export failed.");
    } finally {
      setExporting(false);
    }
  };

  // iter413bo — Enrich Labs weekly export status + manual trigger.
  // Pulls last-send timestamp + recipient on mount so the admin can see
  // whether the weekly cron is configured + when it last delivered.
  const [enrichStatus, setEnrichStatus] = useState(null);
  const [sendingEnrich, setSendingEnrich] = useState(false);

  const loadEnrich = async () => {
    try {
      setEnrichStatus(await fetchEnrichlabsExportStatus());
    } catch {
      // Soft-fail — the export is optional; don't break the whole tab.
    }
  };
  useEffect(() => { loadEnrich(); }, []);

  const sendEnrichNow = async () => {
    if (!enrichStatus?.configured) {
      toast.error("ENRICHLABS_EXPORT_EMAIL env var not set — add it in backend/.env first.");
      return;
    }
    if (!window.confirm(
      `Send the Approved Makers CSV (no emails) to ${enrichStatus.recipient} now?\n\n` +
      `This is the same payload the weekly Monday 11:00 UTC cron sends. Audit-logged.`
    )) return;
    setSendingEnrich(true);
    try {
      const r = await sendEnrichlabsExportNow();
      if (r.ok) {
        toast.success(`Enrich Labs export sent · ${r.rows} row${r.rows === 1 ? "" : "s"} to ${r.sent_to}.`);
      } else {
        toast.error(`Send failed: ${r.error || "unknown error"}`);
      }
      await loadEnrich();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to send Enrich Labs export.");
    } finally {
      setSendingEnrich(false);
    }
  };

  const fmtAgo = (iso) => {
    if (!iso) return "never";
    try {
      const ms = Date.now() - new Date(iso).getTime();
      if (ms < 60_000) return "just now";
      if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
      if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
      const d = Math.floor(ms / 86_400_000);
      return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
    } catch { return iso; }
  };

  return (
    <div className="space-y-4" data-testid="approved-makers-tab">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Member Directory</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1">Approved Makers</h2>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search name, email, slug…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="approved-makers-search"
            className="md:w-72 bg-transparent border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink"
          />
          <button
            onClick={exportCsv}
            disabled={exporting || loading || rows.length === 0}
            data-testid="approved-makers-export-csv"
            title="Download CSV — formatted for Enrich Labs / CRM imports"
            className="shrink-0 px-3 py-2 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "↓ Export CSV"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3" data-testid="approved-makers-kpis">
        {[
          {
            id: "approved",
            label: "Approved Makers",
            value: rows.length,
            testid: "kpi-approved-count",
          },
          {
            id: "listings",
            label: "Total Live Listings",
            value: kpis.listingsTotal,
            testid: "kpi-listings-total",
            hint: `${kpis.sellersWithListings} of ${rows.length} sellers active`,
          },
          {
            id: "avg",
            label: "Avg Listings / Maker",
            value: kpis.avgListings,
            testid: "kpi-avg-listings",
          },
        ].map((k) => (
          <div
            key={k.id}
            data-testid={k.testid}
            className="border border-line p-3 bg-paper"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
              {k.label}
            </div>
            <div className="font-display text-3xl text-brand mt-1 tabular-nums">
              {loading ? "—" : k.value}
            </div>
            {k.hint && (
              <div className="font-mono text-[10px] text-ink-muted mt-1">
                {k.hint}
              </div>
            )}
          </div>
        ))}
      </div>

      <section
        className="border border-line p-3 md:p-4 bg-paper flex flex-col md:flex-row md:items-center md:justify-between gap-3"
        data-testid="enrichlabs-export-card"
      >
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
            ◆ Weekly Enrich Labs export · no PII
          </div>
          <div className="font-mono text-xs text-ink mt-1">
            {enrichStatus?.configured ? (
              <>
                Recipient: <span className="text-brand" data-testid="enrich-recipient">{enrichStatus.recipient}</span>
                <span className="text-ink-muted"> · </span>
                Schedule: <span className="text-ink">{enrichStatus.schedule_human}</span>
              </>
            ) : (
              <span className="text-ink-muted" data-testid="enrich-not-configured">
                Not configured. Set <code className="text-ink">ENRICHLABS_EXPORT_EMAIL</code> in backend/.env to enable.
              </span>
            )}
          </div>
          {enrichStatus?.last_send && (
            <div className="font-mono text-[10px] text-ink-muted mt-1" data-testid="enrich-last-send">
              Last send: {fmtAgo(enrichStatus.last_send.ts)}
              {" · "}
              {enrichStatus.last_send.ok ? (
                <span className="text-emerald-600">✓ {enrichStatus.last_send.rows} rows delivered</span>
              ) : (
                <span className="text-danger">✗ {enrichStatus.last_send.mailgun_error || "failed"}</span>
              )}
              {enrichStatus.total_sends > 1 && (
                <span className="text-ink-muted"> · {enrichStatus.total_sends} total sends</span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={sendEnrichNow}
          disabled={sendingEnrich || !enrichStatus?.configured}
          data-testid="enrichlabs-send-now"
          title="Manually trigger the weekly Enrich Labs export now"
          className="shrink-0 px-3 py-2 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
        >
          {sendingEnrich ? "Sending…" : "↗ Send to Enrich Labs now"}
        </button>
      </section>

      <div className="flex flex-wrap gap-2 pb-3 border-b border-line" data-testid="approved-filters">
        {[
          { id: "all", label: "All" },
          { id: "beta", label: "Founding Access" },
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
                <th className="text-right py-2">Founding Access</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <React.Fragment key={r.slug}>
                <tr className="border-b border-line hover:bg-surface" data-testid={`approved-row-${r.slug}`}>
                  <td className="py-3 pr-3">
                    <div className="text-ink">{r.name || r.slug}</div>
                    <div className="text-[9px] text-ink-muted">/{r.slug}</div>
                  </td>
                  <td className="py-3 pr-3 break-all">
                    <a href={`mailto:${r.email}`} className="text-ink-muted hover:text-brand">{r.email}</a>
                  </td>
                  <td className="py-3 pr-3 space-x-1">
                    {r.tier === "founder" && (
                      <span
                        data-testid={`approved-founder-badge-${r.slug}`}
                        title={
                          r.founder_status === "inaugural"
                            ? `Inaugural Founder #${r.founder_number} · Lifetime · 3% commission · 50 free listings/mo`
                            : `Founder #${r.founder_number} · 3% commission`
                        }
                        className="inline-block px-1.5 py-0.5 bg-brand text-paper text-[9px] font-bold"
                      >
                        {r.founder_status === "inaugural" ? "★ INAUGURAL" : "★ FOUNDER"}
                        {r.founder_number ? ` #${r.founder_number}` : ""}
                      </span>
                    )}
                    {r.is_beta && <span className="inline-block px-1.5 py-0.5 bg-brand text-ink text-[9px] font-bold">BETA</span>}
                    {["active", "trialing"].includes(r.subscription_status) && (
                      <span className="inline-block px-1.5 py-0.5 border border-emerald-500/60 text-emerald-700 text-[9px] font-bold">★ PLUS</span>
                    )}
                    {r.is_veteran_owned && <span className="inline-block px-1.5 py-0.5 border border-[#60a5fa]/60 text-[#60a5fa] text-[9px] font-bold">◆ VET</span>}
                  </td>
                  <td className="py-3 pr-3 text-right text-ink">{r.listings_count || 0}</td>
                  <td className="py-3 pr-3 text-right text-brand">${(r.lifetime_gmv || 0).toFixed(2)}</td>
                  <td className="py-3 pr-3 text-ink-muted">{formatDate(r.approved_at)}</td>
                  <td className="py-3 text-right space-x-1 whitespace-nowrap">
                    <button
                      onClick={() => impersonate(r.slug)}
                      disabled={impersonatingSlug === r.slug}
                      data-testid={`approved-impersonate-${r.slug}`}
                      title="Sign in as this maker in a new tab (2-hour session, audit-logged)"
                      className="px-2 py-1 border border-brand text-brand hover:bg-brand/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                    >
                      {impersonatingSlug === r.slug ? "…" : "Impersonate"}
                    </button>
                    {r.tier !== "founder" && (
                      <button
                        onClick={() => promoteToFounder(r.slug, r.name)}
                        disabled={promotingSlug === r.slug}
                        data-testid={`approved-promote-founder-${r.slug}`}
                        title="Promote this maker to Inaugural Founder (lifetime · 3% commission · 50 listings/mo · unlocks vanity URL)"
                        className="px-2 py-1 border border-brand bg-brand/10 text-brand hover:bg-brand hover:text-paper font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                      >
                        {promotingSlug === r.slug ? "…" : "★ Founder"}
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedSlug((cur) => cur === r.slug ? "" : r.slug)}
                      data-testid={`approved-chart-toggle-${r.slug}`}
                      title="Toggle 30-day indexation chart"
                      className={`px-2 py-1 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                        expandedSlug === r.slug
                          ? "border-cyan-500 text-brand hover:bg-cyan-500/10"
                          : "border-line text-ink-muted hover:border-cyan-500 hover:text-brand"
                      }`}
                    >
                      {expandedSlug === r.slug ? "Hide" : "Chart"}
                    </button>
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
                    <button
                      onClick={() => purgeMaker(r.slug, r.name)}
                      disabled={purgingSlug === r.slug}
                      data-testid={`approved-purge-${r.slug}`}
                      title="Permanently delete this maker (super-admin only)"
                      className="px-2 py-1 border border-line text-ink-muted hover:border-danger hover:text-danger font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                    >
                      {purgingSlug === r.slug ? "…" : "Purge"}
                    </button>
                  </td>
                </tr>
                {expandedSlug === r.slug && (
                  <tr className="border-b border-line bg-paper" data-testid={`approved-chart-row-${r.slug}`}>
                    <td colSpan={7} className="p-3">
                      <PerMakerIndexationChart
                        initialSlug={r.slug}
                        hideInput
                        height={100}
                      />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
