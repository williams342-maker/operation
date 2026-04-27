import React from "react";
import { motion } from "framer-motion";

const MAKER_IMG =
  "https://images.unsplash.com/photo-1764115424737-25aca6f47835?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwxfHxjbmMlMjBwbGFzbWElMjBjdXR0aW5nJTIwbWV0YWwlMjB3b3JrZXJ8ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85";

const perks = [
  { k: "01", t: "No website needed", d: "Upload your portfolio. We host the storefront." },
  { k: "02", t: "Approved makers only", d: "Quality bar protects the brand and the buyer." },
  { k: "03", t: "Built-in payments", d: "Clean payouts. No paperwork friction." },
  { k: "04", t: "Plasma · Laser · Router", d: "Whatever you build — we move it." },
];

export default function ForMakers() {
  return (
    <section id="makers" className="relative w-full bg-[#ff4500] text-black overflow-hidden">
      {/* Diagonal noise */}
      <div className="absolute inset-0 mix-blend-multiply opacity-20 pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(0,0,0,0.15) 0 2px, transparent 2px 12px)",
        }}
      />
      <div className="relative w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-24 md:py-32 grid md:grid-cols-12 gap-10 md:gap-14">
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9 }}
          className="md:col-span-7 relative overflow-hidden border border-black"
        >
          <div className="aspect-[4/5] relative">
            <img src={MAKER_IMG} alt="A maker in their workshop" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/20 mix-blend-multiply" />
            <div className="absolute top-5 left-5 tag !text-black !border-black bg-[#ff4500]">
              FOR MAKERS
            </div>
            <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between font-mono text-[11px] uppercase tracking-[0.25em] text-white">
              <span>CNC Garage Builders</span>
              <span>Approved · Vetted · Paid</span>
            </div>
          </div>
        </motion.div>

        <div className="md:col-span-5 flex flex-col justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] mb-5">
              ◆ 004 / The Maker Program
            </div>
            <motion.h2
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="font-display text-[64px] md:text-[120px] leading-[0.88]"
            >
              Built for
              <br />
              CNC
              <br />
              Garage
              <br />
              Makers.
            </motion.h2>
            <p className="mt-8 font-mono text-sm md:text-base max-w-md leading-relaxed">
              You build the work. We build the audience. List your plasma, laser, router, and 3D-printed pieces in a
              storefront made for serious makers — no website needed.
            </p>
          </div>

          <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-0 border-t border-black/30">
            {perks.map((p) => (
              <li key={p.k} className="border-b border-black/30 sm:[&:nth-child(odd)]:border-r py-5">
                <div className="font-mono text-[10px] tracking-[0.25em]">{p.k}</div>
                <div className="font-display text-xl md:text-2xl mt-1">{p.t}</div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] mt-2 text-black/70">
                  {p.d}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex flex-wrap gap-4">
            <a
              href="/apply"
              className="btn-industrial bg-black text-white border-black hover:bg-white hover:text-black hover:border-black"
              data-testid="makers-apply-btn"
            >
              Apply as a Maker →
            </a>
            <a
              href="#how-it-works"
              className="btn-industrial border-black text-black hover:bg-black hover:text-[#ff4500] hover:border-black"
              data-testid="makers-how-it-works"
            >
              How it works
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
