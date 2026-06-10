import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  fetchListingBudgets,
  upsertListingBudget,
  deleteListingBudget,
} from "../../../lib/api";
import Section from "./Section";

// iter315 — Per-listing marketing budget management.
//
// Each row is a maker's published listing. Maker sets a monthly $-cap.
// A daily backend cron (`listing_budgets_renew` in scheduler.py) auto-
// renews the $5/wk on-site boost as long as `spent_cents +
// PROMOTION_WEEKLY_FEE_CENTS <= monthly_cap_cents`. Spend resets to $0
// on the 1st of each month.
//
// Why no external Google/Meta ads here yet: brand verification on
// Google is blocked; this internal-boost lever is what we have today.
// The schema is intentionally a superset so the same UI carries over
// when external ads come online.

const usd = (cents) => {
  if (cents == null) return "$0";
  const v = (cents / 100).toFixed(2);
  return `$${v}`;
};

function ROAS({ row }) {
  // Conversion estimate is rough — we don't have per-listing revenue
  // attribution at the event level yet. Approximate as conversions × avg
  // price-not-known-here. For now show conversions count.
  const conv = row.conversions_mtd ?? 0;
  const imps = row.impressions_mtd ?? 0;
  if (!imps && !conv) return <span className="text-ink-muted">—</span>;
  const cvr = imps > 0 ? ((conv / imps) * 100).toFixed(1) : "0.0";
  return (
    <span className="text-ink-muted">
      {conv}/{imps} <span className="text-ink-muted">({cvr}% CVR)</span>
    </span>
  );
}

function BudgetRow({ row, onSaved, onDeleted }) {
  const [cap, setCap] = useState(String(row.monthly_cap_cents / 100 || ""));
  const [autoRenew, setAutoRenew] = useState(!!row.auto_renew);
  const [busy, setBusy] = useState(false);
  const dirty =
    Number(cap) * 100 !== row.monthly_cap_cents || autoRenew !== row.auto_renew;

  const save = async () => {
    const cents = Math.round(Number(cap) * 100);
    if (!Number.isFinite(cents) || cents < 0 || cents > 100_000) {
      toast.error("Cap must be $0 – $1000.");
      return;
    }
    setBusy(true);
    try {
      await upsertListingBudget(row.product_slug, {
        monthly_cap_cents: cents,
        auto_renew: autoRenew,
      });
      toast.success("Saved.");
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove this listing's budget? Auto-renew will stop.")) return;
    setBusy(true);
    try {
      await deleteListingBudget(row.product_slug);
      toast.success("Removed.");
      onDeleted();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  const spent = row.spent_cents ?? 0;
  const cap_cents = row.monthly_cap_cents ?? 0;
  const pct = cap_cents > 0 ? Math.min(100, Math.round((spent / cap_cents) * 100)) : 0;
  const promoted = !!row.promoted_until && row.promoted_until > new Date().toISOString();

  return (
    <tr
      className="border-b border-line last:border-b-0"
      data-testid={`listing-budget-row-${row.product_slug}`}
    >
      <td className="py-3 pr-4">
        <div className="text-ink text-sm">{row.product_title || row.product_slug}</div>
        <div className="font-mono text-[10px] text-ink-muted mt-0.5">
          /{row.product_slug}
          {promoted && (
            <span
              className="ml-2 px-1.5 py-0.5 border border-emerald-700 text-emerald-300 text-[9px] uppercase tracking-[0.18em]"
              title={`Promoted until ${new Date(row.promoted_until).toLocaleString()}`}
            >
              boosted
            </span>
          )}
        </div>
      </td>

      <td className="py-3 pr-4">
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-ink-muted">$</span>
          <input
            type="number"
            min="0"
            max="1000"
            step="1"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            disabled={busy}
            className="w-20 bg-paper border border-line focus:border-brand font-mono text-[12px] text-ink px-2 py-1.5"
            data-testid={`listing-budget-cap-${row.product_slug}`}
          />
          <span className="font-mono text-[10px] text-ink-muted">/ mo</span>
        </div>
      </td>

      <td className="py-3 pr-4">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoRenew}
            onChange={(e) => setAutoRenew(e.target.checked)}
            disabled={busy || Number(cap) <= 0}
            data-testid={`listing-budget-autorenew-${row.product_slug}`}
            className="accent-[#ff4500]"
          />
          <span className="font-mono text-[11px] text-ink-muted">Auto-renew</span>
        </label>
      </td>

      <td className="py-3 pr-4">
        <div className="font-mono text-[11px] text-ink">
          {usd(spent)} <span className="text-ink-muted">/ {usd(cap_cents)}</span>
        </div>
        <div className="h-1 w-24 bg-surface mt-1.5">
          <div
            className="h-1"
            style={{
              width: `${pct}%`,
              background: pct >= 100 ? "#525252" : "#ff4500",
            }}
          />
        </div>
      </td>

      <td className="py-3 pr-4 font-mono text-[11px]">
        <ROAS row={row} />
      </td>

      <td className="py-3 text-right whitespace-nowrap">
        {dirty && (
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand hover:bg-brand hover:text-[#0a0a0a] border border-brand px-2.5 py-1 transition disabled:opacity-50 mr-2"
            data-testid={`listing-budget-save-${row.product_slug}`}
          >
            Save
          </button>
        )}
        {row.monthly_cap_cents > 0 && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted hover:text-brand transition disabled:opacity-50"
            data-testid={`listing-budget-remove-${row.product_slug}`}
          >
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}

export default function ListingBudgetsSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const r = await fetchListingBudgets();
      setData(r);
    } catch (e) {
      if (e?.response?.status !== 401) {
        toast.error("Couldn't load budgets.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const summary = useMemo(() => {
    if (!data?.budgets?.length) return null;
    const totalCap = data.total_monthly_cap_cents || 0;
    const totalSpent = data.total_spent_cents || 0;
    const active = data.budgets.filter((b) => b.auto_renew && b.monthly_cap_cents > 0).length;
    return { totalCap, totalSpent, active };
  }, [data]);

  return (
    <Section title="Per-listing marketing budgets" testId="listing-budgets-section">
      <p className="font-mono text-[11px] text-ink-muted mb-4 leading-relaxed">
        Set a monthly $-cap per listing. Crafters Market auto-renews the $5/week on-site boost
        as long as the listing has budget left. Spend resets on the 1st.{" "}
        <span className="text-ink-muted">
          External Google/Meta ads will plug into the same controls once brand verification clears.
        </span>
      </p>

      {summary && (
        <div className="flex flex-wrap gap-4 mb-5 pb-4 border-b border-line font-mono text-[11px]">
          <div data-testid="listing-budgets-total-cap">
            <div className="text-ink-muted uppercase tracking-[0.18em] text-[9px]">Total cap</div>
            <div className="text-ink text-base">{usd(summary.totalCap)}/mo</div>
          </div>
          <div data-testid="listing-budgets-total-spent">
            <div className="text-ink-muted uppercase tracking-[0.18em] text-[9px]">Spent MTD</div>
            <div className="text-brand text-base">{usd(summary.totalSpent)}</div>
          </div>
          <div data-testid="listing-budgets-active">
            <div className="text-ink-muted uppercase tracking-[0.18em] text-[9px]">Auto-renewing</div>
            <div className="text-ink text-base">{summary.active}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="font-mono text-[11px] text-ink-muted">Loading…</div>
      ) : !data?.budgets?.length ? (
        <div className="font-mono text-[11px] text-ink-muted">
          No budgets yet. To add one, open any published listing in your Listings tab and use the
          <span className="text-ink"> "Set marketing budget"</span> action. (UI to be added
          inline — for now, set a budget from this table once you have published listings with
          existing boosts.)
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
                <th className="py-2 pr-4 font-normal">Listing</th>
                <th className="py-2 pr-4 font-normal">Cap</th>
                <th className="py-2 pr-4 font-normal">Auto-renew</th>
                <th className="py-2 pr-4 font-normal">Spend</th>
                <th className="py-2 pr-4 font-normal">Conv / Views</th>
                <th className="py-2 pr-4 font-normal text-right">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {data.budgets.map((b) => (
                <BudgetRow
                  key={b.product_slug}
                  row={b}
                  onSaved={reload}
                  onDeleted={reload}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
