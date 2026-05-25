/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Flame, Zap, Aperture, ArrowUpRight, Play } from "lucide-react";
import CopperGlowOrb from "./CopperGlowOrb";

/**
 * "Cinematic Moments" homepage strip — three filmic panels showing the
 * three core fabrication techniques (plasma · welding · laser). Designed
 * as the emotional bridge between the curated Featured Builds rail and
 * the AI Discovery search, so visitors *feel* the craftsmanship before
 * being asked to describe what they want.
 *
 * Hybrid implementation per user direction: static cinematic posters
 * with optional looping video sources. When `videoSrc` is reachable, the
 * `<video>` element auto-plays muted on loop. When the source 404s (the
 * case today — no real maker clips yet), `onError` flips to poster-only
 * and the panel still feels filmic via copper-shimmer + ambient glow +
 * grain overlay treatments.
 *
 * Mobile-safe:
 *   - `playsInline muted autoplay loop` (no audio surprises, no fullscreen jail)
 *   - lazy IntersectionObserver mount — video src is only set once the
 *     panel scrolls into view, so off-screen panels don't drain cellular.
 *   - prefers-reduced-motion: video sources are never set (poster only).
 *
 * Self-hides when fewer than 3 panels are valid (defensive — shouldn't
 * happen in practice since all 3 panels have local poster fallbacks).
 */
const MOMENTS = [
  {
    id: "plasma",
    icon: Flame,
    label: "Plasma cut",
    overline: "◆ Technique 01",
    headline: "Steel meets fire.",
    body: "Computer-guided plasma at 30,000°F slicing 1/4\" mild steel like paper.",
    poster: "/seed-images/featured/fe-cor-ten-fire-pit.jpg",
    videoSrc: "/seed-clips/plasma-cut/clip.mp4",
    href: "/shop?technique=PLASMA",
  },
  {
    id: "welding",
    icon: Zap,
    label: "Welding",
    overline: "◆ Technique 02",
    headline: "Sparks. Bead. Bond.",
    body: "MIG and TIG work that turns separate steel parts into a single sculpture.",
    poster: "/seed-images/featured/fe-steel-veterans-shadow-box.jpg",
    videoSrc: "/seed-clips/welding/clip.mp4",
    href: "/shop?technique=WELDING",
  },
  {
    id: "laser",
    icon: Aperture,
    label: "Laser engraving",
    overline: "◆ Technique 03",
    headline: "Light carving wood.",
    body: "100W CO₂ laser etching walnut, oak, and maple with photographic precision.",
    poster: "/seed-images/featured/fe-laser-cut-holiday-ornaments.jpg",
    videoSrc: "/seed-clips/laser-engraving-walnut/clip.mp4",
    href: "/shop?technique=LASER",
  },
];

export default function CinematicMomentsStrip({ testId = "home-cinematic-moments" }) {
  return (
    <section
      className="relative w-full py-16 md:py-24 overflow-hidden bg-[#070707] border-b border-amber-900/20"
      data-testid={testId}
    >
      {/* Ambient stage lighting — two slow copper orbs left + right. */}
      <CopperGlowOrb size={520} x="10%" y="40%" intensity={0.55} />
      <CopperGlowOrb size={620} x="92%" y="65%" intensity={0.45} warm delay={3} />

      {/* Faint blueprint grid behind the strip — workshop blueprint vibe. */}
      <div className="absolute inset-0 blueprint-grid opacity-50 pointer-events-none" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        {/* Section header — copper overline + tightly tracked headline. */}
        <div className="flex items-end justify-between mb-10 md:mb-14 gap-4 flex-wrap">
          <div>
            <div
              className="font-mono text-[11px] uppercase tracking-[0.32em] text-amber-400 mb-3 inline-flex items-center gap-2"
              data-testid={`${testId}-eyebrow`}
            >
              <span className="inline-block w-6 h-px bg-amber-400" />
              Inside the workshop
            </div>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl tracking-tighter max-w-2xl">
              Cinematic moments<br />
              <span className="text-outline-orange">from the shop floor.</span>
            </h2>
          </div>
          <Link
            to="/clips"
            data-testid={`${testId}-clips-cta`}
            className="industrial-link font-mono text-[11px] uppercase tracking-[0.22em] text-amber-300 hover:text-amber-100 whitespace-nowrap inline-flex items-center gap-2"
          >
            <Play size={11} /> Watch all on /clips →
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          {MOMENTS.map((m, i) => (
            <MomentPanel key={m.id} m={m} i={i} testId={`${testId}-${m.id}`} />
          ))}
        </div>

        <p
          className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#737373] mt-10 text-center"
          data-testid={`${testId}-footer-note`}
        >
          ✦ Real footage from vetted maker workshops · curated weekly
        </p>
      </div>
    </section>
  );
}

/**
 * One filmic panel. Lazy-mounts the `<video>` element only when the
 * panel scrolls within ~200px of the viewport (IntersectionObserver),
 * and only when reduced-motion is NOT set. On video error, falls back
 * to a poster-only treatment so the layout never breaks.
 */
function MomentPanel({ m, i, testId }) {
  const Icon = m.icon;
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [shouldMountVideo, setShouldMountVideo] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    if (reduced) return; // poster-only path
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldMountVideo(true);
            io.disconnect();
          }
        });
      },
      { rootMargin: "200px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <motion.article
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ delay: i * 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="cinematic-frame group relative aspect-[3/4] md:aspect-[4/5] overflow-hidden"
      data-testid={testId}
    >
      <Link to={m.href} className="block w-full h-full relative" data-testid={`${testId}-link`}>
        {/* Layer 1 — poster image (always rendered, sits under video). */}
        <img
          src={m.poster}
          alt={`${m.label} workshop moment`}
          className="absolute inset-0 w-full h-full object-cover workshop-tone group-hover:scale-105 transition-transform duration-[1500ms] ease-out"
          loading="lazy"
        />

        {/* Layer 2 — video on top (only when lazy-mounted and not failed). */}
        {shouldMountVideo && !videoFailed && (
          <video
            className="absolute inset-0 w-full h-full object-cover opacity-90"
            src={m.videoSrc}
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            onError={() => setVideoFailed(true)}
            data-testid={`${testId}-video`}
          />
        )}

        {/* Layer 3 — vignette + bottom gradient for legibility. */}
        <div className="absolute inset-0 cinematic-vignette pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />

        {/* Layer 4 — copper-shimmer scanline (filmic motion even without video). */}
        <div className="absolute inset-0 copper-shimmer pointer-events-none" />

        {/* Layer 5 — content overlay. */}
        <div className="absolute inset-0 flex flex-col justify-between p-5 md:p-6">
          <div className="flex items-center justify-between">
            <span
              className="inline-flex items-center gap-2 px-2.5 py-1 bg-black/70 backdrop-blur-sm border border-amber-500/50 text-amber-300 font-mono text-[9px] uppercase tracking-[0.28em]"
              data-testid={`${testId}-label`}
            >
              <Icon size={11} />
              {m.label}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.28em] text-amber-400/80">
              {m.overline}
            </span>
          </div>

          <div>
            <h3 className="font-display text-2xl md:text-3xl lg:text-4xl tracking-tighter text-white leading-[0.95] mb-2">
              {m.headline}
            </h3>
            <p className="font-mono text-[11px] md:text-xs text-zinc-300 leading-relaxed max-w-[28ch] mb-3">
              {m.body}
            </p>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300 inline-flex items-center gap-1 group-hover:gap-2 transition-all">
              Browse {m.label.toLowerCase()} work <ArrowUpRight size={11} />
            </span>
          </div>
        </div>
      </Link>
    </motion.article>
  );
}
