/**
 * iter428 — /app-testing landing page.
 * Full spec matching the user's brief: hero + mockups + why-join cards
 * + device split + roadmap + feedback flow + FAQ + live community stats
 * + bottom CTA. Signup posts to /api/beta-program/signup.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Rocket, MessageSquare, Heart, Award, Smartphone, Check, Square,
  ChevronDown, ArrowRight,
} from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;

const PHONE_HERO = {
  home:  "https://customer-assets.emergentagent.com/job_active-project-4/artifacts/mafn7t29_103d8c61-b252-4525-8529-2423dacd4253.png",
};

const ROADMAP = [
  { done: true,  label: "Shopping" },
  { done: true,  label: "Search" },
  { done: true,  label: "Messaging" },
  { done: true,  label: "Seller Dashboard" },
  { done: false, label: "Wishlist" },
  { done: false, label: "Push Notifications" },
  { done: false, label: "In-App Chat" },
  { done: false, label: "Live Auctions (Future)" },
];

const FAQ = [
  { q: "How long does testing last?", a: "As long as you'd like. Stay a week, stay a year — you control when you leave." },
  { q: "Do I need to be a seller?",   a: "No. Buyers and makers are both welcome." },
  { q: "Does it cost anything?",      a: "No. The beta app is free to join and free to use." },
  { q: "Can I leave anytime?",        a: "Yes — leave the Play Store beta program or the TestFlight group at any time." },
];

function Card({ icon: Icon, title, children, testid }) {
  return (
    <div className="border border-line bg-paper p-6 min-w-0" data-testid={testid}>
      <div className="w-10 h-10 border border-brand text-brand flex items-center justify-center mb-3">
        <Icon size={18} aria-hidden />
      </div>
      <h3 className="font-display text-xl mb-2 text-ink">{title}</h3>
      <p className="text-ink-muted text-sm">{children}</p>
    </div>
  );
}

function StatTile({ label, value, testid }) {
  return (
    <div className="border border-line px-4 py-3 min-w-0" data-testid={testid}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted truncate">{label}</div>
      <div className="font-display text-2xl mt-1 tabular-nums text-ink">{value}</div>
    </div>
  );
}

function SignupModal({ open, onClose, defaultDevice }) {
  const [name, setName]     = useState("");
  const [email, setEmail]   = useState("");
  const [state, setState]   = useState("");
  const [device, setDevice] = useState(defaultDevice || "android");
  const [busy, setBusy]     = useState(false);
  useEffect(() => { if (defaultDevice) setDevice(defaultDevice); }, [defaultDevice]);
  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error("Please enter your name and email.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/beta-program/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), state: state.trim(), device }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      // Look up the join URL from the freshly-loaded config
      const cfg = await fetch(`${API}/api/beta-program/config`).then((r) => r.json());
      const url = device === "ios" ? cfg.ios_url : cfg.android_url;
      toast.success(d.duplicate ? "You're already on the list — opening join page." : "You're in! Opening the join page…");
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      onClose();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center px-4"
         onClick={(e) => e.target === e.currentTarget && onClose()}
         data-testid="beta-signup-modal">
      <form onSubmit={submit} className="max-w-md w-full bg-paper border border-line p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">
          ◆ Join the beta
        </div>
        <h3 className="font-display text-2xl mb-4 text-ink">Sign up to test the app</h3>
        <label className="block mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80}
                 className="mt-1 w-full border border-line bg-paper px-3 py-2 font-mono text-sm focus:outline-none focus:border-brand"
                 data-testid="beta-signup-name" />
        </label>
        <label className="block mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                 className="mt-1 w-full border border-line bg-paper px-3 py-2 font-mono text-sm focus:outline-none focus:border-brand"
                 data-testid="beta-signup-email" />
        </label>
        <label className="block mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">State (optional — shows on live-testers feed)</span>
          <input value={state} onChange={(e) => setState(e.target.value)} maxLength={40}
                 className="mt-1 w-full border border-line bg-paper px-3 py-2 font-mono text-sm focus:outline-none focus:border-brand"
                 placeholder="e.g. Washington"
                 data-testid="beta-signup-state" />
        </label>
        <div className="mb-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted block mb-1">Device</span>
          <div className="flex gap-2">
            {["android", "ios", "both"].map(d => (
              <button type="button" key={d} onClick={() => setDevice(d)}
                      className={`flex-1 border px-3 py-2 font-mono text-xs uppercase tracking-[0.22em] transition
                        ${device === d ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-muted hover:border-ink-muted"}`}
                      data-testid={`beta-signup-device-${d}`}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose}
                  className="flex-1 border border-line px-4 py-2 font-mono text-xs uppercase tracking-[0.22em] hover:bg-surface-2"
                  data-testid="beta-signup-cancel">Cancel</button>
          <button type="submit" disabled={busy}
                  className="flex-1 bg-brand hover:bg-brand-hover text-ink font-mono text-xs uppercase tracking-[0.22em] px-4 py-2 disabled:opacity-40"
                  data-testid="beta-signup-submit">
            {busy ? "…" : "Sign up & open join page"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AppTestingPage() {
  const [config, setConfig] = useState(null);
  const [stats, setStats]   = useState(null);
  const [modal, setModal]   = useState(null); // null | "android" | "ios"
  const [openFaq, setOpenFaq] = useState(-1);

  useEffect(() => {
    fetch(`${API}/api/beta-program/config`).then(r => r.json()).then(setConfig).catch(() => {});
    fetch(`${API}/api/beta-program/stats`).then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const headline = config?.headline || "Help Build the Crafters Market App";

  return (
    <div className="min-h-screen bg-paper text-ink" data-testid="app-testing-page">
      {/* ─────────── Hero ─────────── */}
      <div className="max-w-6xl mx-auto px-6 pt-16 pb-10">
        <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-start">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-4">
              ◆ Beta · App Testing
            </div>
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl leading-tight mb-5">
              {headline}
            </h1>
            <p className="text-ink-muted text-lg mb-4 max-w-2xl">
              Become one of our first mobile testers and help shape the future of Crafters Market.
              Your feedback will directly influence new features before they&apos;re released to everyone.
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-6">
              Android · iPhone · Free to Join
            </p>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => setModal("android")}
                      className="bg-[#3ddc84] hover:opacity-90 text-[#0a0a0a] font-mono text-xs uppercase tracking-[0.22em] px-6 py-3"
                      data-testid="hero-join-android">
                Join Android Testing →
              </button>
              <button onClick={() => setModal("ios")}
                      className="bg-white hover:bg-neutral-100 text-[#0a0a0a] border border-line font-mono text-xs uppercase tracking-[0.22em] px-6 py-3"
                      data-testid="hero-join-ios">
                Join iPhone Testing →
              </button>
            </div>
          </div>

          {/* Phone mockups — side by side */}
          <div className="hidden lg:flex gap-4 items-end" aria-hidden="true">
            <div className="w-40 h-72 rounded-[26px] border-2 border-line bg-paper p-2 shadow-[0_10px_40px_rgba(0,0,0,0.15)]">
              <div className="w-full h-full border border-line overflow-hidden bg-[#0a0a0a] text-white p-2 flex flex-col gap-1">
                <div className="text-[8px] font-mono tracking-[0.2em] text-brand">HOME</div>
                <div className="text-[9px] font-display leading-tight">Featured makers</div>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  {[0,1,2,3].map(i => <div key={i} className="aspect-square bg-neutral-800 border border-neutral-700" />)}
                </div>
              </div>
            </div>
            <div className="w-40 h-80 rounded-[26px] border-2 border-line bg-paper p-2 shadow-[0_10px_40px_rgba(0,0,0,0.15)]">
              <div className="w-full h-full border border-line overflow-hidden bg-white text-ink p-2 flex flex-col gap-1">
                <div className="text-[8px] font-mono tracking-[0.2em] text-brand">SHOP</div>
                <div className="aspect-square bg-neutral-200 border border-line" />
                <div className="text-[9px] font-display leading-tight mt-1">Iron & Oak · $148</div>
                <div className="text-[8px] font-mono text-ink-muted">Hand-forged</div>
                <div className="bg-brand text-paper text-[8px] text-center font-mono py-1 mt-auto">Add to cart</div>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-8 font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted">
          Built by makers. Tested by makers.
        </div>
      </div>

      {/* ─────────── Why Join ─────────── */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2">◆ Why Join</div>
        <h2 className="font-display text-3xl md:text-4xl mb-8">Real makers. Real feedback loops.</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card icon={Rocket}       title="Early Access"       testid="why-early">
            Get new features weeks before public release.
          </Card>
          <Card icon={MessageSquare} title="Your Feedback Matters" testid="why-feedback">
            Report bugs, suggest improvements, and vote on upcoming features.
          </Card>
          <Card icon={Heart}         title="Help Independent Makers" testid="why-makers">
            Every improvement helps thousands of small businesses sell more.
          </Card>
          <Card icon={Award}         title="Early Tester Badge" testid="why-badge">
            Receive a permanent Early App Tester badge on your Crafters Market profile.
          </Card>
        </div>
      </section>

      {/* ─────────── Choose your device ─────────── */}
      <section className="max-w-6xl mx-auto px-6 py-12" data-testid="device-split">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2">◆ Choose your device</div>
        <h2 className="font-display text-3xl md:text-4xl mb-8">Two ways to help.</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="border border-line p-6 bg-paper">
            <div className="flex items-center gap-2 mb-3">
              <Smartphone size={18} className="text-[#3ddc84]" aria-hidden />
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">Android</div>
            </div>
            <h3 className="font-display text-2xl mb-4 text-ink">Google Play Testing</h3>
            <ul className="space-y-2 mb-6">
              {["Automatic updates", "Easy feedback", "Install from Google Play"].map(t => (
                <li key={t} className="flex items-center gap-2 text-ink-muted text-sm">
                  <Check size={14} className="text-[#3ddc84]" aria-hidden /> {t}
                </li>
              ))}
            </ul>
            <button onClick={() => setModal("android")}
                    className="w-full bg-[#3ddc84] hover:opacity-90 text-[#0a0a0a] font-mono text-xs uppercase tracking-[0.22em] py-3"
                    data-testid="device-join-android">
              Join Android Testing →
            </button>
          </div>
          <div className="border border-line p-6 bg-paper">
            <div className="flex items-center gap-2 mb-3">
              <Smartphone size={18} className="text-ink" aria-hidden />
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">iPhone / iPad</div>
            </div>
            <h3 className="font-display text-2xl mb-4 text-ink">Apple TestFlight</h3>
            <ul className="space-y-2 mb-6">
              {["Install through TestFlight", "Receive beta updates", "Report issues easily"].map(t => (
                <li key={t} className="flex items-center gap-2 text-ink-muted text-sm">
                  <Check size={14} className="text-ink" aria-hidden /> {t}
                </li>
              ))}
            </ul>
            <button onClick={() => setModal("ios")}
                    className="w-full bg-white hover:bg-neutral-100 text-[#0a0a0a] border border-line font-mono text-xs uppercase tracking-[0.22em] py-3"
                    data-testid="device-join-ios">
              Join iOS Testing →
            </button>
          </div>
        </div>
      </section>

      {/* ─────────── Roadmap ─────────── */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2">◆ Roadmap</div>
        <h2 className="font-display text-3xl md:text-4xl mb-8">What you&apos;ll help test</h2>
        <ul className="grid sm:grid-cols-2 gap-3" data-testid="roadmap-list">
          {ROADMAP.map(r => (
            <li key={r.label} className="flex items-center gap-3 border border-line px-4 py-3">
              {r.done ? (
                <span className="w-5 h-5 rounded-sm bg-emerald-500 flex items-center justify-center flex-shrink-0" aria-hidden>
                  <Check size={12} className="text-white" />
                </span>
              ) : (
                <span className="w-5 h-5 rounded-sm border border-line flex items-center justify-center flex-shrink-0" aria-hidden>
                  <Square size={10} className="text-ink-muted" />
                </span>
              )}
              <span className={r.done ? "text-ink" : "text-ink-muted"}>{r.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ─────────── Feedback flow ─────────── */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2">◆ Feedback</div>
        <h2 className="font-display text-3xl md:text-4xl mb-4">&ldquo;We actually read every piece of feedback.&rdquo;</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {[
            "1. Install the app",
            "2. Use it normally",
            "3. Shake phone or tap Feedback",
            "4. Tell us what happened",
          ].map((s, i) => (
            <div key={i} className="border border-line p-4 min-w-0">
              <div className="font-display text-xl text-brand mb-1">{s.slice(0, 2)}</div>
              <div className="text-ink-muted text-sm">{s.slice(3)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────── Live community stats ─────────── */}
      <section className="max-w-6xl mx-auto px-6 py-12 bg-surface-2 border-y border-line" data-testid="community-stats">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2">◆ Community · Live</div>
        <h2 className="font-display text-3xl md:text-4xl mb-6">You&apos;re not just downloading — you&apos;re building.</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <StatTile label="Android testers" value={stats?.android_count ?? "—"} testid="stat-android" />
          <StatTile label="iPhone testers"  value={stats?.ios_count ?? "—"}     testid="stat-ios" />
          <StatTile label="Bugs fixed"      value={stats?.bugs_fixed ?? "—"}    testid="stat-bugs" />
          <StatTile label="Feature requests" value={stats?.features_requested ?? "—"} testid="stat-fr" />
          <StatTile label="Features released" value={stats?.features_released ?? "—"} testid="stat-fx" />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">Latest joined</div>
          <ul className="space-y-1" data-testid="latest-joined">
            {(stats?.latest_joined || []).length === 0 && (
              <li className="text-ink-muted text-sm">Be the first — sign up above.</li>
            )}
            {(stats?.latest_joined || []).map((j, i) => (
              <li key={i} className="text-ink text-sm flex items-center gap-2">
                <Check size={14} className="text-emerald-500" aria-hidden />
                <span className="font-mono">{j.first_name} · {j.state}</span>
                <span className="text-ink-muted text-[10px] uppercase tracking-[0.18em] ml-1">{j.device}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─────────── FAQ ─────────── */}
      <section className="max-w-3xl mx-auto px-6 py-12">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2">◆ FAQ</div>
        <h2 className="font-display text-3xl md:text-4xl mb-6">Questions</h2>
        <ul className="border border-line divide-y divide-line" data-testid="faq-list">
          {FAQ.map((f, i) => (
            <li key={i}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                className="w-full flex items-center justify-between p-4 hover:bg-surface-2 transition text-left"
                data-testid={`faq-q-${i}`}
              >
                <span className="font-display text-lg">{f.q}</span>
                <ChevronDown
                  size={16}
                  className={`transition-transform ${openFaq === i ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
              {openFaq === i && (
                <div className="px-4 pb-4 text-ink-muted text-sm" data-testid={`faq-a-${i}`}>
                  {f.a}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ─────────── Bottom CTA ─────────── */}
      <section className="max-w-6xl mx-auto px-6 py-16 text-center">
        <h2 className="font-display text-3xl md:text-5xl mb-3">
          Ready to help build the future of handmade commerce?
        </h2>
        <p className="text-ink-muted mb-6">Two taps to join. Two devices to help.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button onClick={() => setModal("android")}
                  className="bg-[#3ddc84] hover:opacity-90 text-[#0a0a0a] font-mono text-xs uppercase tracking-[0.22em] px-6 py-3 inline-flex items-center gap-1"
                  data-testid="cta-join-android">
            Join Android <ArrowRight size={14} />
          </button>
          <button onClick={() => setModal("ios")}
                  className="bg-white hover:bg-neutral-100 text-[#0a0a0a] border border-line font-mono text-xs uppercase tracking-[0.22em] px-6 py-3 inline-flex items-center gap-1"
                  data-testid="cta-join-ios">
            Join iPhone <ArrowRight size={14} />
          </button>
        </div>
      </section>

      <SignupModal open={!!modal} onClose={() => setModal(null)} defaultDevice={modal} />
    </div>
  );
}
