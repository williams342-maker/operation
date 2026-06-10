import React, { useRef } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { ShieldCheck, Hammer, Map, ArrowRight } from "lucide-react";
import CopperGlowOrb from "../CopperGlowOrb";

/**
 * "Why We Exist" — the emotional anchor of the homepage. The cinematic
 * iter217 reskin replaces the flat grid with an over-sized typographic
 * hero, a scroll-driven copper glow reveal (the warm light grows behind
 * the headline as the section enters the viewport), and tightly tracked
 * pillar cards that read as workshop signage rather than UI tiles.
 *
 * Mounted between `<VelocityProofStrip>` and `<MeetTheMakers>` on `/`.
 * All motion respects prefers-reduced-motion (scroll transforms freeze).
 */
export default function WhyWeExist({ testId = "why-we-exist" }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  // Glow grows + brightens as the section enters view, fades as it exits.
  const glowOpacity = useTransform(
    scrollYProgress,
    [0, 0.35, 0.65, 1],
    reduced ? [0.5, 0.5, 0.5, 0.5] : [0.15, 0.85, 0.95, 0.3]
  );
  const glowScale = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    reduced ? [1, 1, 1] : [0.6, 1.1, 0.85]
  );

  const pillars = [
    {
      icon: ShieldCheck,
      idx: "01",
      title: "Vetted American makers.",
      body:
        "Every seller is a real person working in a real workshop — application-vetted, location-verified, reachable directly. No dropshipping. No reseller listings. No factory storefronts pretending to be artisans.",
    },
    {
      icon: Hammer,
      idx: "02",
      title: "Built to order. Not warehoused.",
      body:
        "Most pieces are cut, welded, carved, or engraved after you place the order. You're commissioning the work — not buying inventory. That's why your maker can match size, finish, material, and message without a surcharge.",
    },
    {
      icon: Map,
      idx: "03",
      title: "Made in real shops across America.",
      body:
        "From a CNC garage in Washington to a welding bay in Texas to a wood studio in Vermont — every order ships from the maker's own workshop. Tracking shows you exactly where it came from.",
    },
  ];

  return (
    <section
      ref={ref}
      className="relative w-full py-20 md:py-32 overflow-hidden bg-surface border-y border-amber-900/20"
      data-testid={testId}
    >
      {/* Scroll-driven copper glow — the emotional spotlight of the page. */}
      <motion.div
        className="absolute top-1/2 left-1/2 w-[900px] h-[900px] -translate-x-1/2 -translate-y-1/2 copper-glow pointer-events-none"
        style={{ opacity: glowOpacity, scale: glowScale }}
        aria-hidden="true"
      />
      <CopperGlowOrb size={420} x="12%" y="22%" intensity={0.35} warm delay={2} />
      <CopperGlowOrb size={520} x="88%" y="78%" intensity={0.3} delay={6} />

      {/* Blueprint grid backdrop */}
      <div className="absolute inset-0 blueprint-grid opacity-50 pointer-events-none" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-[1600px] mx-auto px-4 md:px-8 xl:px-12">
        {/* Oversized typographic anchor */}
        <div className="text-center mb-16 md:mb-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7 }}
            className="font-mono text-[11px] uppercase tracking-[0.4em] text-amber-400 mb-6 inline-flex items-center gap-3"
          >
            <span className="inline-block w-10 h-px bg-amber-400" />
            Why we exist
            <span className="inline-block w-10 h-px bg-amber-400" />
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ delay: 0.1, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="font-display text-5xl md:text-7xl lg:text-8xl tracking-tighter leading-[0.9] max-w-5xl mx-auto text-amber-50"
          >
            Big marketplaces<br />
            broke handmade.
            <br />
            <span className="text-brand drop-shadow-[0_0_24px_rgba(255,69,0,0.4)]">
              We're rebuilding it.
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ delay: 0.25, duration: 0.7 }}
            className="font-mono text-sm md:text-base text-zinc-400 mt-8 max-w-2xl mx-auto leading-relaxed"
          >
            Etsy and Amazon flooded the "handmade" aisle with factory imports and
            drop-shipped knock-offs. Crafters Market exists so American artists,
            welders, woodworkers, and CNC creators can sell direct — and so buyers
            can find the real thing again.
          </motion.p>
        </div>

        {/* Pillar cards — workshop signage, not UI tiles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          {pillars.map((p, i) => {
            const Icon = p.icon;
            return (
              <motion.div
                key={p.title}
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ delay: 0.15 + i * 0.12, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="cinematic-frame p-6 md:p-7 group"
                data-testid={`${testId}-pillar`}
              >
                <div className="flex items-baseline justify-between mb-5">
                  <span className="font-display text-5xl md:text-6xl text-amber-500/15 tracking-tighter leading-none">
                    {p.idx}
                  </span>
                  <span className="w-10 h-10 border border-amber-500/40 text-amber-400 group-hover:border-amber-400 group-hover:bg-amber-500/10 transition-colors flex items-center justify-center">
                    <Icon size={16} />
                  </span>
                </div>
                <h3 className="font-display text-2xl md:text-3xl text-amber-50 leading-[1.05] tracking-tight mb-3">
                  {p.title}
                </h3>
                <div className="w-12 h-px bg-amber-500/60 mb-4" />
                <p className="font-mono text-[12px] text-zinc-400 leading-relaxed">
                  {p.body}
                </p>
              </motion.div>
            );
          })}
        </div>

        {/* CTA row */}
        <div className="flex flex-wrap gap-3 mt-12 md:mt-14 justify-center">
          <Link
            to="/about"
            className="inline-flex items-center gap-2 px-6 py-3 border border-amber-500/40 hover:border-amber-400 hover:text-amber-200 hover:bg-amber-500/10 font-mono text-[11px] uppercase tracking-[0.28em] text-amber-300 transition-colors"
            data-testid={`${testId}-about-link`}
          >
            Read the full story <ArrowRight size={12} />
          </Link>
          <Link
            to="/beta"
            className="inline-flex items-center gap-2 px-6 py-3 border border-zinc-700 hover:border-amber-400 hover:text-amber-200 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-300 transition-colors"
            data-testid={`${testId}-apply-link`}
          >
            Are you a maker? Apply <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </section>
  );
}
