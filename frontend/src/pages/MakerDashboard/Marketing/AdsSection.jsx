import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Play, Zap, Flame, RotateCw, Gift } from "lucide-react";
import { toast } from "sonner";
import {
  fetchAutoBoostStatus, fetchMakerMe, fetchMakerProducts,
  fetchMakerBoostCredits, redeemBoostCredit,
  promoteMakerProduct, setAutoRenewPromotion, updateAutoBoost,
} from "../../../lib/api";
import { RowsSkeleton } from "../../../components/Skeleton";
import Section from "./Section";

/**
 * Crafters Market Ads — promoted listings panel + auto-boost toggle.
 *
 * Extracted from MarketingTab.jsx in iter131 to keep section files
 * focused. Internal helpers (AutoBoostPanel, AdStat, PromotedRow) live
 * in the same module since they're tightly coupled to AdsSection's
 * data flow (the fetched product list + $5/wk pricing).
 */
const WEEKLY_RATE = 5; // USD per week, per promoted listing.

export default function AdsSection() {
  const [products, setProducts] = useState(null);
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState("");
  const [weeks, setWeeks] = useState(1);
  // Drives the "Nd Nh left" countdowns without forcing a product re-fetch.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const refresh = () =>
    fetchMakerProducts()
      .then(setProducts)
      .catch(() => setProducts([]));
  const [creditState, setCreditState] = useState({ credits: [], available: 0, lifetime_earned: 0 });
  const refreshCredits = () =>
    fetchMakerBoostCredits()
      .then(setCreditState)
      .catch(() => setCreditState({ credits: [], available: 0, lifetime_earned: 0 }));
  useEffect(() => {
    refresh();
    fetchMakerMe().then(setMe).catch(() => setMe(null));
    refreshCredits();
  }, []);

  const isPlus = me?.subscription_status === "active" || me?.subscription_status === "trialing";

  // Derive three disjoint buckets from the product list:
  //  - activePromos: promoted_until > now
  //  - eligible:     published + not deleted + not currently promoted
  //  - ineligible:   draft / archived / deleted
  const { activePromos, eligible } = useMemo(() => {
    if (!products) return { activePromos: [], eligible: [] };
    const nowIso = new Date().toISOString();
    const live = products.filter(
      (p) => p.status === "published" && !p.deleted_at,
    );
    return {
      activePromos: live.filter((p) => p.promoted_until && p.promoted_until > nowIso)
        .sort((a, b) => a.promoted_until.localeCompare(b.promoted_until)),
      eligible: live.filter((p) => !p.promoted_until || p.promoted_until <= nowIso),
    };
  }, [products]);

  const weeklySpend = activePromos.reduce((sum, p) => {
    // Count weeks remaining (rounded up, min 1) as this-week burn.
    const msLeft = new Date(p.promoted_until).getTime() - Date.now();
    const weeksLeft = Math.max(1, Math.ceil(msLeft / (7 * 24 * 60 * 60 * 1000)));
    return sum + WEEKLY_RATE * weeksLeft;
  }, 0);

  const boost = async (slug) => {
    setBusy(slug);
    try {
      await promoteMakerProduct(slug, weeks);
      const total = weeks * WEEKLY_RATE;
      toast.success(
        weeks === 1
          ? `Boosted · $${WEEKLY_RATE} charged to pending balance.`
          : `Boosted ${weeks} weeks · $${total} charged to pending balance.`,
      );
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Boost failed.");
    } finally { setBusy(""); }
  };

  const toggleAutoRenew = async (slug, next) => {
    setBusy(`renew:${slug}`);
    try {
      await setAutoRenewPromotion(slug, next);
      toast.success(
        next
          ? (isPlus
              ? "Auto-renew enabled — Plus subscribers ride free."
              : "Auto-renew enabled — $5/wk will accrue on each renewal.")
          : "Auto-renew disabled.",
      );
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Toggle failed.");
    } finally { setBusy(""); }
  };

  const redeemCredit = async (creditId, slug) => {
    setBusy(`credit:${slug}`);
    try {
      await redeemBoostCredit(creditId, slug);
      toast.success("🎁 Free 24-hour boost applied — thanks for contributing to the community.");
      await Promise.all([refresh(), refreshCredits()]);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Redemption failed.");
    } finally { setBusy(""); }
  };

  return (
    <div className="space-y-6" data-testid="ads-section">
      {/* Hero — what is this? */}
      <Section title="Crafters Market Ads" testId="ads-hero">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="max-w-xl">
            <p className="font-mono text-xs text-ink leading-relaxed">
              Pin your listings to the top of category search & the home-page showcase row for <b className="text-brand">$5 per week, per listing</b>. Pause anytime — charges stop at the end of the current week.
            </p>
            <ul className="mt-3 space-y-1 font-mono text-[11px] text-ink-muted leading-relaxed">
              <li>◆ Featured placement in /shop?category= search results</li>
              <li>◆ Priority slot in home-page "Featured" showcase row</li>
              <li>◆ "★ Featured" badge on the listing card — drives ~18% higher CTR</li>
            </ul>
          </div>
          <div className="grid grid-cols-3 gap-2 shrink-0 w-full md:w-auto">
            <AdStat label="Active" value={activePromos.length} testId="ads-stat-active" tone="orange" />
            <AdStat label="$ / wk" value={`$${weeklySpend}`} testId="ads-stat-spend" />
            <AdStat label="Eligible" value={eligible.length} testId="ads-stat-eligible" />
          </div>
        </div>
      </Section>

      {/* Active promotions */}
      <Section title={`Active promotions · ${activePromos.length}`} testId="ads-active">
        {products === null ? (
          <div data-testid="ads-active-loading"><RowsSkeleton count={3} /></div>
        ) : activePromos.length === 0 ? (
          <p className="font-mono text-xs text-ink-muted py-3">
            No promoted listings right now. Boost one below to pin it to the top of search.
          </p>
        ) : (
          <ul className="border border-line divide-y divide-[#1f1f1f]" data-testid="ads-active-list">
            {activePromos.map((p) => (
              <PromotedRow
                key={p.id}
                p={p}
                isPlus={isPlus}
                onExtend={() => boost(p.slug)}
                onToggleAutoRenew={(next) => toggleAutoRenew(p.slug, next)}
                busy={busy === p.slug}
                renewBusy={busy === `renew:${p.slug}`}
              />
            ))}
          </ul>
        )}
      </Section>

      {/* Free boost credits earned by community uploads */}
      {creditState.available > 0 && (
        <Section
          title="Free boost credits"
          eyebrow="Community reward"
          testId="ads-credits"
        >
          <div className="border border-emerald-500/40 bg-emerald-500/5 p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 border border-emerald-400 bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Gift size={16} className="text-emerald-300" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-ink">
                  <b className="text-emerald-300 tabular-nums">{creditState.available}</b>{" "}
                  free 24-hour boost credit{creditState.available === 1 ? "" : "s"} ready to spend
                </div>
                <p className="font-mono text-[11px] text-ink-muted leading-relaxed mt-1">
                  Earned by uploading a design file to the community this week.
                  Click <b>Use credit</b> on any listing below to apply 24 hours of
                  promotion — extends an existing boost if the listing is already promoted.
                  {creditState.lifetime_earned > creditState.available && (
                    <span className="block text-ink-muted mt-1">
                      Lifetime: {creditState.lifetime_earned} credits earned.
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* Boost picker */}
      <Section title="Boost a listing" testId="ads-boost">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Duration</span>
          {[1, 2, 4, 12].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeeks(w)}
              data-testid={`ads-weeks-${w}`}
              className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                weeks === w
                  ? "border-brand text-brand bg-brand/5"
                  : "border-line text-ink-muted hover:border-ink-muted hover:text-ink"
              }`}
            >
              {w === 1 ? "1 week" : `${w} weeks`} · ${w * WEEKLY_RATE}
            </button>
          ))}
        </div>
        {products === null ? (
          <div data-testid="ads-eligible-loading"><RowsSkeleton count={4} /></div>
        ) : eligible.length === 0 ? (
          <p className="font-mono text-xs text-ink-muted py-3">
            No eligible listings — every published listing is already promoted, or you haven't published yet.
          </p>
        ) : (
          <ul className="border border-line divide-y divide-[#1f1f1f] max-h-[440px] overflow-y-auto" data-testid="ads-eligible-list">
            {eligible.slice(0, 50).map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                {p.images?.[0] && (
                  <img src={p.images[0]} alt="" className="w-12 h-12 object-cover border border-line" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs text-ink truncate">{p.title}</div>
                  <div className="font-mono text-[10px] text-ink-muted">
                    ${p.price?.toFixed(0) ?? 0} · {p.category} · {p.in_stock ?? 0} in stock
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {creditState.available > 0 && creditState.credits[0] && (
                    <button
                      onClick={() => redeemCredit(creditState.credits[0].id, p.slug)}
                      disabled={busy === `credit:${p.slug}`}
                      className="px-2.5 py-1.5 border border-emerald-400 text-emerald-300 hover:bg-emerald-400 hover:text-ink font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50 inline-flex items-center gap-1.5"
                      data-testid={`ads-use-credit-${p.slug}`}
                      title="Apply a free 24-hour boost from your community-upload credit balance"
                    >
                      <Gift size={11} /> {busy === `credit:${p.slug}` ? "…" : "Use credit · Free"}
                    </button>
                  )}
                  <button
                    onClick={() => boost(p.slug)}
                    disabled={busy === p.slug}
                    className="px-3 py-1.5 border border-brand text-brand hover:bg-brand hover:text-ink font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50 inline-flex items-center gap-1.5"
                    data-testid={`ads-boost-${p.slug}`}
                  >
                    <Zap size={11} /> {busy === p.slug ? "…" : `Boost $${weeks * WEEKLY_RATE}`}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="font-mono text-[10px] text-ink-muted mt-3">
          ◇ ${WEEKLY_RATE} per week · charged to your pending balance · settled from your next payout. No daily cap.
        </p>
      </Section>

      <AutoBoostPanel />
    </div>
  );
}

// ============================================================================
// Auto-boost on best-sellers — opt-in toggle + threshold knobs + preview
// of which listings would boost on the next nightly run. $5/wk per listing.
// ============================================================================
function AutoBoostPanel() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => fetchAutoBoostStatus().then(setData).catch(() => setData({ enabled: false }));
  useEffect(() => { refresh(); }, []);

  const toggle = async (next) => {
    setBusy(true);
    try {
      await updateAutoBoost({ enabled: next });
      toast.success(next ? "Auto-boost enabled. We'll run nightly at 04:00 UTC." : "Auto-boost paused.");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed.");
    } finally { setBusy(false); }
  };

  const updateField = async (key, value) => {
    setBusy(true);
    try {
      await updateAutoBoost({ [key]: value });
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed.");
    } finally { setBusy(false); }
  };

  if (!data) {
    return <Section title="Auto-boost best-sellers" testId="ads-auto-boost"><div data-testid="auto-boost-loading"><RowsSkeleton count={3} /></div></Section>;
  }

  const candidates = data.next_candidates || [];
  const enabled = data.enabled;

  return (
    <Section title="Auto-boost best-sellers" testId="ads-auto-boost">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
        <div className="max-w-xl">
          <p className="font-mono text-xs text-ink leading-relaxed">
            Once a day we look at your top sellers from the last 30 days. Any listing
            with <b className="text-brand">{data.min_orders_30d}+</b> orders that
            isn't already promoted gets <b className="text-brand">1 week of free promotion</b>.
            Up to <b className="text-brand">{data.max_per_run}</b> listings per run.
          </p>
          <p className="font-mono text-[10px] text-ink-muted mt-2">
            $5/wk per boosted listing — billed to your pending balance.
            {data.last_run_at && ` Last run: ${new Date(data.last_run_at).toLocaleString()}.`}
          </p>
          {data.total_spent_usd > 0 && (
            <p className="font-mono text-[10px] text-ink-muted">
              Lifetime auto-boost spend: <b className="text-ink-muted">${data.total_spent_usd.toFixed(2)}</b>
            </p>
          )}
        </div>
        <button
          onClick={() => toggle(!enabled)}
          disabled={busy}
          data-testid="auto-boost-toggle"
          className={`shrink-0 px-4 py-2 border font-mono text-[10px] uppercase tracking-[0.22em] font-bold transition disabled:opacity-50 ${
            enabled
              ? "border-brand bg-brand text-ink hover:bg-brand-hover"
              : "border-line text-ink-muted hover:border-brand hover:text-brand"
          }`}
        >
          {enabled ? "◆ Auto-boost ON" : "◇ Enable auto-boost"}
        </button>
      </div>

      {enabled && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 border-t border-line pt-3">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Min orders / 30d to qualify</label>
            <select
              value={data.min_orders_30d}
              onChange={(e) => updateField("min_orders_30d", Number(e.target.value))}
              disabled={busy}
              data-testid="auto-boost-threshold"
              className="w-full mt-1 bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink disabled:opacity-50"
            >
              {[3, 5, 10, 15, 20, 30, 50].map((n) => (
                <option key={n} value={n}>{n} orders</option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Max listings per run (cap)</label>
            <select
              value={data.max_per_run}
              onChange={(e) => updateField("max_per_run", Number(e.target.value))}
              disabled={busy}
              data-testid="auto-boost-max-per-run"
              className="w-full mt-1 bg-paper border border-line focus:border-brand outline-none px-3 py-2 font-mono text-xs text-ink disabled:opacity-50"
            >
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>{n} (~${n * 5}/wk max)</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div data-testid="auto-boost-preview">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
          Next-run preview ({candidates.length})
        </div>
        {candidates.length === 0 ? (
          <p className="font-mono text-xs text-ink-muted py-2">
            {enabled
              ? "No listings hit the threshold right now — keep selling and we'll catch the next surge."
              : "Enable auto-boost above to see your candidates."}
          </p>
        ) : (
          <ul className="border border-line divide-y divide-[#1f1f1f]" data-testid="auto-boost-list">
            {candidates.map((c) => (
              <li key={c.slug} className="flex items-center gap-3 px-3 py-2" data-testid={`auto-boost-candidate-${c.slug}`}>
                {c.thumbnail && <img src={c.thumbnail} alt="" className="w-10 h-10 object-cover border border-line" />}
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs text-ink truncate">{c.title}</div>
                  <div className="font-mono text-[10px] text-ink-muted">{c.orders_30d} orders in 30d</div>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand shrink-0">★ Will boost</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function AdStat({ label, value, testId, tone }) {
  return (
    <div className="border border-line p-2.5 text-center min-w-[84px]" data-testid={testId}>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">{label}</div>
      <div className={`font-display text-2xl mt-0.5 ${tone === "orange" ? "text-brand" : "text-ink"}`}>{value}</div>
    </div>
  );
}

// Row in the Active promotions list. Countdown to `promoted_until` + an
// "Extend" button that adds another week of burn to the same listing.
// When less than 48h remain, the row goes urgent — red flame badge, a
// pulse animation on the Extend button, and a one-click auto-renew
// toggle so the seller can lock in next week's pin without lifting a
// finger. Plus subscribers see "FREE" pricing on the toggle.
function PromotedRow({ p, isPlus, onExtend, onToggleAutoRenew, busy, renewBusy }) {
  const end = new Date(p.promoted_until);
  const msLeft = end.getTime() - Date.now();
  const daysLeft = Math.max(0, Math.floor(msLeft / (24 * 60 * 60 * 1000)));
  const hoursLeft = Math.max(0, Math.floor((msLeft / (60 * 60 * 1000)) % 24));
  const urgent = msLeft > 0 && msLeft < 48 * 60 * 60 * 1000;
  const autoRenew = !!p.auto_renew_promotion;

  return (
    <li
      className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${
        urgent ? "bg-brand/10 border-l-2 border-l-[#ff4500]" : ""
      }`}
      data-testid={`ads-active-${p.slug}`}
    >
      {p.images?.[0] && (
        <img src={p.images[0]} alt="" className="w-12 h-12 object-cover border border-brand/40" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-ink truncate">{p.title}</span>
          <span className="inline-block px-1.5 py-0.5 bg-brand text-ink text-[9px] font-bold">★ FEATURED</span>
          {urgent && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-brand/15 border border-brand text-[9px] font-bold uppercase tracking-[0.18em] text-brand animate-pulse"
              data-testid={`ads-urgent-${p.slug}`}
            >
              <Flame size={10} /> Ends soon
            </span>
          )}
          {autoRenew && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-emerald-400/40 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-300"
              data-testid={`ads-autorenew-on-${p.slug}`}
            >
              <RotateCw size={10} /> Auto · {isPlus ? "Free" : "$5/wk"}
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] text-ink-muted mt-0.5 flex items-center gap-2">
          <Calendar size={10} className="opacity-60" />
          <span className={urgent ? "text-brand font-bold" : ""}>
            {daysLeft}d {hoursLeft}h left
          </span>
          <span>· ends {end.toLocaleDateString()}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onToggleAutoRenew(!autoRenew)}
          disabled={renewBusy}
          className={`px-2.5 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50 inline-flex items-center gap-1.5 ${
            autoRenew
              ? "border-emerald-400 text-emerald-300 hover:bg-emerald-400/10"
              : "border-line text-ink-muted hover:border-ink-muted hover:text-ink"
          }`}
          data-testid={`ads-autorenew-${p.slug}`}
          title={
            autoRenew
              ? "Click to turn off weekly auto-renewal."
              : isPlus
                ? "Free for Plus — auto-extends this promotion every week."
                : "Auto-extends every week. $5/wk accrues to pending balance."
          }
        >
          <RotateCw size={11} className={renewBusy ? "animate-spin" : ""} />
          {renewBusy ? "…" : autoRenew ? "Auto-renew on" : `Auto-renew · ${isPlus ? "Free" : "$5/wk"}`}
        </button>
        <button
          onClick={onExtend}
          disabled={busy}
          className={`px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50 inline-flex items-center gap-1.5 ${
            urgent
              ? "border-brand bg-brand text-ink hover:bg-brand-hover"
              : "border-line hover:border-brand hover:text-brand"
          }`}
          data-testid={`ads-extend-${p.slug}`}
          title="Add another week to this promotion"
        >
          <Play size={11} /> {busy ? "…" : urgent ? "Extend now $5" : "Extend"}
        </button>
      </div>
    </li>
  );
}
