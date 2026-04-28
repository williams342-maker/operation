import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, ArrowDown } from "lucide-react";

const HERO_BG =
  "https://images.unsplash.com/photo-1745448797900-35d08e85e9db?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1NzZ8MHwxfHNlYXJjaHwxfHx3ZWxkaW5nJTIwc3BhcmtzJTIwZGFyayUyMGluZHVzdHJpYWx8ZW58MHx8fHwxNzc3MTU0OTg0fDA&ixlib=rb-4.1.0&q=85";

// Curated "popular" pills for the home page hero. Keep this list short
// (3-4 items) so the row stays clean and scannable on every breakpoint —
// the full 16-category list is exposed on /shop and inside the maker
// listing editor, not here. Adding pills here is a deliberate marketing
// decision, not a passthrough of the full taxonomy.
const PILLS = ["Wall Art", "Custom Signs", "Outdoor Art"];

export default function Hero() {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const onSearch = (e) => {
    e.preventDefault();
    nav(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : "/shop");
  };

  return (
    <section id="top" className="relative w-full min-h-[88svh] overflow-hidden" data-testid="hero-section">
      <div className="absolute inset-0">
        <img src={HERO_BG} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/65 to-[#0a0a0a]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,69,0,0.18),transparent_55%)]" />
      </div>

      <div className="relative z-10 w-full max-w-[1400px] mx-auto px-4 md:px-8 pt-44 md:pt-52 pb-20 text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-6"
        >
          ◆ A marketplace for precision craft
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.9 }}
          className="font-display text-[56px] sm:text-[80px] md:text-[120px] lg:text-[148px] leading-[0.92]"
        >
          Find Something <span className="text-[#ff4500]">Built</span>
          <br /><span className="text-outline">By Hand.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.7 }}
          className="font-mono text-sm md:text-base text-[#a3a3a3] max-w-xl mx-auto mt-6"
        >
          Hand-finished metal & wood pieces from approved CNC artisans. Built to order. Shipped nationwide.
        </motion.p>

        <motion.form
          onSubmit={onSearch}
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.7 }}
          className="mt-10 max-w-2xl mx-auto flex items-stretch border border-[#262626] bg-black/60 backdrop-blur-md focus-within:border-[#ff4500] transition"
          data-testid="hero-search-form"
        >
          <Search size={16} className="ml-4 self-center text-[#a3a3a3]" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search wall art, custom signs, address numbers…"
            data-testid="hero-search-input"
            className="flex-1 bg-transparent px-4 py-4 font-mono text-sm outline-none placeholder:text-[#525252]"
          />
          <button type="submit" data-testid="hero-search-btn" className="px-6 md:px-8 bg-[#ff4500] text-white font-mono text-xs uppercase tracking-[0.22em] hover:bg-[#cc3700] transition">
            Search →
          </button>
        </motion.form>

        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="mt-6 flex flex-wrap items-center justify-center gap-2"
          data-testid="hero-pills"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#525252] mr-2">Popular →</span>
          {PILLS.map((p) => (
            <button
              key={p} onClick={() => nav(`/shop?q=${encodeURIComponent(p)}`)}
              className="px-3 py-1.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] transition"
            >{p}</button>
          ))}
        </motion.div>

        <div className="mt-16 flex items-center justify-center gap-8 font-mono text-[10px] uppercase tracking-[0.25em] text-[#525252]">
          <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-[#ff4500] animate-pulse" /> 12 makers · live now</span>
          <span className="hidden md:inline">Plasma · Laser · Router</span>
          <span className="hidden md:flex items-center gap-2"><ArrowDown size={12} /> Scroll</span>
        </div>
      </div>
    </section>
  );
}
