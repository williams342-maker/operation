/**
 * iter335.6 — First-time Promote setup wizard.
 *
 * 3-step flow optimized for a new maker who's never funded the wallet:
 *   1. GOAL    — pick sales / traffic / reach (3 radio cards)
 *   2. BUDGET  — slider + presets, live distribution preview
 *   3. FUND    — one-time top-up or monthly auto-refill → Stripe Checkout
 *
 * Triggers when ALL three are true:
 *   • Wallet is empty AND has never been funded (no prior top-ups)
 *   • No campaign group exists yet for this maker
 *   • User hasn't explicitly dismissed the wizard (localStorage flag)
 *
 * The wizard creates the campaign on Step 2 → Continue so that when
 * the maker funds in Step 3 and Stripe redirects back, the plan is
 * already saved and the first allocator pass can fire automatically.
 *
 * `<Dialog>` from shadcn was deliberately not used — the wizard needs
 * a full-bleed CTA aesthetic that doesn't visually fit Shadcn's
 * generic modal frame.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Rocket, Target, TrendingUp, Eye, Wallet, Sparkles, ChevronRight,
  ChevronLeft, Loader2, X,
} from "lucide-react";

import {
  upsertPromoteCampaign, previewPromoteCampaign, topupPromoteWallet,
  subscribePromoteWallet, applyPromoteCampaign, recommendPromoteBudget,
} from "../../lib/api";

const DISMISS_KEY = "promote_wizard_dismissed";
// iter335.9 — Set right before redirecting to Stripe so the post-fund
// return path knows to re-open the wizard at the success step (4).
const PENDING_RETURN_KEY = "promote_wizard_pending_return";

const GOALS = [
  { id: "sales",   label: "Increase sales",  icon: TrendingUp,
    blurb: "Bias budget toward listings with the highest conversion rate. Best for makers with proven inventory." },
  { id: "traffic", label: "Drive traffic",   icon: Target,
    blurb: "Spread budget evenly to grow click volume across your catalog. Best when you're testing many SKUs." },
  { id: "reach",   label: "Build awareness", icon: Eye,
    blurb: "Push newer + lower-traffic listings to bootstrap visibility. Best for makers under 6 months old." },
];

const BUDGET_PRESETS = [2500, 5000, 10000, 25000]; // $25 · $50 · $100 · $250

function dollarsRound(c) { return `$${Math.round((c || 0) / 100)}`; }
function dollars(c)      { return `$${((c || 0) / 100).toFixed(2)}`; }


export function shouldShowWizard(wallet, campaign) {
  if (!wallet) return false;
  if (campaign) return false;
  if ((wallet.balance_cents || 0) > 0) return false;
  if ((wallet.lifetime_funded_cents || 0) > 0) return false;
  try {
    if (localStorage.getItem(DISMISS_KEY) === "true") return false;
  } catch { /* localStorage blocked */ }
  return true;
}


/** iter335.9 — Post-fund return detector. Returns true when we should
 * re-open the wizard at the success step (4) instead of letting the
 * regular Promote tab render. Used by PromoteTab to decide whether
 * to mount <PromoteWizard initialStep={4} />.
 */
export function shouldShowSuccessStep() {
  try {
    if (localStorage.getItem(PENDING_RETURN_KEY) !== "true") return false;
  } catch { return false; }
  const params = new URLSearchParams(window.location.search);
  const flag = params.get("topup") || params.get("subscribe");
  return flag === "success";
}


export default function PromoteWizard({ onComplete, onDismiss, initialStep = 1, wallet }) {
  const [step, setStep] = useState(initialStep);
  const [goal, setGoal] = useState("sales");
  const [budgetCents, setBudgetCents] = useState(5000);
  const [preview, setPreview] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Debounced trigger — bumps 250ms after budget/goal change so the
  // allocator only fires once per slider drag.
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    if (step !== 2) return undefined;
    const t = setTimeout(() => setPreviewKey((k) => k + 1), 250);
    return () => clearTimeout(t);
  }, [step, budgetCents, goal]);

  // Actual fetch — same IIFE pattern as PromoteThemesCard.
  useEffect(() => {
    if (step !== 2) return undefined;
    let cancelled = false;
    (async () => {
      setPreviewLoading(true);
      try {
        const r = await previewPromoteCampaign({
          budget_cents: budgetCents, goal, channels: ["internal"],
          auto_allocate: true,
        });
        if (!cancelled) setPreview(r.allocations || []);
      } catch (_e) {
        if (!cancelled) setPreview([]);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [previewKey, step]);
  const [busy, setBusy] = useState("");
  const [applyResult, setApplyResult] = useState(null);
  // iter335.13 — AI Recommend Budget
  const [recommendation, setRecommendation] = useState(null);
  const [recLoading, setRecLoading] = useState(false);

  const onRecommend = async () => {
    setRecLoading(true);
    try {
      const r = await recommendPromoteBudget(goal);
      setRecommendation(r);
      setBudgetCents(r.recommended_cents);
      toast.success(`Recommended ${"$" + Math.round(r.recommended_cents / 100)}/mo · ~${r.expected_orders} order${r.expected_orders === 1 ? "" : "s"}/mo`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't compute recommendation.");
    } finally { setRecLoading(false); }
  };

  // Step 2 live distribution preview — same debounced pattern as the
  // main Promote tab so it doesn't hammer the allocator on slider drag.
  // (debounced trigger + actual fetch live above, near the state hooks)

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
      // Also clear pending-return so a stale flag never re-opens
      // the wizard mid-session.
      localStorage.removeItem(PENDING_RETURN_KEY);
    } catch { /* noop */ }
    onDismiss?.();
  };

  const next = async () => {
    if (step === 1) { setStep(2); return; }
    if (step === 2) {
      // Save the campaign so funding (Step 3) lands on an existing plan.
      setBusy("save");
      try {
        await upsertPromoteCampaign({
          budget_cents: budgetCents, goal, channels: ["internal"],
          auto_allocate: true,
        });
        setStep(3);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Could not save plan.");
      } finally { setBusy(""); }
      return;
    }
  };

  const back = () => setStep((s) => Math.max(1, s - 1));

  const onTopup = async (amount) => {
    setBusy(`topup-${amount}`);
    try {
      const r = await topupPromoteWallet(amount);
      try {
        localStorage.setItem(DISMISS_KEY, "true");
        localStorage.setItem(PENDING_RETURN_KEY, "true");
      } catch { /* noop */ }
      onComplete?.();
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
      try {
        localStorage.setItem(DISMISS_KEY, "true");
        localStorage.setItem(PENDING_RETURN_KEY, "true");
      } catch { /* noop */ }
      onComplete?.();
      window.location.assign(r.checkout_url);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start subscription.");
      setBusy("");
    }
  };

  const onApplyNow = async () => {
    setBusy("apply");
    try {
      const r = await applyPromoteCampaign();
      setApplyResult(r);
      if ((r.boosts_applied || 0) > 0) {
        toast.success(`Applied · ${r.boosts_applied} boost-weeks · $${((r.cents_spent || 0)/100).toFixed(2)} spent.`);
      } else {
        toast.info("Allocator ran — funds will boost listings on the next daily pass.");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Apply failed.");
    } finally { setBusy(""); }
  };

  const finishSuccess = () => {
    try { localStorage.removeItem(PENDING_RETURN_KEY); } catch { /* noop */ }
    onComplete?.();
  };

  const goalMeta = useMemo(() => GOALS.find((g) => g.id === goal), [goal]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-paper/80 backdrop-blur-sm p-4"
      data-testid="promote-wizard"
      onClick={(e) => e.target === e.currentTarget && dismiss()}
    >
      <div className="relative w-full max-w-2xl bg-paper border border-line shadow-2xl shadow-[#ff4500]/10">
        {/* Close */}
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 text-ink-muted hover:text-ink p-1"
          data-testid="promote-wizard-close"
          aria-label="Close wizard"
        >
          <X size={16} />
        </button>

        {/* Header / progress */}
        <header className="px-6 pt-6 pb-3">
          <div className="flex items-center gap-2 mb-1">
            <Rocket size={16} className="text-brand" />
            <span className="font-mono text-[9px] uppercase tracking-[0.28em] text-brand">
              {step === 4 ? "Promote · live" : `Set up Promote · ${step}/3`}
            </span>
          </div>
          <h2 className="font-display text-3xl text-ink">
            {step === 1 && "What's your goal?"}
            {step === 2 && "How much per month?"}
            {step === 3 && "Fund your wallet to launch"}
            {step === 4 && "🎉 You're live"}
          </h2>
          <div className="mt-3 flex gap-1">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className={`h-1 flex-1 ${n <= step ? "bg-brand" : "bg-line"}`}
                data-testid={`promote-wizard-progress-${n}`}
              />
            ))}
          </div>
        </header>

        {/* Step body */}
        <div className="px-6 py-4">
          {step === 1 && (
            <div className="space-y-2" data-testid="promote-wizard-step-1">
              {GOALS.map((g) => {
                const Icon = g.icon;
                const active = goal === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => setGoal(g.id)}
                    className={`w-full text-left p-4 border flex items-start gap-3 transition-colors ${
                      active
                        ? "border-brand bg-brand/10"
                        : "border-line hover:border-ink-muted"
                    }`}
                    data-testid={`promote-wizard-goal-${g.id}`}
                  >
                    <Icon size={20} className={active ? "text-brand shrink-0 mt-0.5" : "text-ink-muted shrink-0 mt-0.5"} />
                    <div className="min-w-0">
                      <div className={`font-mono text-xs uppercase tracking-[0.18em] ${active ? "text-brand" : "text-ink"}`}>
                        {g.label}
                      </div>
                      <div className="text-[11px] text-ink-muted mt-1 leading-snug">
                        {g.blurb}
                      </div>
                    </div>
                    {active && <Sparkles size={14} className="text-brand shrink-0 mt-1 ml-auto" />}
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div data-testid="promote-wizard-step-2">
              <div className="flex items-baseline justify-between mb-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Monthly budget</span>
                <span className="font-display text-4xl text-brand" data-testid="promote-wizard-budget-value">
                  {dollarsRound(budgetCents)}
                  <span className="text-sm text-ink-muted">/mo</span>
                </span>
              </div>

              {/* iter335.13 — AI Recommend Budget */}
              <div className="mb-3">
                <button
                  type="button"
                  onClick={onRecommend}
                  disabled={recLoading}
                  className="px-3 py-1.5 border border-cyan-700/50 hover:border-cyan-400 hover:bg-cyan-950/30 text-cyan-300 hover:text-cyan-200 font-mono text-[10px] uppercase tracking-[0.22em] flex items-center gap-1.5 disabled:opacity-50"
                  data-testid="promote-wizard-recommend"
                >
                  {recLoading
                    ? <><Loader2 size={11} className="animate-spin" /> Computing…</>
                    : <><Sparkles size={11} /> Recommend a budget for me</>}
                </button>
                {recommendation && (
                  <div className="mt-2 border border-cyan-900/40 bg-cyan-950/20 p-3" data-testid="promote-wizard-recommendation">
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <div className="text-center">
                        <div className="font-display text-xl text-cyan-200 tabular-nums">~{recommendation.expected_reach.toLocaleString()}</div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-cyan-400/70 mt-0.5">Reach</div>
                      </div>
                      <div className="text-center">
                        <div className="font-display text-xl text-cyan-200 tabular-nums">~{recommendation.expected_clicks.toLocaleString()}</div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-cyan-400/70 mt-0.5">Clicks</div>
                      </div>
                      <div className="text-center">
                        <div className="font-display text-xl text-cyan-200 tabular-nums">~{recommendation.expected_orders}</div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-cyan-400/70 mt-0.5">Orders</div>
                      </div>
                    </div>
                    <p className="text-[11px] text-ink leading-snug" data-testid="promote-wizard-rec-rationale">
                      {recommendation.rationale}
                    </p>
                    <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
                      Based on {recommendation.basis === "your-data" ? "your historical data" : "marketplace defaults"} · range ${Math.round(recommendation.low_cents/100)}–${Math.round(recommendation.high_cents/100)}/mo
                    </div>
                  </div>
                )}
              </div>

              <input
                type="range" min={500} max={50000} step={500}
                value={budgetCents}
                onChange={(e) => setBudgetCents(Number(e.target.value))}
                className="w-full accent-[#ff4500]"
                data-testid="promote-wizard-slider"
              />
              <div className="flex flex-wrap gap-1.5 mt-2 mb-4">
                {BUDGET_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setBudgetCents(c)}
                    className={`px-2 py-1 border font-mono text-[10px] ${
                      budgetCents === c
                        ? "border-brand text-brand"
                        : "border-line text-ink-muted hover:border-ink-muted"
                    }`}
                    data-testid={`promote-wizard-preset-${c}`}
                  >
                    {dollarsRound(c)}
                  </button>
                ))}
              </div>

              <div className="border border-line p-3 bg-paper">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2 flex items-center gap-1.5">
                  <TrendingUp size={11} className="text-cyan-400" />
                  Smart distribution preview
                </div>
                {previewLoading && (
                  <div className="text-xs text-ink-muted py-2 flex items-center gap-2">
                    <Loader2 size={10} className="animate-spin" /> Scoring listings…
                  </div>
                )}
                {!previewLoading && preview.length === 0 && (
                  <div className="text-xs text-ink-muted py-2">
                    No published listings yet. The wizard will still create a plan — once you publish listings, the allocator picks them up automatically.
                  </div>
                )}
                {!previewLoading && preview.length > 0 && (
                  <div className="space-y-1.5">
                    {preview.slice(0, 4).map((a) => (
                      <div key={a.slug} className="flex items-center gap-2 text-xs" data-testid={`promote-wizard-alloc-${a.slug}`}>
                        <div className="flex-1 min-w-0">
                          <div className="text-ink truncate">{a.title}</div>
                          <div className="h-1 mt-0.5 bg-surface rounded">
                            <div
                              className="h-1 bg-gradient-to-r from-[#ff4500] to-[#ff8800] rounded"
                              style={{ width: `${Math.round((a.weight || 0) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="font-mono text-[10px] text-ink-muted tabular-nums w-16 text-right">{dollars(a.allocated_cents)}</span>
                      </div>
                    ))}
                    {preview.length > 4 && (
                      <div className="text-[10px] text-ink-muted pt-1">
                        + {preview.length - 4} more listing{preview.length - 4 === 1 ? "" : "s"}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3 text-[10px] text-ink-muted leading-snug">
                Goal: <span className="text-ink-muted">{goalMeta?.label}</span>.
                You can change this anytime from the Promote tab.
              </div>
            </div>
          )}

          {step === 3 && (
            <div data-testid="promote-wizard-step-3">
              <p className="text-sm text-ink-muted mb-4 leading-snug">
                Add credit to your Promote wallet to unlock boosts. Funds carry forward — unused $$ at month-end stays in your wallet.
              </p>

              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
                One-time top-up
              </div>
              <div className="grid grid-cols-4 gap-1.5 mb-5">
                {[2500, 5000, 10000, 25000].map((c) => (
                  <button
                    key={c}
                    onClick={() => onTopup(c)}
                    disabled={busy === `topup-${c}`}
                    className="p-3 border border-line hover:border-brand hover:text-brand font-display text-xl text-ink disabled:opacity-50 flex flex-col items-center"
                    data-testid={`promote-wizard-topup-${c}`}
                  >
                    {busy === `topup-${c}`
                      ? <Loader2 size={14} className="animate-spin" />
                      : <>{dollarsRound(c)}<span className="font-mono text-[9px] text-ink-muted uppercase tracking-[0.2em] mt-0.5">one-time</span></>}
                  </button>
                ))}
              </div>

              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
                Or — monthly auto-refill
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[2500, 5000, 10000].map((c) => (
                  <button
                    key={c}
                    onClick={() => onSubscribe(c)}
                    disabled={busy === `sub-${c}`}
                    className="p-3 border border-line hover:border-cyan-400 hover:text-cyan-400 font-display text-lg text-ink disabled:opacity-50 flex flex-col items-center"
                    data-testid={`promote-wizard-subscribe-${c}`}
                  >
                    {busy === `sub-${c}`
                      ? <Loader2 size={14} className="animate-spin" />
                      : <>{dollarsRound(c)}<span className="font-mono text-[9px] text-ink-muted uppercase tracking-[0.2em] mt-0.5">/month</span></>}
                  </button>
                ))}
              </div>

              <div className="mt-5 text-[10px] text-ink-muted leading-snug border-l-2 border-line pl-3">
                You&apos;ll be redirected to Stripe to complete payment. Funds appear in your wallet within ~30s of checkout completing. Cancel anytime.
              </div>
            </div>
          )}

          {step === 4 && (
            <div data-testid="promote-wizard-step-4">
              <div className="text-center py-2">
                <div className="font-display text-5xl text-brand mb-2" data-testid="promote-wizard-balance">
                  {wallet ? dollars(wallet.balance_cents || 0) : "—"}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted">
                  in your Promote wallet
                </div>
              </div>

              {!applyResult && (
                <div className="mt-5 border border-line p-4 bg-paper">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2 flex items-center gap-1.5">
                    <Sparkles size={11} className="text-cyan-400" /> Next: boost your listings
                  </div>
                  <p className="text-xs text-ink-muted leading-snug">
                    Click <span className="text-brand">Apply now</span> to fire the allocator immediately — your top-scoring listings get a 7-day boost on Crafters Market featured rails. Otherwise it runs automatically at 04:45 UTC tomorrow.
                  </p>
                </div>
              )}

              {applyResult && (
                <div className="mt-5 border border-emerald-900/40 bg-emerald-950/30 p-4" data-testid="promote-wizard-apply-result">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300 mb-2 flex items-center gap-1.5">
                    <Sparkles size={11} /> Boosts applied
                  </div>
                  <div className="text-sm text-ink">
                    <span className="font-display text-2xl text-brand">{applyResult.boosts_applied || 0}</span>
                    <span className="text-ink-muted ml-2">boost-week{applyResult.boosts_applied === 1 ? "" : "s"} applied · {dollars(applyResult.cents_spent || 0)} spent</span>
                  </div>
                  {(applyResult.allocations || []).filter((a) => (a.boosts_applied || 0) > 0).slice(0, 4).map((a) => (
                    <div key={a.slug} className="mt-2 text-xs text-ink-muted flex justify-between" data-testid={`promote-wizard-applied-${a.slug}`}>
                      <span className="truncate flex-1">{a.title}</span>
                      <span className="font-mono ml-2">{a.boosts_applied}× · {dollars(a.spent_cents)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer / nav */}
        <footer className="px-6 py-4 border-t border-line flex items-center justify-between">
          <button
            onClick={step === 1 ? dismiss : (step === 4 ? finishSuccess : back)}
            className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-ink flex items-center gap-1.5"
            data-testid="promote-wizard-back"
          >
            {step === 1 ? "Skip for now"
              : step === 4 ? "Done"
              : (<><ChevronLeft size={12} /> Back</>)}
          </button>

          {step < 3 && (
            <button
              onClick={next}
              disabled={busy === "save"}
              className="px-5 py-2.5 bg-brand text-[#0a0a0a] font-mono text-xs uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
              data-testid="promote-wizard-next"
            >
              {busy === "save"
                ? <Loader2 size={12} className="animate-spin" />
                : <>{step === 1 ? "Continue" : "Save & continue"} <ChevronRight size={12} /></>}
            </button>
          )}
          {step === 3 && (
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted flex items-center gap-1.5">
              <Wallet size={11} /> Pick an amount to launch
            </div>
          )}
          {step === 4 && !applyResult && (
            <button
              onClick={onApplyNow}
              disabled={busy === "apply" || !wallet || (wallet.balance_cents || 0) < 500}
              className="px-5 py-2.5 bg-brand text-[#0a0a0a] font-mono text-xs uppercase tracking-[0.22em] disabled:opacity-50 flex items-center gap-1.5"
              data-testid="promote-wizard-apply"
              title={(wallet && (wallet.balance_cents || 0) < 500) ? "Wallet balance below $5 boost threshold" : ""}
            >
              {busy === "apply"
                ? <Loader2 size={12} className="animate-spin" />
                : <><Rocket size={12} /> Apply now</>}
            </button>
          )}
          {step === 4 && applyResult && (
            <button
              onClick={finishSuccess}
              className="px-5 py-2.5 bg-brand text-[#0a0a0a] font-mono text-xs uppercase tracking-[0.22em] flex items-center gap-1.5"
              data-testid="promote-wizard-finish"
            >
              View dashboard <ChevronRight size={12} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
