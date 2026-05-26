/**
 * iter249 — Onboarding Welcome flow.
 *
 * 5 steps wired to /api/onboarding/{start,step,skip}:
 *   1. Welcome hero
 *   2. Choose Your Path (Maker / Buyer / Supporter)
 *   3. Why Crafters Market (3 value cards)
 *   4. First Action (path-specific)
 *   5. Quick Tour (skippable overlay)
 *
 * Visual language matches the rest of the site (dark cinematic
 * #0a0a0a + #ff4500 orange + #00ffff cyan) — NOT the green/cream
 * figma mock. Layout + copy follow the figma exactly.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShoppingBag, Hammer, Heart, Eye, Store, Users, Check,
  ArrowRight, ArrowLeft, X, Sparkles, Loader2, CreditCard, ExternalLink,
} from "lucide-react";
import { http } from "../lib/api";
import { useStructuredData } from "../lib/seo";

const PATHS = [
  { id: "buyer",     icon: ShoppingBag, label: "I want to discover products",
    blurb: "Find unique handmade items from amazing creators." },
  { id: "maker",     icon: Hammer,      label: "I am a maker / creator",
    blurb: "Sell my creations, build my brand, and connect with fans." },
  { id: "supporter", icon: Heart,       label: "I want to support creators",
    blurb: "Support and engage with makers and their creations." },
];

const VALUES = [
  { icon: Eye,   title: "Visibility Without Algorithms",
    blurb: "Your work is seen based on quality, not followers." },
  { icon: Store, title: "Built for Makers",
    blurb: "Everything you need to showcase, sell, and grow your brand." },
  { icon: Users, title: "Community First",
    blurb: "Connect with real buyers and creators who support your work." },
];

const FIRST_ACTIONS = {
  maker: [
    { key: "profile_created", label: "Create profile", blurb: "Add your info" },
    { key: "first_upload",    label: "Upload your first item", blurb: "Showcase your work" },
    { key: "first_follow",    label: "Connect", blurb: "Follow makers you love" },
  ],
  buyer: [
    { key: "first_follow",     label: "Follow 3 makers", blurb: "Curate your feed" },
    { key: "first_engagement", label: "Save 1 item", blurb: "Build a wishlist" },
    { key: "profile_created",  label: "Add a profile photo", blurb: "Optional but friendly" },
  ],
  supporter: [
    { key: "first_follow",     label: "Follow 3 makers", blurb: "Discover voices" },
    { key: "first_engagement", label: "Comment on a post", blurb: "Say hello" },
    { key: "profile_created",  label: "Add a profile photo", blurb: "Optional but friendly" },
  ],
};

const TOUR_STOPS = [
  { title: "This is your feed",      blurb: "Discover new creations from makers you follow." },
  { title: "This is your storefront",blurb: "Where your shop lives — products, designs, orders." },
  { title: "This is how you upload", blurb: "Add products, designs, and posts in a few clicks." },
  { title: "This is the community",  blurb: "Engage, connect, and share with other makers." },
  { title: "This is your dashboard", blurb: "Track sales, orders, and store performance." },
];

// Stable anonymous id so refreshes don't reset state pre-signin
function getAnonId() {
  let id = localStorage.getItem("cm_onboarding_anon_id");
  if (!id) {
    id = "anon_" + Math.random().toString(36).slice(2, 12);
    localStorage.setItem("cm_onboarding_anon_id", id);
  }
  return id;
}

export default function Welcome() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [path, setPath] = useState(null);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  useStructuredData({
    title: "Welcome to Crafters Market",
    description: "A marketplace where makers don’t get buried. Choose your path and start in under 2 minutes.",
    url: "https://craftersmarket.org/welcome",
  });

  // Load existing state on mount — if user already finished onboarding,
  // bounce them to the right dashboard.
  useEffect(() => {
    const anon = getAnonId();
    http.get(`/onboarding/me?anon_id=${anon}`)
      .then((r) => {
        const s = r.data?.state;
        if (s) {
          setState(s);
          if (s.user_type) setPath(s.user_type);
          if (s.completed_at) {
            // already done — let them re-enter at the tour
            setStep(5);
          } else if (s.user_type) {
            setStep(3);
          }
        }
      })
      .catch(() => { /* silent — anonymous is fine */ });
  }, []);

  const markStep = async (stepKey) => {
    try {
      const anon = getAnonId();
      const { data } = await http.post("/onboarding/step", { step: stepKey, anon_id: anon });
      setState(data);
    } catch (e) { /* silent — UI continues regardless */ }
  };

  const choosePath = async (id) => {
    setPath(id);
    setBusy(true);
    try {
      const anon = getAnonId();
      const { data } = await http.post("/onboarding/start", { user_type: id, anon_id: anon });
      setState(data);
    } catch (e) { /* ignore */ }
    setBusy(false);
    setStep(3);
  };

  const skip = async () => {
    try { await http.post("/onboarding/skip", {}); } catch (e) { /* ignore */ }
    localStorage.setItem("cm_onboarding_skipped", "1");
    navigate("/");
  };

  const finish = async () => {
    await markStep("tour_completed");
    const dest = path === "maker" ? "/maker/dashboard"
              : path === "buyer" ? "/shop"
              : "/community";
    navigate(dest);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] pt-40 md:pt-36 pb-20 px-4 md:px-8 relative">
      {/* Top progress + skip */}
      <div className="max-w-3xl mx-auto mb-8 flex items-center justify-between">
        <ProgressDots active={step} total={5} />
        <button
          type="button"
          onClick={skip}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] hover:text-[#ff4500] inline-flex items-center gap-1.5"
          data-testid="welcome-skip"
        >
          Just browsing <X size={11} />
        </button>
      </div>

      <div className="max-w-3xl mx-auto">
        <AnimatePresence mode="wait">
          {step === 1 && <Step1Welcome key="s1" onNext={() => setStep(2)} />}
          {step === 2 && (
            <Step2Path
              key="s2"
              onPick={choosePath}
              onBack={() => setStep(1)}
              busy={busy}
            />
          )}
          {step === 3 && <Step3Values key="s3" onNext={() => setStep(4)} onBack={() => setStep(2)} />}
          {step === 4 && (
            <Step4FirstAction
              key="s4"
              path={path}
              completed={state?.steps_completed || []}
              onMark={markStep}
              onNext={() => setStep(5)}
              onBack={() => setStep(3)}
            />
          )}
          {step === 5 && <Step5Tour key="s5" onFinish={finish} onBack={() => setStep(4)} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ProgressDots({ active, total }) {
  return (
    <div className="flex items-center gap-2" data-testid="welcome-progress">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-1 transition-all ${
            i + 1 === active
              ? "w-8 bg-[#ff4500]"
              : i + 1 < active
                ? "w-4 bg-[#ff4500]/40"
                : "w-4 bg-[#262626]"
          }`}
        />
      ))}
    </div>
  );
}

const motionProps = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -8 },
  transition: { duration: 0.45, ease: [0.22, 0.61, 0.36, 1] },
};

// ─────────────────────────────────────────────────────────────────────────────
function Step1Welcome({ onNext }) {
  return (
    <motion.div {...motionProps} data-testid="welcome-step-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#00ffff] mb-3">
        ◆ Step 1 · Welcome
      </div>
      <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[0.95] mb-6">
        A marketplace where<br />
        <span className="text-[#ff4500]">makers don’t get buried.</span>
      </h1>
      <p className="font-mono text-sm text-[#a3a3a3] leading-relaxed mb-10 max-w-xl">
        Discover handmade work, share your creations, and build your audience
        without algorithm chaos.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-2 px-5 py-3 bg-[#ff4500] hover:bg-[#ff6a2a] text-black font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
          data-testid="welcome-step1-continue"
        >
          Get started <ArrowRight size={14} />
        </button>
      </div>
    </motion.div>
  );
}

function Step2Path({ onPick, onBack, busy }) {
  return (
    <motion.div {...motionProps} data-testid="welcome-step-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#00ffff] mb-3">
        ◆ Step 2 · Personalize the experience
      </div>
      <h2 className="font-display text-3xl sm:text-4xl mb-3">
        What brings you to Crafters Market?
      </h2>
      <p className="font-mono text-xs text-[#a3a3a3] mb-8">
        We’ll personalize your next step. You can change paths anytime.
      </p>
      <div className="grid sm:grid-cols-3 gap-4">
        {PATHS.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => onPick(p.id)}
              className="text-left p-5 border border-[#262626] hover:border-[#ff4500] bg-[#0d0d0d] hover:bg-[#0d0d0d]/80 disabled:opacity-40 transition group"
              data-testid={`welcome-path-${p.id}`}
            >
              <Icon size={20} className="text-[#ff4500] mb-4 group-hover:scale-110 transition-transform" />
              <div className="font-display text-lg mb-2 leading-tight">{p.label}</div>
              <p className="font-mono text-[11px] text-[#a3a3a3] leading-relaxed">{p.blurb}</p>
            </button>
          );
        })}
      </div>
      <div className="mt-8">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] hover:text-[#a3a3a3]"
          data-testid="welcome-step2-back"
        >
          <ArrowLeft size={11} /> Back
        </button>
      </div>
    </motion.div>
  );
}

function Step3Values({ onNext, onBack }) {
  return (
    <motion.div {...motionProps} data-testid="welcome-step-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#00ffff] mb-3">
        ◆ Step 3 · Show the core value
      </div>
      <h2 className="font-display text-3xl sm:text-4xl mb-8">
        Built for makers.<br />
        <span className="text-[#ff4500]">Loved by creators.</span>
      </h2>
      <div className="space-y-4">
        {VALUES.map((v, i) => {
          const Icon = v.icon;
          return (
            <div
              key={i}
              className="flex items-start gap-4 p-5 border border-[#262626] bg-[#0d0d0d]"
              data-testid={`welcome-value-${i}`}
            >
              <Icon size={22} className="text-[#ff4500] flex-shrink-0 mt-1" />
              <div>
                <div className="font-display text-lg mb-1">{v.title}</div>
                <p className="font-mono text-[11px] text-[#a3a3a3] leading-relaxed">{v.blurb}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] hover:text-[#a3a3a3]"
          data-testid="welcome-step3-back"
        >
          <ArrowLeft size={11} /> Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-2 px-5 py-3 bg-[#ff4500] hover:bg-[#ff6a2a] text-black font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
          data-testid="welcome-step3-continue"
        >
          Continue <ArrowRight size={14} />
        </button>
      </div>
    </motion.div>
  );
}

function Step4FirstAction({ path, completed, onMark, onNext, onBack }) {
  const items = FIRST_ACTIONS[path] || FIRST_ACTIONS.maker;
  const isDone = (k) => completed.includes(k);
  const allDone = items.every((it) => isDone(it.key));

  // Each action button takes the user to the right place to actually
  // do the thing — we mark the step optimistically + then route.
  const navigate = useNavigate();
  const handleAction = async (item) => {
    await onMark(item.key);
    // Open the destination in a new tab so the user can come back to
    // continue the onboarding. Light-touch nudge, not forced redirect.
    const destMap = {
      profile_created:   path === "maker" ? "/maker/dashboard" : "/community/me",
      first_upload:      "/maker/dashboard?upload=1",
      first_follow:      "/makers",
      first_engagement:  "/community",
    };
    const dest = destMap[item.key] || "/";
    window.open(dest, "_blank", "noopener,noreferrer");
  };

  return (
    <motion.div {...motionProps} data-testid="welcome-step-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#00ffff] mb-3">
        ◆ Step 4 · First action ({path || "maker"})
      </div>
      <h2 className="font-display text-3xl sm:text-4xl mb-3">
        Let’s get you set up.
      </h2>
      <p className="font-mono text-xs text-[#a3a3a3] mb-8">
        Complete these quick steps to make your profile come alive — under 5 minutes.
      </p>

      {/* iter250 — Stripe payouts nudge. Only renders for makers who are
          actually signed in (so we have a JWT to call /maker/stripe/connect/status)
          AND who haven't already finished onboarding. Pure call-out — never
          blocks the flow. */}
      {path === "maker" && <MakerPayoutsPrompt />}

      <ol className="space-y-3">
        {items.map((it, i) => {
          const done = isDone(it.key);
          return (
            <li key={it.key}>
              <button
                type="button"
                onClick={() => handleAction(it)}
                className={`w-full text-left flex items-center gap-4 p-4 border ${
                  done ? "border-emerald-500/60 bg-emerald-500/[0.04]" : "border-[#262626] hover:border-[#ff4500]"
                } transition group`}
                data-testid={`welcome-action-${it.key}`}
              >
                <span className={`flex-shrink-0 h-8 w-8 border-2 ${
                  done ? "border-emerald-500 bg-emerald-500/10 text-emerald-400" : "border-[#262626] text-[#525252]"
                } flex items-center justify-center font-mono text-xs`}>
                  {done ? <Check size={14} /> : i + 1}
                </span>
                <div className="flex-1">
                  <div className="font-display text-base leading-tight">{it.label}</div>
                  <p className="font-mono text-[10px] text-[#a3a3a3] mt-0.5">{it.blurb}</p>
                </div>
                <ArrowRight size={14} className="text-[#525252] group-hover:text-[#ff4500] flex-shrink-0" />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] hover:text-[#a3a3a3]"
          data-testid="welcome-step4-back"
        >
          <ArrowLeft size={11} /> Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-2 px-5 py-3 bg-[#ff4500] hover:bg-[#ff6a2a] text-black font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
          data-testid="welcome-step4-continue"
        >
          {allDone ? "Take the tour" : "Skip ahead to tour"} <ArrowRight size={14} />
        </button>
      </div>
    </motion.div>
  );
}

function Step5Tour({ onFinish, onBack }) {
  const [idx, setIdx] = useState(0);
  const stop = TOUR_STOPS[idx];
  const last = idx === TOUR_STOPS.length - 1;
  return (
    <motion.div {...motionProps} data-testid="welcome-step-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#00ffff] mb-3">
        ◆ Step 5 · Quick tour
      </div>
      <h2 className="font-display text-3xl sm:text-4xl mb-6">
        Let’s take a quick tour.
      </h2>

      <div className="p-6 border border-[#00ffff]/40 bg-[#00ffff]/[0.03]" data-testid={`welcome-tour-${idx}`}>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#00ffff] mb-2">
          {idx + 1} / {TOUR_STOPS.length}
        </div>
        <div className="font-display text-2xl mb-2">{stop.title}</div>
        <p className="font-mono text-[12px] text-[#a3a3a3] leading-relaxed">{stop.blurb}</p>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={idx === 0 ? onBack : () => setIdx(idx - 1)}
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] hover:text-[#a3a3a3]"
          data-testid="welcome-tour-prev"
        >
          <ArrowLeft size={11} /> Back
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onFinish}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] hover:text-[#a3a3a3]"
            data-testid="welcome-tour-skip"
          >
            Skip tour
          </button>
          <button
            type="button"
            onClick={last ? onFinish : () => setIdx(idx + 1)}
            className="inline-flex items-center gap-2 px-5 py-3 bg-[#ff4500] hover:bg-[#ff6a2a] text-black font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
            data-testid="welcome-tour-next"
          >
            {last ? (<><Sparkles size={14}/> You’re all set</>) : "Next"} {!last && <ArrowRight size={14} />}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// iter250 — Friendly Stripe Payouts prompt rendered inside Step 4 when the
// user picked "maker". Calls /api/maker/stripe/connect/status to determine
// whether to show. Three states:
//   • not signed in as a maker yet     → soft prompt linking to /maker/login
//   • signed in, no Stripe account     → "Connect Stripe (2 min)" CTA
//   • signed in, payouts not enabled   → "Finish Stripe verification" CTA
//   • payouts enabled                  → green confirmation, no CTA
function MakerPayoutsPrompt() {
  const [state, setState] = useState({ loading: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const jwt = localStorage.getItem("cm_maker_jwt");
    if (!jwt) {
      setState({ loading: false, kind: "anon" });
      return;
    }
    http.get("/maker/stripe/connect/status")
      .then((r) => {
        const d = r.data || {};
        let kind = "needs-connect";
        if (d.payouts_enabled && d.details_submitted) kind = "ready";
        else if (d.connected) kind = "needs-finish";
        setState({ loading: false, kind, ...d });
      })
      .catch(() => setState({ loading: false, kind: "needs-connect" }));
  }, []);

  if (state.loading) return null;

  // Generate the Stripe Connect onboarding link in-place.
  const startStripe = async () => {
    setBusy(true);
    try {
      const r = await http.post("/maker/stripe/connect/onboard", {
        origin_url: window.location.origin,
      });
      if (r.data?.onboarding_url) {
        window.location.href = r.data.onboarding_url;
      }
    } catch (e) {
      // fall through — user can retry from the maker dashboard
      setBusy(false);
    }
  };

  if (state.kind === "ready") {
    return (
      <div
        className="mb-6 p-4 border border-emerald-500/60 bg-emerald-500/5 flex items-center gap-3"
        data-testid="welcome-stripe-prompt"
      >
        <CreditCard size={18} className="text-emerald-400 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-display text-base">Payouts ready ✓</div>
          <p className="font-mono text-[11px] text-[#a3a3a3] mt-0.5">
            Your Stripe account is verified. Sales will pay out automatically.
          </p>
        </div>
      </div>
    );
  }

  if (state.kind === "anon") {
    return (
      <a
        href="/maker/login"
        className="mb-6 block p-4 border border-[#ff4500]/60 bg-[#ff4500]/5 hover:bg-[#ff4500]/10 transition group"
        data-testid="welcome-stripe-prompt"
      >
        <div className="flex items-center gap-3">
          <CreditCard size={18} className="text-[#ff4500] flex-shrink-0" />
          <div className="flex-1">
            <div className="font-display text-base">Get paid for your work.</div>
            <p className="font-mono text-[11px] text-[#a3a3a3] mt-0.5">
              Sign in as a maker and connect Stripe in 2 minutes —
              the moment you make a sale, the money lands in your bank.
            </p>
          </div>
          <ArrowRight size={14} className="text-[#ff4500] group-hover:translate-x-1 transition-transform" />
        </div>
      </a>
    );
  }

  const isFinish = state.kind === "needs-finish";
  return (
    <button
      type="button"
      onClick={startStripe}
      disabled={busy}
      className="mb-6 w-full text-left p-4 border border-[#ff4500]/60 bg-[#ff4500]/5 hover:bg-[#ff4500]/10 disabled:opacity-50 transition group"
      data-testid="welcome-stripe-prompt"
    >
      <div className="flex items-center gap-3">
        <CreditCard size={18} className="text-[#ff4500] flex-shrink-0" />
        <div className="flex-1">
          <div className="font-display text-base">
            {isFinish ? "Finish your Stripe verification" : "Connect Stripe — get paid in 2 min"}
          </div>
          <p className="font-mono text-[11px] text-[#a3a3a3] mt-0.5">
            {isFinish
              ? "You started Stripe onboarding but a couple steps are still open. We'll bounce you back the second it's done."
              : "We use Stripe Express so you can accept cards anywhere in the US and get weekly payouts to your bank automatically."}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#ff4500] group-hover:bg-[#ff6a2a] text-black font-mono text-[10px] uppercase tracking-[0.22em] font-bold">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} />}
          {isFinish ? "Resume" : "Connect"}
        </span>
      </div>
    </button>
  );
}

