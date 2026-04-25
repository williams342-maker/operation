import React, { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowDown } from "lucide-react";

const HERO_BG =
  "https://images.unsplash.com/photo-1745448797900-35d08e85e9db?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1NzZ8MHwxfHNlYXJjaHwxfHx3ZWxkaW5nJTIwc3BhcmtzJTIwZGFyayUyMGluZHVzdHJpYWx8ZW58MHx8fHwxNzc3MTU0OTg0fDA&ixlib=rb-4.1.0&q=85";

const wordReveal = {
  hidden: { y: "110%" },
  visible: (i) => ({
    y: "0%",
    transition: { delay: 0.2 + i * 0.08, duration: 0.9, ease: [0.22, 0.61, 0.36, 1] },
  }),
};

export default function Hero() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 200]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.15]);
  const opacity = useTransform(scrollYProgress, [0, 1], [1, 0.2]);

  return (
    <section
      id="top"
      ref={ref}
      className="relative w-full min-h-[100svh] overflow-hidden"
      data-testid="hero-section"
    >
      <motion.div style={{ y, scale }} className="absolute inset-0">
        <img
          src={HERO_BG}
          alt="Welding sparks in the dark"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/60 to-[#0a0a0a]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,69,0,0.18),transparent_50%)]" />
      </motion.div>

      <motion.div style={{ opacity }} className="relative z-10 w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 pt-44 md:pt-48 pb-16">
        {/* Top metadata strip */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="flex flex-wrap items-center gap-6 font-mono text-[11px] uppercase tracking-[0.25em] text-[#a3a3a3] mb-12"
        >
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 bg-[#ff4500] animate-pulse" /> Live · 12 makers crafting now
          </span>
          <span className="hidden md:inline">·</span>
          <span>Plasma · Laser · Router · CNC</span>
          <span className="hidden md:inline">·</span>
          <span>Ships nationwide</span>
        </motion.div>

        {/* Headline word-reveal */}
        <h1 className="font-display text-[56px] sm:text-[88px] md:text-[140px] lg:text-[180px] xl:text-[220px] leading-[0.88]">
          {["FORGED", "BY HAND.", "CUT BY", "MACHINE."].map((w, i) => (
            <span key={w} className="block overflow-hidden">
              <motion.span
                custom={i}
                variants={wordReveal}
                initial="hidden"
                animate="visible"
                className={`block ${i === 2 ? "text-outline-orange ml-[8%] md:ml-[14%]" : ""} ${
                  i === 3 ? "text-[#ff4500] ml-[20%] md:ml-[30%]" : ""
                }`}
              >
                {w}
              </motion.span>
            </span>
          ))}
        </h1>

        {/* Bottom row */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-12 gap-8 items-end">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, duration: 0.7 }}
            className="md:col-span-5 font-mono text-sm md:text-base text-[#e5e5e5] leading-relaxed max-w-md"
          >
            A marketplace of approved artisan makers shaping raw steel, hardwood and aluminum into
            objects that outlive trends. Every piece, built to order. Every cut, intentional.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1, duration: 0.7 }}
            className="md:col-span-4 md:col-start-9 flex flex-col sm:flex-row gap-4"
          >
            <a href="#showcase" className="btn-industrial btn-primary" data-testid="hero-cta-shop">
              Shop The Showcase →
            </a>
            <a href="#custom" className="btn-industrial border-[#e5e5e5] text-[#e5e5e5]" data-testid="hero-cta-custom">
              Custom Order
            </a>
          </motion.div>
        </div>
      </motion.div>

      {/* Bottom ticker */}
      <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-[#262626] bg-black/60 backdrop-blur-md">
        <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-4 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.25em] text-[#a3a3a3]">
          <div className="flex items-center gap-2">
            <ArrowDown size={14} className="animate-bounce" />
            <span>Scroll</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <span>14ga mild steel</span>
            <span>·</span>
            <span>3/4" oak hardwood</span>
            <span>·</span>
            <span>Powder coat finish</span>
          </div>
          <div>NO. 001 / SS26</div>
        </div>
      </div>
    </section>
  );
}
