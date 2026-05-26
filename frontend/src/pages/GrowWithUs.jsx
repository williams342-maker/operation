/**
 * Grow With Us · /grow
 *
 * iter232 — Cinematic manifesto / landing / community-invitation page.
 * Built from the design_guidelines.json blueprint produced by the
 * design agent. Single-file page with locally-scoped sub-components
 * because the sections only ever appear here.
 *
 * Visual language matches the existing dark cinematic homepage
 * (#0a0a0a bg, #ff4500 orange ◆ labels, font-display headlines)
 * but adds neon-cyan + electric-blue accents per user's spec.
 */
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useInView, useScroll, useTransform, animate } from "framer-motion";
import http from "../lib/api";

// ─────────────────────────────────────────────────────────────────────
// Animated count-up — fires once when the element scrolls into view.
// Avoids the cliché "1 + + + ..." flickering by using Framer's `animate`.
// ─────────────────────────────────────────────────────────────────────
function CountUp({ to = 0, suffix = "", duration = 1.8 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, to, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, to, duration]);
  return (
    <span ref={ref}>
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}

// Subtle blueprint grid overlay used across multiple sections.
function GridOverlay({ opacity = 0.05 }) {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
        opacity,
        maskImage: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
        WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
      }}
    />
  );
}

// Repeating section label (◆ TAG · STYLE).
function SectionTag({ children, accent = "orange" }) {
  const colorMap = {
    orange: "text-[#ff4500]",
    cyan: "text-[#00ffff]",
    amber: "text-[#ffb000]",
  };
  return (
    <div className={`font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.32em] ${colorMap[accent]} mb-4`}>
      ◆ {children}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 1 · HERO
// ═════════════════════════════════════════════════════════════════════
function Hero() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  // Slow parallax on the floating panels
  const y1 = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const y3 = useTransform(scrollYProgress, [0, 1], [0, -40]);

  return (
    <section ref={ref} className="relative min-h-[100vh] flex items-center overflow-hidden bg-[#0a0a0a] pt-24 pb-32" data-testid="grow-hero">
      {/* Backdrop gradient + grid */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a] via-[#0a0a0a] to-[#0e0e0e]" />
      <GridOverlay opacity={0.06} />
      {/* Ambient color blooms */}
      <div className="absolute top-[20%] -left-32 w-[500px] h-[500px] rounded-full bg-[#ff4500] opacity-[0.18] blur-[120px]" />
      <div className="absolute bottom-[10%] -right-32 w-[600px] h-[600px] rounded-full bg-[#00ffff] opacity-[0.12] blur-[140px]" />

      <div className="relative max-w-7xl mx-auto px-6 lg:px-12 w-full">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-center">
          {/* Copy block */}
          <div className="lg:col-span-7">
            <SectionTag>Grow With Us</SectionTag>
            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="font-display font-bold text-white text-4xl sm:text-5xl lg:text-6xl xl:text-7xl tracking-tight leading-[1.05]"
              data-testid="grow-hero-headline"
            >
              The Next Generation<br />
              <span className="bg-gradient-to-r from-[#ff4500] via-[#ffb000] to-[#00ffff] bg-clip-text text-transparent">
                Marketplace
              </span>
              <br />for Independent Creators
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8 max-w-[58ch] text-[#a3a3a3] text-base sm:text-lg leading-relaxed"
            >
              Crafters Market is building a creator-first ecosystem for CNC makers, artisans, designers, and modern handmade brands — combining commerce, community, and AI-powered growth tools into one platform.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="mt-10 flex flex-wrap items-center gap-4"
            >
              <Link
                to="/maker/apply"
                className="group inline-flex items-center gap-3 px-7 py-4 bg-[#ff4500] hover:bg-[#ff5a1a] text-black font-mono text-xs uppercase tracking-[0.22em] font-semibold transition shadow-[0_0_30px_rgba(255,69,0,0.35)] hover:shadow-[0_0_40px_rgba(255,69,0,0.55)]"
                data-testid="grow-hero-primary-cta"
              >
                Join as a Founding Seller
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </Link>
              <a
                href="#roadmap"
                className="inline-flex items-center gap-3 px-7 py-4 border border-[#262626] hover:border-[#00ffff] text-white font-mono text-xs uppercase tracking-[0.22em] transition hover:text-[#00ffff]"
                data-testid="grow-hero-secondary-cta"
              >
                View Roadmap
              </a>
            </motion.div>
          </div>

          {/* Floating dashboard panels — layered */}
          <div className="lg:col-span-5 relative h-[400px] lg:h-[520px] hidden md:block">
            <motion.div
              style={{ y: y1 }}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 1, delay: 0.4 }}
              className="absolute top-0 right-0 w-[280px] backdrop-blur-xl bg-[#141414]/70 border border-[#262626] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-[#00ffff] mb-2">◆ Seller Analytics</div>
              <div className="font-display text-3xl text-white">$8,420</div>
              <div className="font-mono text-[10px] text-[#a3a3a3] mt-1">Revenue · last 30d</div>
              <div className="flex items-end gap-1 mt-4 h-12">
                {[40, 55, 35, 70, 60, 85, 75, 90].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-[#ff4500]/40 to-[#ff4500]"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </motion.div>

            <motion.div
              style={{ y: y2 }}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 1, delay: 0.55 }}
              className="absolute top-[40%] left-0 w-[260px] backdrop-blur-xl bg-[#141414]/70 border border-[#262626] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-[#ffb000] mb-2">◆ AI Suggestions</div>
              <div className="space-y-2">
                {["Rewrite listing copy", "Optimize 3 SEO tags", "Pinterest schedule ready"].map((s) => (
                  <div key={s} className="flex items-center gap-2 font-mono text-[11px] text-[#e5e5e5]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00ffff]" />
                    {s}
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              style={{ y: y3 }}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 1, delay: 0.7 }}
              className="absolute bottom-0 right-8 w-[240px] backdrop-blur-xl bg-[#141414]/70 border border-[#262626] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-[#ff4500] mb-2">◆ Community</div>
              <div className="font-display text-2xl text-white">+12 makers</div>
              <div className="font-mono text-[10px] text-[#a3a3a3] mt-1">joined this week</div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 2 · PROBLEM (split-screen)
// ═════════════════════════════════════════════════════════════════════
function Problem() {
  return (
    <section className="relative bg-[#0a0a0a] py-24 lg:py-32 border-t border-[#1a1a1a]" data-testid="grow-problem">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="max-w-3xl">
          <SectionTag>The Problem</SectionTag>
          <h2 className="font-display font-bold text-white text-3xl sm:text-4xl lg:text-5xl tracking-tight leading-[1.1]">
            Makers Deserve Better Platforms
          </h2>
          <p className="mt-6 text-[#a3a3a3] text-base sm:text-lg max-w-[58ch] leading-relaxed">
            The existing marketplaces weren't designed for working makers. They were designed for buyers who don't know the difference between hand-fabricated and mass-produced — until they do.
          </p>
        </div>

        <div className="mt-16 grid md:grid-cols-2 gap-6 lg:gap-10">
          {/* LEFT: the broken status quo */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="border border-[#262626] bg-[#141414]/50 p-8 relative"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#737373] mb-6">◇ Status quo</div>
            <ul className="space-y-4 text-[#a3a3a3]">
              {[
                "Oversaturated marketplaces · 100 listings per niche",
                "Buried by mass-produced dropshipping",
                "Fees climb every quarter — same tools, less reach",
                "No community · just a buyer/seller transaction",
                "Generic discovery · algorithm-only, no curation",
                "No growth tools — you're on your own with marketing",
              ].map((s) => (
                <li key={s} className="flex items-start gap-3">
                  <span className="mt-2 w-1 h-1 bg-[#525252] flex-shrink-0" />
                  <span className="leading-relaxed">{s}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* RIGHT: what Crafters Market builds */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="border border-[#ff4500]/30 bg-gradient-to-br from-[#1a0d05] to-[#0a0a0a] p-8 relative shadow-[0_0_40px_rgba(255,69,0,0.08)]"
          >
            <div className="absolute -top-px -right-px w-24 h-px bg-gradient-to-r from-transparent to-[#ff4500]" />
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#ff4500] mb-6">◆ Crafters Market</div>
            <ul className="space-y-4 text-white/90">
              {[
                "Curated maker ecosystem · founding seller tiers",
                "Hand-fabricated only · zero dropshipping policy",
                "Transparent fees · founding members locked in",
                "Built-in forum + showcase · makers help makers",
                "Cinematic homepage rotation · everyone gets seen",
                "AI listing copy, SEO, social tools — included",
              ].map((s) => (
                <li key={s} className="flex items-start gap-3">
                  <span className="mt-2 w-1 h-1 bg-[#ff4500] flex-shrink-0" />
                  <span className="leading-relaxed">{s}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 3 · VISION (6-block bento)
// ═════════════════════════════════════════════════════════════════════
const VISION_BLOCKS = [
  { title: "Marketplace", body: "Curated, high-quality listings for buyers who care where it was made.", accent: "orange" },
  { title: "Community", body: "Forums, showcase wall, and clip feed — connect, collaborate, and grow with fellow makers.", accent: "cyan" },
  { title: "AI Tools", body: "Listing copy, SEO tags, social calendars — generated on tap, refined to your voice.", accent: "amber" },
  { title: "Education", body: "Built-in playbooks, machine-specific tutorials, and craftsmanship guides.", accent: "cyan" },
  { title: "Partnerships", body: "Direct deals with tool brands, material suppliers, and outdoor outfitters.", accent: "orange" },
  { title: "Exposure", body: "Founding-maker spotlight rotations and cinematic homepage placements.", accent: "amber" },
];

function Vision() {
  return (
    <section className="relative bg-[#0a0a0a] py-24 lg:py-32 border-t border-[#1a1a1a] overflow-hidden" data-testid="grow-vision">
      <GridOverlay opacity={0.04} />
      <div className="relative max-w-7xl mx-auto px-6 lg:px-12">
        <div className="max-w-3xl mb-16">
          <SectionTag accent="cyan">The Vision</SectionTag>
          <h2 className="font-display font-bold text-white text-3xl sm:text-4xl lg:text-5xl tracking-tight leading-[1.1]">
            A New Ecosystem for<br />Modern Makers
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {VISION_BLOCKS.map((b, i) => {
            const glowMap = {
              orange: "hover:border-[#ff4500]/40 hover:shadow-[0_0_30px_rgba(255,69,0,0.15)]",
              cyan: "hover:border-[#00ffff]/40 hover:shadow-[0_0_30px_rgba(0,255,255,0.15)]",
              amber: "hover:border-[#ffb000]/40 hover:shadow-[0_0_30px_rgba(255,176,0,0.15)]",
            };
            const dotMap = {
              orange: "bg-[#ff4500]",
              cyan: "bg-[#00ffff]",
              amber: "bg-[#ffb000]",
            };
            return (
              <motion.div
                key={b.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className={`group border border-[#262626] bg-gradient-to-br from-[#141414] to-[#0e0e0e] p-7 transition-all duration-300 ${glowMap[b.accent]} hover:-translate-y-0.5`}
                data-testid={`grow-vision-${b.title.toLowerCase()}`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className={`w-1.5 h-1.5 rounded-full ${dotMap[b.accent]}`} />
                  <h3 className="font-display text-xl text-white tracking-tight">{b.title}</h3>
                </div>
                <p className="text-[#a3a3a3] text-sm leading-relaxed">{b.body}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 4 · ROADMAP (horizontal timeline)
// ═════════════════════════════════════════════════════════════════════
const PHASES = [
  { name: "Phase 1 · Foundation", status: "DONE",
    items: ["Marketplace launch", "Seller onboarding", "Core listings", "Shipping + payment"] },
  { name: "Phase 2 · Creator Growth", status: "IN PROGRESS",
    items: ["AI product descriptions", "Smart SEO tools", "Social integrations", "Maker analytics"] },
  { name: "Phase 3 · Community Expansion", status: "UPCOMING",
    items: ["Creator profiles", "Following system", "Groups & forums", "Collaborations"] },
  { name: "Phase 4 · AI Commerce Platform", status: "FUTURE",
    items: ["AI storefront assistant", "Automated marketing", "Predictive recs", "Buyer matching"] },
];

function Roadmap() {
  const statusStyles = {
    DONE:        { tag: "text-emerald-400 border-emerald-700/60 bg-emerald-950/30", dot: "bg-emerald-400" },
    "IN PROGRESS": { tag: "text-[#00ffff] border-[#00ffff]/40 bg-[#00ffff]/10",      dot: "bg-[#00ffff] animate-pulse" },
    UPCOMING:    { tag: "text-[#ffb000] border-[#ffb000]/40 bg-[#ffb000]/10",       dot: "bg-[#ffb000]" },
    FUTURE:      { tag: "text-[#737373] border-[#262626] bg-[#141414]",             dot: "bg-[#525252]" },
  };
  return (
    <section id="roadmap" className="relative bg-[#0a0a0a] py-24 lg:py-32 border-t border-[#1a1a1a]" data-testid="grow-roadmap">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="max-w-3xl mb-16">
          <SectionTag accent="amber">Public Roadmap</SectionTag>
          <h2 className="font-display font-bold text-white text-3xl sm:text-4xl lg:text-5xl tracking-tight leading-[1.1]">
            What We're Building Next
          </h2>
          <p className="mt-6 text-[#a3a3a3] max-w-[58ch] leading-relaxed">
            Public, dated, honest. Founding sellers see new tools the day they ship.
          </p>
        </div>

        {/* Horizontal phases — stack on mobile, row on lg */}
        <div className="relative">
          {/* Connecting glow line (lg only) */}
          <div className="hidden lg:block absolute top-[42px] left-[5%] right-[5%] h-px bg-gradient-to-r from-emerald-500/50 via-[#00ffff]/50 via-[#ffb000]/30 to-[#262626]" />
          <div className="grid lg:grid-cols-4 gap-6">
            {PHASES.map((p, i) => {
              const s = statusStyles[p.status];
              return (
                <motion.div
                  key={p.name}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="relative"
                  data-testid={`grow-phase-${i + 1}`}
                >
                  <div className="relative h-[84px] flex items-center mb-5">
                    <div className={`w-4 h-4 rounded-full ${s.dot} relative z-10 ring-4 ring-[#0a0a0a]`} />
                    <span className={`ml-4 px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.22em] ${s.tag}`}>
                      {p.status}
                    </span>
                  </div>
                  <h3 className="font-display text-xl text-white mb-4 tracking-tight">{p.name}</h3>
                  <ul className="space-y-2">
                    {p.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 font-mono text-[12px] text-[#a3a3a3] leading-relaxed">
                        <span className="text-[#525252] mt-0.5">›</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 5 · WHO WE'RE LOOKING FOR
// ═════════════════════════════════════════════════════════════════════
const AUDIENCE = [
  { title: "Founding Sellers",
    body: "Early creators willing to ship feedback alongside their products. Lifetime founding status, lower lifetime fees, first access to every new tool.",
    cta: "Apply to sell", to: "/maker/apply", accent: "orange" },
  { title: "Strategic Partners",
    body: "Tool brands, material suppliers, machine makers, and educators with audiences that overlap with ours.",
    cta: "Partner with us", to: "mailto:partners@craftersmarket.org", accent: "cyan" },
  { title: "Investors & Advisors",
    body: "People who've seen the maker economy from inside — and believe the next decade belongs to creators with real tools.",
    cta: "Get in touch", to: "mailto:hello@craftersmarket.org", accent: "amber" },
  { title: "Community Builders",
    body: "Makers who teach, share, and help others level up. We're building features specifically for you.",
    cta: "Join the community", to: "/community", accent: "cyan" },
];

function Audience() {
  return (
    <section className="relative bg-[#0a0a0a] py-24 lg:py-32 border-t border-[#1a1a1a]" data-testid="grow-audience">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="max-w-3xl mb-16">
          <SectionTag>Who We're Looking For</SectionTag>
          <h2 className="font-display font-bold text-white text-3xl sm:text-4xl lg:text-5xl tracking-tight leading-[1.1]">
            Early matters.
          </h2>
          <p className="mt-6 text-[#a3a3a3] max-w-[58ch] leading-relaxed">
            The first 100 makers shape this platform's voice, its tools, its fee structure. If any of these sound like you, we want to talk.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          {AUDIENCE.map((a, i) => {
            const borderMap = {
              orange: "hover:border-[#ff4500]/50",
              cyan: "hover:border-[#00ffff]/50",
              amber: "hover:border-[#ffb000]/50",
            };
            const ctaMap = {
              orange: "text-[#ff4500] hover:text-[#ff5a1a]",
              cyan: "text-[#00ffff] hover:text-cyan-200",
              amber: "text-[#ffb000] hover:text-amber-300",
            };
            return (
              <motion.div
                key={a.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className={`border border-[#262626] bg-gradient-to-br from-[#141414] to-[#0e0e0e] p-8 transition-all duration-300 hover:-translate-y-0.5 ${borderMap[a.accent]}`}
                data-testid={`grow-audience-${a.title.toLowerCase().replace(/[^a-z]/g,'-')}`}
              >
                <h3 className="font-display text-2xl text-white tracking-tight mb-4">{a.title}</h3>
                <p className="text-[#a3a3a3] text-sm leading-relaxed mb-6">{a.body}</p>
                {a.to.startsWith("mailto:") ? (
                  <a href={a.to} className={`inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] ${ctaMap[a.accent]} transition`}>
                    {a.cta} <span>→</span>
                  </a>
                ) : (
                  <Link to={a.to} className={`inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] ${ctaMap[a.accent]} transition`}>
                    {a.cta} <span>→</span>
                  </Link>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 6 · TRACTION (live counters)
// ═════════════════════════════════════════════════════════════════════
function Traction() {
  const [data, setData] = useState(null);
  useEffect(() => {
    http.get("/grow/traction").then((r) => setData(r.data)).catch(() => {});
  }, []);

  const stats = data
    ? [
        { label: "Founding Makers",  value: data.founding_makers,    suffix: "" },
        { label: "Products Listed",  value: data.products_listed,    suffix: "" },
        { label: "Community Members", value: data.community_members, suffix: "" },
        { label: "Forum Threads",    value: data.forum_threads,      suffix: "" },
        { label: "Showcase Posts",   value: data.showcase_posts,     suffix: "" },
        { label: "Workshop Clips",   value: data.clips_published,    suffix: "" },
        { label: "Roadmap Progress", value: data.roadmap_pct,        suffix: "%" },
      ]
    : [];

  return (
    <section className="relative bg-[#0a0a0a] py-24 lg:py-32 border-t border-[#1a1a1a] overflow-hidden" data-testid="grow-traction">
      {/* Cyan bloom */}
      <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-[#00ffff] opacity-[0.06] blur-[120px]" />
      <div className="relative max-w-7xl mx-auto px-6 lg:px-12">
        <div className="max-w-3xl mb-16">
          <SectionTag accent="cyan">Momentum</SectionTag>
          <h2 className="font-display font-bold text-white text-3xl sm:text-4xl lg:text-5xl tracking-tight leading-[1.1]">
            Built in public.<br />Real numbers, live.
          </h2>
          <p className="mt-6 text-[#a3a3a3] max-w-[58ch] leading-relaxed">
            We refuse to inflate stats. Every number below is queried live from the platform — refreshed every minute. If you see "0" somewhere, it means we haven't shipped that yet.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.length === 0
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border border-[#262626] bg-[#141414] p-6 animate-pulse h-[120px]" />
              ))
            : stats.map((s, i) => (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="border border-[#262626] bg-gradient-to-br from-[#141414] to-[#0e0e0e] p-6 group hover:border-[#00ffff]/40 transition"
                  data-testid={`grow-stat-${s.label.toLowerCase().replace(/[^a-z]/g,'-')}`}
                >
                  <div className="font-display text-4xl sm:text-5xl bg-gradient-to-r from-white via-[#00ffff] to-white bg-clip-text text-transparent">
                    <CountUp to={s.value} suffix={s.suffix} />
                  </div>
                  <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[#a3a3a3]">{s.label}</div>
                </motion.div>
              ))
          }
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 7 · FOUNDER LETTER
// ═════════════════════════════════════════════════════════════════════
function FounderLetter() {
  return (
    <section className="relative bg-[#0a0a0a] py-24 lg:py-32 border-t border-[#1a1a1a]" data-testid="grow-founder">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-12 gap-12 items-start">
          {/* Founder image / silhouette card (no real photo on file yet — we
              render an industrial-mood card with the founder's name + title
              instead of a placeholder Unsplash bro). Swap to a real photo
              when we have one — drop the file at /public/founder.jpg and
              point the <img> src at it. */}
          <div className="lg:col-span-5">
            <div className="relative aspect-[4/5] border border-[#262626] bg-gradient-to-br from-[#1a0d05] via-[#141414] to-[#0a0a0a] overflow-hidden">
              <GridOverlay opacity={0.08} />
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                <div className="text-7xl font-display text-[#ff4500] mb-6">MW</div>
                <div className="font-display text-2xl text-white">Michael Williams</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#a3a3a3] mt-2">Founder · Crafters Market</div>
                <div className="mt-8 inline-flex items-center gap-2 px-3 py-1.5 border border-[#ff4500]/40 bg-[#ff4500]/5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#ff4500] animate-pulse" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500]">Williams CNC · Active maker</span>
                </div>
              </div>
            </div>
          </div>

          {/* Letter */}
          <div className="lg:col-span-7">
            <SectionTag>Founder Letter</SectionTag>
            <h2 className="font-display font-bold text-white text-3xl sm:text-4xl lg:text-5xl tracking-tight leading-[1.1] mb-8">
              I built this for makers like us.
            </h2>
            <div className="prose prose-invert space-y-5 text-[#d4d4d4] text-base sm:text-lg leading-relaxed max-w-[64ch]">
              <p>
                I run Williams CNC out of a small shop. Every weekend I cut, weld, and sand for buyers I meet on platforms that take 15-30% off the top and then bury my listings under mass-produced lookalikes.
              </p>
              <p>
                Crafters Market is what I wished existed. A platform where the storefront is curated, the community is real, and the growth tools come included — not as a $99/month upsell.
              </p>
              <p>
                If you're here early, you're shaping it. The first 100 makers lock in lifetime founding status. The first 25 get my personal phone number for direct support during their first six months.
              </p>
              <p className="text-white">
                Build with me. The maker economy is bigger than any single platform — and the next decade belongs to creators with real tools and real visibility.
              </p>
            </div>
            <div className="mt-10 font-display text-2xl text-[#ff4500] italic">— Michael</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.28em] text-[#a3a3a3]">Founder · Crafters Market · Williams CNC</div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 8 · FINAL CTA
// ═════════════════════════════════════════════════════════════════════
function FinalCTA() {
  return (
    <section className="relative bg-[#0a0a0a] py-24 lg:py-32 border-t border-[#1a1a1a] overflow-hidden" data-testid="grow-final-cta">
      {/* Big atmospheric bloom */}
      <div className="absolute inset-0 bg-gradient-radial from-[#ff4500]/[0.08] via-transparent to-transparent" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px] rounded-full bg-[#ff4500] opacity-[0.10] blur-[140px]" />
      <GridOverlay opacity={0.04} />

      <div className="relative max-w-5xl mx-auto px-6 lg:px-12 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="font-display font-bold text-white text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-[1.05]"
        >
          Join Early.<br />
          <span className="bg-gradient-to-r from-[#ff4500] via-[#ffb000] to-[#00ffff] bg-clip-text text-transparent">
            Help Shape the Future.
          </span>
        </motion.h2>
        <p className="mt-8 text-[#a3a3a3] text-base sm:text-lg leading-relaxed max-w-[58ch] mx-auto">
          The next decade of the maker economy is being built right now. The first 100 sellers lock in lifetime founding status.
        </p>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
          <Link
            to="/maker/apply"
            className="group inline-flex items-center gap-3 px-7 py-4 bg-[#ff4500] hover:bg-[#ff5a1a] text-black font-mono text-xs uppercase tracking-[0.22em] font-semibold transition shadow-[0_0_40px_rgba(255,69,0,0.45)] hover:shadow-[0_0_60px_rgba(255,69,0,0.65)]"
            data-testid="grow-final-cta-primary"
          >
            Apply as a Founding Seller
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </Link>
          <a
            href="mailto:partners@craftersmarket.org"
            className="inline-flex items-center gap-3 px-7 py-4 border border-[#262626] hover:border-[#00ffff] text-white font-mono text-xs uppercase tracking-[0.22em] transition hover:text-[#00ffff]"
            data-testid="grow-final-cta-partner"
          >
            Partner With Us
          </a>
          <Link
            to="/community"
            className="inline-flex items-center gap-3 px-7 py-4 border border-[#262626] hover:border-[#ffb000] text-white font-mono text-xs uppercase tracking-[0.22em] transition hover:text-[#ffb000]"
            data-testid="grow-final-cta-community"
          >
            Join the Community
          </Link>
        </div>
      </div>
    </section>
  );
}


// ═════════════════════════════════════════════════════════════════════
// PAGE
// ═════════════════════════════════════════════════════════════════════
export default function GrowWithUs() {
  return (
    <div className="bg-[#0a0a0a] text-white min-h-screen" data-testid="grow-with-us-page">
      <Hero />
      <Problem />
      <Vision />
      <Roadmap />
      <Audience />
      <Traction />
      <FounderLetter />
      <FinalCTA />
    </div>
  );
}
