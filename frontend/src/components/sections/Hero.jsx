import React, { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { Search, ArrowDown, Users, Hammer } from "lucide-react";
import CopperGlowOrb from "../CopperGlowOrb";
import RotatingHeadline from "../RotatingHeadline";
import EmberField from "../EmberField";

/**
 * Cinematic Hero (iter217 redesign).
 *
 * Layered composition — every layer is purposeful:
 *   1. Workshop photo (welding-sparks dark frame, .workshop-tone treatment)
 *   2. Black gradient veil (top→bottom) for legibility
 *   3. Faint blueprint grid overlay (mask-radial so it fades at edges)
 *   4. Two ambient copper-glow orbs (slow drift, .copper-drift)
 *   5. Vignette ring (radial darken so the type pops)
 *   6. Copper-shimmer scanline (cinematic lighting, 8s loop)
 *   7. Content (overline + headline + sub + CTAs + search + pills)
 *
 * All motion respects `prefers-reduced-motion` — parallax + orb drift +
 * shimmer all auto-disable, leaving a clean static hero.
 */
const HERO_BG =
  "https://images.unsplash.com/photo-1745448797900-35d08e85e9db?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1NzZ8MHwxfHNlYXJjaHwxfHx3ZWxkaW5nJTIwc3BhcmtzJTIwZGFyayUyMGluZHVzdHJpYWx8ZW58MHx8fHwxNzc3MTU0OTg0fDA&ixlib=rb-4.1.0&q=85";

const PILLS = ["Wall Art", "Custom Signs", "Outdoor Art"];

export default function Hero() {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const onSearch = (e) => {
    e.preventDefault();
    nav(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : "/shop");
  };

  const sectionRef = useRef(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const bgY = useTransform(scrollYProgress, [0, 1], reduced ? ["0%", "0%"] : ["0%", "14%"]);
  const overlayY = useTransform(scrollYProgress, [0, 1], reduced ? ["0%", "0%"] : ["0%", "7%"]);

  return (
    <section
      ref={sectionRef}
      id="top"
      className="relative w-full min-h-[78svh] md:min-h-[82svh] overflow-hidden"
      data-testid="hero-section"
    >
      {/* 1 — Workshop photo (parallax) */}
      <motion.div className="absolute inset-0" style={{ y: bgY }} aria-hidden="true">
        <img
          src={HERO_BG}
          alt=""
          className="absolute inset-0 w-full h-full object-cover scale-110 workshop-tone"
        />
      </motion.div>

      {/* 2 — Gradient veil (parallax, slower) */}
      <motion.div className="absolute inset-0" style={{ y: overlayY }} aria-hidden="true">
        <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/55 to-[#0a0a0a]" />
      </motion.div>

      {/* 3 — Faint blueprint grid */}
      <div className="absolute inset-0 blueprint-grid opacity-60 pointer-events-none" aria-hidden="true" />

      {/* 4 — Ambient copper orbs (2 staggered) */}
      <CopperGlowOrb size={700} x="78%" y="32%" intensity={0.65} />
      <CopperGlowOrb size={520} x="14%" y="78%" intensity={0.4} warm delay={4} />

      {/* 5 — Vignette ring */}
      <div className="absolute inset-0 cinematic-vignette pointer-events-none" aria-hidden="true" />

      {/* 6 — Copper-shimmer (filmic lighting) */}
      <div className="absolute inset-0 copper-shimmer pointer-events-none opacity-70" aria-hidden="true" />

      {/* 6b — Soft animated embers · CSS-only particle field, drifting up
         like sparks rising from a forge. Pure decorative — pointer-events
         none, aria-hidden, auto-stops on prefers-reduced-motion. */}
      <EmberField count={24} className="absolute inset-0" />

      {/* 7 — Content */}
      <div className="relative z-10 w-full max-w-[1400px] mx-auto px-4 md:px-8 pt-36 md:pt-44 pb-12 text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="font-mono text-[11px] uppercase tracking-[0.32em] text-amber-400 mb-6 inline-flex items-center gap-3 justify-center"
        >
          <span className="inline-block w-8 h-px bg-amber-400" />
          Handmade in America · Built to order
          <span className="inline-block w-8 h-px bg-amber-400" />
        </motion.div>

        {/* Rotating cinematic headline. The motion wrapper is required —
            it creates a fresh stacking context so the giant type paints
            cleanly above the workshop-photo bg layer. Animation is
            opacity-only so a stalled framer-motion frame can't ever
            orphan the headline at opacity:0 (had that bug pre-iter220
            when I removed this wrapper). */}
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
          style={{ willChange: "opacity" }}
          data-testid="hero-headline-wrap"
        >
          <RotatingHeadline />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.7 }}
          className="font-mono text-sm md:text-base text-zinc-300 max-w-2xl mx-auto mt-6 leading-relaxed"
        >
          The marketplace for{" "}
          <strong className="text-white font-normal">CNC</strong>,{" "}
          <strong className="text-white font-normal">plasma</strong>, and{" "}
          <strong className="text-white font-normal">custom fabrication</strong>.
          Commission real makers in real workshops — no mass production, no drop-shipping,
          backed by the hands that built it.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.7 }}
          className="mt-9 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3"
          data-testid="hero-ctas"
        >
          {/* Primary CTA — Browse Makers (the "discover real workshops"
              promise the entire site is built around). Routes to /makers
              instead of /shop because makers-first is the brand position. */}
          <Link
            to="/makers"
            className="btn-industrial btn-primary inline-flex items-center justify-center gap-2 text-sm px-7 py-3.5 shadow-[0_0_24px_-4px_rgba(255,69,0,0.55)] hover:shadow-[0_0_40px_-4px_rgba(255,69,0,0.85)] transition-shadow"
            data-testid="hero-cta-browse-makers"
          >
            <Users size={16} /> Browse Makers
          </Link>
          {/* Secondary CTA — Sell Your Work (maker application funnel) */}
          <Link
            to="/apply"
            className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border border-amber-500/40 hover:border-amber-400 hover:text-amber-300 backdrop-blur-md bg-black/30 font-mono text-xs uppercase tracking-[0.22em] text-zinc-200 transition-colors"
            data-testid="hero-cta-sell"
          >
            <Hammer size={14} /> Sell Your Work
          </Link>
        </motion.div>

        <motion.form
          onSubmit={onSearch}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.52, duration: 0.7 }}
          className="mt-10 max-w-2xl mx-auto flex items-stretch border border-amber-500/30 bg-black/70 backdrop-blur-md focus-within:border-amber-400 transition-colors"
          data-testid="hero-search-form"
        >
          <Search size={16} className="ml-4 self-center text-amber-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search wall art, custom signs, address numbers…"
            data-testid="hero-search-input"
            className="flex-1 bg-transparent px-4 py-4 font-mono text-sm outline-none placeholder:text-zinc-500"
          />
          <button
            type="submit"
            data-testid="hero-search-btn"
            className="px-6 md:px-8 bg-[#ff4500] text-white font-mono text-xs uppercase tracking-[0.22em] hover:bg-[#cc3700] transition-colors"
          >
            Search →
          </button>
        </motion.form>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.62, duration: 0.6 }}
          className="mt-6 flex flex-wrap items-center justify-center gap-2"
          data-testid="hero-pills"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500 mr-2">
            Popular →
          </span>
          {PILLS.map((p) => (
            <button
              key={p}
              onClick={() => nav(`/shop?q=${encodeURIComponent(p)}`)}
              className="px-3 py-1.5 border border-amber-500/20 hover:border-amber-400 hover:text-amber-300 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-300 transition bg-black/30 backdrop-blur-sm"
            >
              {p}
            </button>
          ))}
        </motion.div>

        <div className="mt-8 flex items-center justify-center gap-4 md:gap-8 font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500 flex-wrap">
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-amber-400 animate-pulse" /> 12 makers · live now
          </span>
          {/* iter321 — Loud business-model proof point. The single
              clearest reason a maker (or buyer) should pick us over Etsy
              et al. Sits with the other trust pills so it reads as
              fact, not advertisement. */}
          <span
            className="flex items-center gap-2 text-amber-300"
            data-testid="hero-trust-95-percent"
          >
            <span className="text-amber-400">◆</span> Makers keep 95% · 5% platform fee
          </span>
          <span className="hidden md:inline text-amber-500/60">Plasma · Laser · Router</span>
          <span className="hidden md:flex items-center gap-2">
            <ArrowDown size={12} /> Scroll
          </span>
        </div>
      </div>
    </section>
  );
}
