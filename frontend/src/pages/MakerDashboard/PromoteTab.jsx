/**
 * iter335 — Unified Promote Engine — Maker dashboard tab.
 *
 * Single-page UX for the Phase 1 spec:
 *   • Wallet (balance + top-up + monthly subscription)
 *   • Plan card (one budget · goal · channel · auto-allocate · pause/resume)
 *   • Distribution preview (live allocator dry-run as the slider moves)
 *   • Apply button (debits the wallet + extends `promoted_until`)
 *   • Analytics summary (spend · revenue · ROAS · per-listing rows)
 *
 * Phase 1 ships internal-only channels. The card surfaces external ones
 * as "Coming soon" so makers see the roadmap without being able to
 * toggle them on.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Wallet, Rocket, Pause, Play, Zap, TrendingUp, AlertCircle,
  Loader2, Plus, RefreshCw, CreditCard, History, Sparkles,
} from "lucide-react";

import {
  fetchPromoteWallet, topupPromoteWallet, subscribePromoteWallet,
  cancelPromoteSubscription,
  fetchPromoteCampaign, upsertPromoteCampaign, previewPromoteCampaign,
  pausePromoteCampaign, resumePromoteCampaign, applyPromoteCampaign,
  fetchPromoteAnalytics,
  fetchPromoteChannels, fetchExternalCampaigns,
  launchExternalCampaign, pauseExternalCampaign, resumeExternalCampaign,
} from "../../lib/api";
import PromoteWizard, { shouldShowWizard, shouldShowSuccessStep } from "./PromoteWizard";

const TOPUP_PRESETS = [1000, 2500, 5000, 10000]; // $10 · $25 · $50 · $100
const BUDGET_PRESETS = [1000, 2500, 5000, 10000, 25000]; // $10 → $250
const GOAL_OPTIONS = [
  { id: "sales",   label: "Increase sales",  desc: "Bias budget toward listings with the highest conversion rate." },
  { id: "traffic", label: "Drive traffic",   desc: "Spread budget evenly to grow click volume across the catalog." },
  { id: "reach",   label: "Build awareness", desc: "Push newer + lower-traffic listings to bootstrap visibility." },
];

function dollars(cents) { return `$${((cents || 0) / 100).toFixed(2)}`; }
function dollarsRound(cents) { return `$${Math.round((cents || 0) / 100)}`; }

export default function PromoteTab() {
  const [wallet, setWallet] = useState(null);
  const [campaign, setCampaign] = useState(null);
  const [allocations, setAllocations] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [channels, setChannels] = useState([]);
  const [extCampaigns, setExtCampaigns] = useState([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  // Form state for the plan card (decoupled from server so the slider
  // feels instant).
  const [budgetCents, setBudgetCents] = useState(5000);
  const [goal, setGoal] = useState("sales");
  const [autoAllocate, setAutoAllocate] = useState(true);
  const [preview, setPreview] = useState([]);

  // Initial load + handle ?topup=success / ?subscribe=success post-Stripe.
  useEffect(() => {
    let cancelled = false;
    // Capture the return-from-Stripe state BEFORE the cleanup block
    // below scrubs the URL params. The async data-fetch resolves later,
    // by which time the params are gone.
    const wantSuccessStep = shouldShowSuccessStep();
    (async () => {
      try {
        const [w, c, a, ch, ext] = await Promise.all([
          fetchPromoteWallet(), fetchPromoteCampaign(), fetchPromoteAnalytics(),
          fetchPromoteChannels(), fetchExternalCampaigns(),
        ]);
        if (cancelled) return;
        setWallet(w);
        setCampaign(c.campaign || null);
        setAllocations(c.allocations || []);
        setAnalytics(a);
        setChannels(ch.channels || []);
        setExtCampaigns(ext.campaigns || []);
        // iter335.9 — Post-fund return: re-open at step 4 ("You're live")
        // takes precedence over the regular first-time-empty trigger.
        if (wantSuccessStep) {
          setWizardStep(4);
          setWizardOpen(true);
        } else if (shouldShowWizard(w, c.campaign)) {
          setWizardStep(1);
          setWizardOpen(true);
        }
        if (c.campaign) {
          setBudgetCents(c.campaign.budget_cents || 5000);
          setGoal(c.campaign.goal || "sales");
          setAutoAllocate(c.campaign.auto_allocate !== false);
        }
      } catch (e) {
        if (!cancelled) toast.error("Could not load Promote data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const params = new URLSearchParams(window.location.search);
    if (params.get("topup") === "success") {
      toast.success("Wallet top-up received. Funds will appear within ~30s.");
      cleanQueryParam(["topup", "session_id"]);
    } else if (params.get("topup") === "cancelled") {
      toast.info("Top-up cancelled. No funds were charged.");
      cleanQueryParam(["topup"]);
    }
    if (params.get("subscribe") === "success") {
      toast.success("Promote subscription active. First credit lands now; auto-renews monthly.");
      cleanQueryParam(["subscribe"]);
    }
    return () => { cancelled = true; };
  }, []);

  // Live allocator dry-run when the slider/goal change.
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await previewPromoteCampaign({
          budget_cents: budgetCents, goal, channels: ["internal"],
          auto_allocate: autoAllocate,
        });
        if (!cancelled) setPreview(r.allocations || []);
      } catch {
        if (!cancelled) setPreview([]);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [budgetCents, goal, autoAllocate, loading]);

  const refresh = async () => {
    const [w, c, a, ch, ext] = await Promise.all([
      fetchPromoteWallet(), fetchPromoteCampaign(), fetchPromoteAnalytics(),
      fetchPromoteChannels(), fetchExternalCampaigns(),
    ]);
    setWallet(w);
    setCampaign(c.campaign || null);
    setAllocations(c.allocations || []);
    setAnalytics(a);
    setChannels(ch.channels || []);
    setExtCampaigns(ext.campaigns || []);
  };

  const onTopup = async (amount) => {
    setBusy(`topup-${amount}`);
    try {
      const r = await topupPromoteWallet(amount);
      window.location.assign(r.checkout_url);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start checkout.");
      setBusy("");
    }
  };
  const onSubscribe = async (amount) => {
    setBusy(`sub-${amount}`);
    try {
      const r = await subscribePromoteWallet(amount);
      window.location.assign(r.checkout_url);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start subscription.");
      setBusy("");
    }
  };
  const onCancelSub = async () => {
    setBusy("cancel-sub");
    try {
      await cancelPromoteSubscription();
      toast.success("Subscription cancelled. Wallet keeps its current balance.");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel.");
    } finally { setBusy(""); }
  };
  const onSave = async () => {
    setBusy("save");
    try {
      await upsertPromoteCampaign({
        budget_cents: budgetCents, goal, channels: ["internal"],
        auto_allocate: autoAllocate,
      });
      toast.success("Promote plan saved.");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed.");
    } finally { setBusy(""); }
  };
  const onApply = async () => {
    setBusy("apply");
    try {
      const r = await applyPromoteCampaign();
      if (r.boosts_applied > 0) {
        toast.success(`Applied · ${r.boosts_applied} boost-weeks · ${dollars(r.cents_spent)} spent.`);
      } else {
        toast.info("Nothing to apply — wallet balance below the $5 boost threshold.");
      }
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Apply failed.");
    } finally { setBusy(""); }
  };
  const onPauseResume = async () => {
    const next = campaign?.status === "active" ? "paused" : "active";
    setBusy("pause");
    try {
      if (next === "paused") await pausePromoteCampaign();
      else await resumePromoteCampaign();
      toast.success(`Plan ${next}.`);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not change status.");
    } finally { setBusy(""); }
  };

  const onLaunchExternal = async (channel, slug) => {
    setBusy(`launch-${channel}-${slug}`);
    try {
      const r = await launchExternalCampaign(channel, slug);
      if (r.created) toast.success(`Created paused ${channel} campaign · review before activating.`);
      else toast.info(`${channel} campaign already exists for this listing.`);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not launch external campaign.");
    } finally { setBusy(""); }
  };

  const onToggleExternal = async (row) => {
    const next = row.status === "active" ? "pause" : "resume";
    setBusy(`ext-${row.external_id}`);
    try {
      if (next === "pause") await pauseExternalCampaign(row.channel, row.external_id);
      else await resumeExternalCampaign(row.channel, row.external_id);
      toast.success(`${row.channel} · ${next === "resume" ? "activated — real spend starts now" : "paused"}.`);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not change status.");
    } finally { setBusy(""); }
  };

  const balance = wallet?.balance_cents || 0;
  const lifetimeSpent = wallet?.lifetime_spent_cents || 0;
  const lifetimeFunded = wallet?.lifetime_funded_cents || 0;
  const sub = wallet?.subscription;
  const hasActiveSub = sub?.status === "active";

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="inline animate-spin text-[#ff4500]" size={28} />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="promote-tab">
      {wizardOpen && (
        <PromoteWizard
          initialStep={wizardStep}
          wallet={wallet}
          onComplete={async () => { setWizardOpen(false); await refresh(); }}
          onDismiss={() => setWizardOpen(false)}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#262626] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Rocket size={22} className="text-[#ff4500]" />
            <h1 className="font-display text-3xl text-[#f5f5f5]">Promote</h1>
            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-cyan-400 border border-cyan-400/40 px-1.5 py-0.5">Beta</span>
          </div>
          <p className="text-sm text-[#a3a3a3] mt-1 max-w-xl">
            Set one budget. We pick which listings to boost based on your goal — no campaign manager, no per-listing micromanaging.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              try { localStorage.removeItem("promote_wizard_dismissed"); } catch { /* noop */ }
              setWizardStep(1);
              setWizardOpen(true);
            }}
            className="px-3 py-2 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] flex items-center gap-1.5"
            data-testid="promote-rerun-wizard-btn"
            title="Re-open the 3-step setup wizard"
          >
            <Rocket size={11} /> Setup
          </button>
          <button
            onClick={refresh}
            className="px-3 py-2 border border-[#262626] hover:border-cyan-400 font-mono text-[10px] uppercase tracking-[0.22em] flex items-center gap-1.5"
            data-testid="promote-refresh-btn"
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </header>

      {/* ── Wallet ─────────────────────────────────────────────────── */}
      <section className="border border-[#262626] bg-[#0a0a0a] p-5" data-testid="promote-wallet-card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-[#a3a3a3] font-mono text-[10px] uppercase tracking-[0.25em]">
              <Wallet size={12} /> Wallet
            </div>
            <div className="font-display text-5xl text-[#f5f5f5] mt-1" data-testid="promote-wallet-balance">
              {dollars(balance)}
            </div>
            <div className="text-xs text-[#737373] mt-1">
              Lifetime funded {dollars(lifetimeFunded)} · spent {dollars(lifetimeSpent)}
            </div>
          </div>
          {hasActiveSub && (
            <div className="text-right">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-emerald-400">Subscription active</div>
              <div className="text-sm text-[#a3a3a3] mt-1">{dollarsRound(sub.monthly_cents)}/mo · auto-renews</div>
              <button
                onClick={onCancelSub}
                disabled={busy === "cancel-sub"}
                className="mt-2 px-2 py-1 border border-red-900/60 text-red-300 hover:border-red-500 hover:text-red-200 font-mono text-[9px] uppercase tracking-[0.22em] disabled:opacity-50"
                data-testid="promote-cancel-sub-btn"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="mt-5 grid sm:grid-cols-2 gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2 flex items-center gap-1.5">
              <Plus size={11} /> One-time top-up
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TOPUP_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => onTopup(c)}
                  disabled={busy === `topup-${c}`}
                  className="px-3 py-2 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-xs disabled:opacity-50"
                  data-testid={`promote-topup-${c}`}
                >
                  {busy === `topup-${c}` ? <Loader2 size={11} className="animate-spin inline" /> : dollarsRound(c)}
                </button>
              ))}
            </div>
          </div>
          {!hasActiveSub && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2 flex items-center gap-1.5">
                <CreditCard size={11} /> Monthly auto-refill
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[2500, 5000, 10000].map((c) => (
                  <button
                    key={c}
                    onClick={() => onSubscribe(c)}
                    disabled={busy === `sub-${c}`}
                    className="px-3 py-2 border border-[#262626] hover:border-cyan-400 hover:text-cyan-400 font-mono text-xs disabled:opacity-50"
                    data-testid={`promote-subscribe-${c}`}
                  >
                    {busy === `sub-${c}` ? <Loader2 size={11} className="animate-spin inline" /> : `${dollarsRound(c)}/mo`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {wallet?.transactions?.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#f5f5f5] flex items-center gap-1.5">
              <History size={11} /> Recent activity ({wallet.transactions.length})
            </summary>
            <table className="w-full mt-3 text-xs">
              <tbody>
                {wallet.transactions.slice(0, 10).map((t, i) => (
                  <tr key={i} className="border-b border-[#1f1f1f]" data-testid="promote-txn-row">
                    <td className="py-1.5 font-mono text-[10px] text-[#737373]">{(t.created_at || "").slice(0, 10)}</td>
                    <td className="py-1.5 text-[#a3a3a3] capitalize">{t.kind}</td>
                    <td className={`py-1.5 text-right font-mono ${t.delta_cents > 0 ? "text-emerald-400" : "text-red-300"}`}>
                      {t.delta_cents > 0 ? "+" : ""}{dollars(t.delta_cents)}
                    </td>
                    <td className="py-1.5 text-right text-[#737373] font-mono">{dollars(t.balance_after_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>

      {/* ── Plan ───────────────────────────────────────────────────── */}
      <section className="border border-[#262626] bg-[#0a0a0a] p-5" data-testid="promote-plan-card">
        <div className="flex items-center justify-between mb-4">
          <div className="font-display text-xl text-[#f5f5f5]">Your Promotion Plan</div>
          {campaign && (
            <button
              onClick={onPauseResume}
              disabled={busy === "pause"}
              className="px-3 py-1.5 border border-[#262626] hover:border-cyan-400 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
              data-testid="promote-pause-btn"
            >
              {campaign.status === "active" ? <><Pause size={11} /> Pause</> : <><Play size={11} /> Resume</>}
            </button>
          )}
        </div>

        {/* Budget slider */}
        <div className="mb-5">
          <div className="flex items-baseline justify-between mb-1">
            <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Budget per month</label>
            <span className="font-display text-2xl text-[#ff4500]" data-testid="promote-budget-display">
              {dollarsRound(budgetCents)}<span className="text-sm text-[#737373]">/mo</span>
            </span>
          </div>
          <input
            type="range" min={500} max={50000} step={500}
            value={budgetCents}
            onChange={(e) => setBudgetCents(Number(e.target.value))}
            className="w-full accent-[#ff4500]"
            data-testid="promote-budget-slider"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {BUDGET_PRESETS.map((c) => (
              <button
                key={c}
                onClick={() => setBudgetCents(c)}
                className={`px-2 py-1 border font-mono text-[10px] ${budgetCents === c ? "border-[#ff4500] text-[#ff4500]" : "border-[#262626] text-[#a3a3a3] hover:border-[#525252]"}`}
                data-testid={`promote-budget-preset-${c}`}
              >
                {dollarsRound(c)}
              </button>
            ))}
          </div>
        </div>

        {/* Goal */}
        <div className="mb-5">
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-2">Goal</label>
          <div className="grid sm:grid-cols-3 gap-2">
            {GOAL_OPTIONS.map((g) => (
              <button
                key={g.id}
                onClick={() => setGoal(g.id)}
                className={`text-left p-3 border ${goal === g.id ? "border-[#ff4500] bg-[#1a0e08]" : "border-[#262626] hover:border-[#525252]"}`}
                data-testid={`promote-goal-${g.id}`}
              >
                <div className="font-mono text-xs text-[#f5f5f5]">{g.label}</div>
                <div className="text-[10px] text-[#737373] mt-1 leading-snug">{g.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Channels — iter335.5 */}
        <div className="mb-5">
          <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-2">Channels</label>
          <div className="grid sm:grid-cols-2 gap-2">
            <ChannelChip
              label="Crafters Market"
              sublabel="Featured rails · search rank boost"
              active state="active"
              testId="promote-channel-internal"
            />
            {channels.map((ch) => (
              <ChannelChip
                key={ch.channel}
                label={ch.channel === "microsoft" ? "Microsoft Ads" : ch.channel === "google" ? "Google Ads" : "Meta Ads"}
                sublabel={ch.eligible
                  ? `${ch.active_count} active campaign${ch.active_count === 1 ? "" : "s"} · launch per listing below`
                  : ch.reason}
                state={ch.eligible ? "available" : "blocked"}
                testId={`promote-channel-${ch.channel}`}
              />
            ))}
          </div>
          <p className="text-[10px] text-[#737373] mt-2">
            External channels are opt-in per listing. New campaigns always start paused — review before activating.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-[#a3a3a3] mb-5 cursor-pointer">
          <input
            type="checkbox" checked={autoAllocate}
            onChange={(e) => setAutoAllocate(e.target.checked)}
            className="accent-[#ff4500]"
            data-testid="promote-auto-allocate"
          />
          Let Crafters Market auto-distribute across my listings (recommended)
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onSave}
            disabled={busy === "save"}
            className="px-4 py-2.5 bg-[#ff4500] text-[#0a0a0a] font-mono text-xs uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
            data-testid="promote-save-btn"
          >
            {busy === "save" ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            {campaign ? "Update plan" : "Launch"}
          </button>
          {campaign && (
            <button
              onClick={onApply}
              disabled={busy === "apply" || balance < 500}
              className="px-4 py-2.5 border border-[#ff4500] text-[#ff4500] hover:bg-[#1a0e08] font-mono text-xs uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
              data-testid="promote-apply-btn"
              title={balance < 500 ? "Wallet needs at least $5 to apply a boost." : ""}
            >
              {busy === "apply" ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}
              Apply now
            </button>
          )}
        </div>

        {balance < 500 && (
          <div className="mt-3 text-[11px] text-amber-300 flex items-center gap-1.5">
            <AlertCircle size={11} /> Wallet needs at least $5 before the next apply. Top up above to unlock boosts.
          </div>
        )}
      </section>

      {/* ── Distribution preview ───────────────────────────────────── */}
      <section className="border border-[#262626] bg-[#0a0a0a] p-5" data-testid="promote-distribution-card">
        <div className="flex items-center justify-between mb-3">
          <div className="font-display text-xl text-[#f5f5f5] flex items-center gap-2">
            <TrendingUp size={18} className="text-cyan-400" />
            Smart distribution
          </div>
          <span className="font-mono text-[10px] text-[#737373]">live preview · {preview.length} listings</span>
        </div>
        {preview.length === 0 && (
          <p className="text-sm text-[#a3a3a3]">
            No published listings yet — list something in <span className="text-[#ff4500]">Listings</span> first and we&apos;ll start allocating.
          </p>
        )}
        {preview.length > 0 && (
          <div className="space-y-2">
            {preview.slice(0, 8).map((a) => (
              <div key={a.slug} className="flex items-center gap-3" data-testid={`promote-alloc-row-${a.slug}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[#f5f5f5] truncate">{a.title}</div>
                  <div className="h-1.5 mt-1 bg-[#1f1f1f] rounded">
                    <div
                      className="h-1.5 bg-gradient-to-r from-[#ff4500] to-[#ff8800] rounded"
                      style={{ width: `${Math.round((a.weight || 0) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xs text-[#f5f5f5]">{dollars(a.allocated_cents)}</div>
                  <div className="font-mono text-[9px] text-[#737373]">{Math.round((a.weight || 0) * 100)}%</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── External campaigns (iter335.5) ─────────────────────────── */}
      {(extCampaigns.length > 0 || channels.some((c) => c.eligible)) && (
        <section className="border border-[#262626] bg-[#0a0a0a] p-5" data-testid="promote-external-card">
          <div className="font-display text-xl text-[#f5f5f5] mb-1">External channels</div>
          <p className="text-xs text-[#737373] mb-4">
            Launch real campaigns on supported ad networks. Each campaign starts <span className="text-amber-300">paused</span> — activate manually when you&apos;re ready to spend.
          </p>

          {/* Per-listing launch row — show only listings above the $35 floor. */}
          {channels.filter((c) => c.eligible).length > 0 && preview.length > 0 && (
            <div className="mb-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                Launch new (listings allocated ≥ $35)
              </div>
              <div className="space-y-1">
                {preview.filter((p) => p.allocated_cents >= 3500).slice(0, 5).map((p) => (
                  <div key={p.slug} className="flex items-center gap-2 text-sm border border-[#1f1f1f] px-3 py-2" data-testid={`promote-ext-launch-${p.slug}`}>
                    <span className="flex-1 truncate text-[#f5f5f5]">{p.title}</span>
                    <span className="font-mono text-[10px] text-[#737373]">{dollars(p.allocated_cents)}/mo</span>
                    {channels.filter((c) => c.eligible).map((c) => (
                      <button
                        key={c.channel}
                        onClick={() => onLaunchExternal(c.channel, p.slug)}
                        disabled={busy === `launch-${c.channel}-${p.slug}`}
                        className="px-2 py-1 border border-cyan-400/40 hover:bg-cyan-400/10 text-cyan-300 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
                        data-testid={`promote-launch-${c.channel}-${p.slug}`}
                      >
                        {busy === `launch-${c.channel}-${p.slug}` ? <Loader2 size={10} className="animate-spin" /> : `+ ${c.channel}`}
                      </button>
                    ))}
                  </div>
                ))}
                {preview.filter((p) => p.allocated_cents >= 3500).length === 0 && (
                  <div className="text-xs text-[#737373] py-2">
                    No listings are allocated $35/mo or more yet. Bump your monthly budget or focus on fewer listings to qualify for external channels.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Existing external campaigns */}
          {extCampaigns.length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                Your external campaigns ({extCampaigns.length})
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#262626] font-mono text-[9px] uppercase tracking-[0.22em] text-[#737373]">
                    <th className="text-left py-1.5">Listing</th>
                    <th className="text-left py-1.5">Channel</th>
                    <th className="text-right py-1.5">Daily</th>
                    <th className="text-right py-1.5">Status</th>
                    <th className="text-right py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {extCampaigns.map((row) => (
                    <tr key={`${row.channel}-${row.external_id}`} className="border-b border-[#1f1f1f]" data-testid={`promote-ext-row-${row.external_id}`}>
                      <td className="py-2 text-[#f5f5f5] truncate max-w-[12rem]">{row.listing_slug}</td>
                      <td className="py-2 text-[#a3a3a3] capitalize">{row.channel}</td>
                      <td className="py-2 text-right font-mono text-[#a3a3a3]">{dollars(row.daily_budget_cents)}</td>
                      <td className={`py-2 text-right font-mono uppercase tracking-[0.18em] text-[10px] ${row.status === "active" ? "text-emerald-400" : "text-amber-300"}`}>
                        {row.status}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => onToggleExternal(row)}
                          disabled={busy === `ext-${row.external_id}`}
                          className="px-2 py-1 border border-[#262626] hover:border-cyan-400 font-mono text-[10px] uppercase tracking-[0.22em] disabled:opacity-50"
                          data-testid={`promote-ext-toggle-${row.external_id}`}
                        >
                          {busy === `ext-${row.external_id}` ? <Loader2 size={10} className="animate-spin" /> : (row.status === "active" ? "Pause" : "Activate")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Analytics ──────────────────────────────────────────────── */}
      {analytics && (
        <section className="border border-[#262626] bg-[#0a0a0a] p-5" data-testid="promote-analytics-card">
          <div className="font-display text-xl text-[#f5f5f5] mb-3">Performance</div>
          <div className="grid sm:grid-cols-4 gap-3">
            <Stat label="Spent" value={dollars(analytics.spend_cents)} testid="promote-stat-spend" />
            <Stat label="Revenue (boosted listings, last 30d)" value={dollars(analytics.revenue_cents)} testid="promote-stat-revenue" />
            <Stat label="Orders" value={String(analytics.order_count)} testid="promote-stat-orders" />
            <Stat
              label="ROAS"
              value={analytics.spend_cents > 0 ? `${analytics.roas.toFixed(2)}×` : "—"}
              testid="promote-stat-roas"
              accent={analytics.roas >= 2 ? "text-emerald-400" : analytics.roas > 0 ? "text-amber-300" : ""}
            />
          </div>
          {analytics.per_listing?.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#262626] font-mono text-[9px] uppercase tracking-[0.22em] text-[#737373]">
                    <th className="text-left py-1.5">Listing</th>
                    <th className="text-right py-1.5">Boosts</th>
                    <th className="text-right py-1.5">Spent</th>
                    <th className="text-right py-1.5">Promoted until</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.per_listing.slice(0, 10).map((row) => (
                    <tr key={row.slug} className="border-b border-[#1f1f1f]" data-testid={`promote-analytics-row-${row.slug}`}>
                      <td className="py-2 text-[#f5f5f5] truncate max-w-[14rem]">{row.title}</td>
                      <td className="py-2 text-right font-mono text-[#a3a3a3]">{row.total_boosts || 0}</td>
                      <td className="py-2 text-right font-mono text-[#a3a3a3]">{dollars(row.total_spent_cents)}</td>
                      <td className="py-2 text-right font-mono text-[10px] text-[#737373]">{(row.promoted_until || "—").slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, accent = "", testid }) {
  return (
    <div className="border border-[#262626] p-3" data-testid={testid}>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#737373]">{label}</div>
      <div className={`font-display text-2xl mt-1 ${accent || "text-[#f5f5f5]"}`}>{value}</div>
    </div>
  );
}

function ChannelChip({ label, sublabel, state, testId }) {
  // state: "active" (this maker's primary on-platform channel),
  //        "available" (external channel ready to launch),
  //        "blocked" (pending approval / connect required)
  const tone =
    state === "active"    ? "border-[#ff4500] text-[#ff4500] bg-[#1a0e08]" :
    state === "available" ? "border-cyan-400/60 text-cyan-300 bg-cyan-400/5" :
                            "border-[#262626] text-[#525252]";
  return (
    <div className={`px-3 py-2 border ${tone}`} data-testid={testId}>
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] flex items-center gap-1.5">
        {state === "active" && <Sparkles size={11} />}
        {label}
      </div>
      <div className="text-[10px] mt-1 leading-snug opacity-90">{sublabel}</div>
    </div>
  );
}

function cleanQueryParam(keys) {
  const params = new URLSearchParams(window.location.search);
  let dirty = false;
  for (const k of keys) {
    if (params.has(k)) { params.delete(k); dirty = true; }
  }
  if (!dirty) return;
  const newUrl =
    window.location.pathname +
    (params.toString() ? `?${params}` : "") +
    window.location.hash;
  window.history.replaceState({}, "", newUrl);
}
