import React from "react";
import { motion } from "framer-motion";
import Marquee from "react-fast-marquee";

export default function CustomCTA() {
  return (
    <section id="custom" className="relative w-full bg-paper py-24 md:py-32 overflow-hidden border-t border-line">
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 80% 20%, rgba(255,69,0,0.25), transparent 55%), radial-gradient(circle at 10% 80%, rgba(255,69,0,0.12), transparent 60%)",
        }}
      />
      <div className="relative w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 grid md:grid-cols-12 gap-10 items-center">
        <div className="md:col-span-7">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-5">
            ◆ 006 / Custom Orders Welcome
          </div>
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9 }}
            className="font-display text-[64px] md:text-[140px] lg:text-[180px] leading-[0.88]"
          >
            Bring Your
            <br />
            <span className="text-brand">Vision</span>
            <br />
            <span className="text-outline">To Life.</span>
          </motion.h2>
          <p className="mt-8 font-mono text-sm md:text-base max-w-xl text-ink-muted leading-relaxed">
            Have a specific design in mind? We work directly with you to create one-of-a-kind pieces
            for homes, businesses, gifts, and more.
          </p>
        </div>

        <div className="md:col-span-5 md:pl-10 md:border-l md:border-line">
          <ul className="space-y-5 font-mono text-xs uppercase tracking-[0.22em] text-ink">
            <li className="flex items-center gap-4">
              <span className="text-brand">→</span> No commitment
            </li>
            <li className="flex items-center gap-4">
              <span className="text-brand">→</span> Free quote in 24h
            </li>
            <li className="flex items-center gap-4">
              <span className="text-brand">→</span> Ships nationwide
            </li>
            <li className="flex items-center gap-4">
              <span className="text-brand">→</span> Made to your spec
            </li>
          </ul>
          <div className="mt-12 flex flex-wrap gap-4">
            <a href="/custom-order" className="btn-industrial btn-primary" data-testid="custom-start-btn">
              Start Your Order →
            </a>
            <a href="/custom-order" className="btn-industrial border-[#e5e5e5] text-ink" data-testid="custom-brief-btn">
              Send a Brief
            </a>
          </div>
        </div>
      </div>

      {/* Bottom marquee */}
      <div className="relative mt-20 border-t border-b border-line py-6">
        <Marquee gradient={false} speed={50}>
          <span className="ticker-text text-[10vw] md:text-[7vw] mr-12">
            CUSTOM · ONE-OF-ONE · BUILT TO ORDER ·
          </span>
          <span className="ticker-text text-[10vw] md:text-[7vw] mr-12 text-brand">
            CUSTOM · ONE-OF-ONE · BUILT TO ORDER ·
          </span>
        </Marquee>
      </div>
    </section>
  );
}
