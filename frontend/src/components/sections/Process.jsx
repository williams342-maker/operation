import React from "react";
import { motion } from "framer-motion";
import Marquee from "react-fast-marquee";

const PROCESS_IMG =
  "https://images.unsplash.com/photo-1689960253768-72a12bc8320f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHw0fHxjbmMlMjBwbGFzbWElMjBjdXR0aW5nJTIwbWV0YWwlMjB3b3JrZXJ8ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85";

const steps = [
  { no: "01", label: "CAD Design & Toolpath", desc: "Vectorized drawings, kerf-corrected paths." },
  { no: "02", label: "CNC Carving", desc: "Plasma, laser & router under tight tolerance." },
  { no: "03", label: "Fine Detailing", desc: "Hand-finished edges, sanded, deburred, tuned." },
  { no: "04", label: "Finish & Quality", desc: "Powder coat, stain, sealed. Inspected, packed." },
];

export default function Process() {
  return (
    <section id="process" className="relative w-full py-24 md:py-36 bg-[#0a0a0a] overflow-hidden border-y border-[#262626]">
      {/* Marquee backdrop */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 pointer-events-none select-none">
        <Marquee gradient={false} speed={45} className="opacity-25">
          <span className="ticker-text text-[18vw] md:text-[14vw] text-outline mr-12">
            DESIGN · TOOLPATH · CARVE · DETAIL · FINISH · QUALITY ·
          </span>
        </Marquee>
        <Marquee gradient={false} speed={35} direction="right" className="opacity-15 mt-2">
          <span className="ticker-text text-[18vw] md:text-[14vw] text-outline-orange mr-12">
            PRECISION · PLASMA · LASER · ROUTER · OAK · STEEL ·
          </span>
        </Marquee>
      </div>

      <div className="relative w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="grid md:grid-cols-12 gap-8 mb-14">
          <div className="md:col-span-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
              ◆ 003 / Our Craft
            </div>
            <h2 className="font-display text-[48px] md:text-[88px] leading-[0.9]">
              Crafted
              <br />
              <span className="text-[#ff4500]">With</span>
              <br />
              Precision
            </h2>
          </div>

          <div className="md:col-span-7 md:col-start-6 self-end">
            <p className="font-mono text-sm md:text-base text-[#e5e5e5] leading-relaxed max-w-xl">
              Every piece starts as raw material — hardwood, steel, aluminum — and is transformed
              through CNC precision into art that lasts a lifetime. No two pieces are exactly alike.
            </p>
            <ul className="mt-8 grid sm:grid-cols-2 gap-4 font-mono text-xs uppercase tracking-[0.2em] text-[#a3a3a3]">
              <li>→ CNC routed & laser-finished hardwoods</li>
              <li>→ Plasma-cut, powder-coated metals</li>
              <li>→ Custom sizing for any space</li>
              <li>→ Ships continental US</li>
            </ul>
          </div>
        </div>

        {/* Image + Steps */}
        <div className="grid md:grid-cols-12 gap-6 md:gap-10 items-stretch">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1 }}
            className="md:col-span-6 relative aspect-[4/5] md:aspect-auto md:min-h-[640px] overflow-hidden border border-[#262626]"
          >
            <img src={PROCESS_IMG} alt="CNC plasma cutting in process" className="absolute inset-0 w-full h-full object-cover media-img" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent" />
            <div className="absolute top-5 left-5 tag text-[#ff4500] border-[#ff4500]">LIVE FEED</div>
            <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between font-mono text-xs uppercase tracking-[0.2em] text-[#e5e5e5]">
              <span>Workshop · Bay 03</span>
              <span>Tool: 1/8" carbide</span>
            </div>
          </motion.div>

          <ol className="md:col-span-6 grid grid-cols-1 gap-0 border-t border-[#262626]">
            {steps.map((s, i) => (
              <motion.li
                key={s.no}
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                className="group relative border-b border-[#262626] py-6 md:py-8 grid grid-cols-12 items-center gap-4 hover:bg-[#0f0f0f] transition-colors duration-500"
                data-testid={`process-step-${s.no}`}
              >
                <span className="col-span-2 font-mono text-sm text-[#ff4500] tracking-[0.2em]">{s.no}</span>
                <div className="col-span-7">
                  <div className="font-display text-2xl md:text-4xl">{s.label}</div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a3a3a3] mt-2">
                    {s.desc}
                  </div>
                </div>
                <div className="col-span-3 flex justify-end">
                  <div className="w-10 h-10 border border-[#262626] group-hover:border-[#ff4500] group-hover:bg-[#ff4500] transition flex items-center justify-center">
                    <span className="font-mono text-xs">→</span>
                  </div>
                </div>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
