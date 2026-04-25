import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";

const links = [
  { label: "Showcase", href: "#showcase" },
  { label: "Categories", href: "#categories" },
  { label: "Process", href: "#process" },
  { label: "For Makers", href: "#makers" },
  { label: "Custom", href: "#custom" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
      className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-500 ${
        scrolled ? "bg-black/85 backdrop-blur-xl border-b border-[#262626]" : "bg-transparent"
      }`}
      data-testid="site-nav"
    >
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 flex items-center justify-between py-5">
        <a href="#top" className="flex items-center gap-3 group" data-testid="nav-logo">
          <div className="w-9 h-9 border border-[#ff4500] flex items-center justify-center">
            <span className="font-display text-[#ff4500] text-xl">CM</span>
          </div>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="font-display text-lg tracking-wide">Crafters Market</span>
            <span className="font-mono text-[10px] text-[#a3a3a3] tracking-[0.25em] uppercase mt-1">
              EST · Precision Craft
            </span>
          </div>
        </a>

        <nav className="hidden lg:flex items-center gap-10" data-testid="nav-links">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="industrial-link font-mono text-xs uppercase tracking-[0.22em] text-[#e5e5e5] hover:text-[#ff4500]"
              data-testid={`nav-link-${l.label.toLowerCase().replace(/\s/g, "-")}`}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="#shop"
            className="hidden md:inline-flex btn-industrial btn-primary"
            data-testid="nav-shop-btn"
          >
            Shop All <span aria-hidden>→</span>
          </a>
          <button
            onClick={() => setOpen(true)}
            className="lg:hidden p-2 border border-[#262626] hover:border-[#ff4500] transition"
            aria-label="Open menu"
            data-testid="nav-mobile-open"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black"
            data-testid="mobile-menu"
          >
            <div className="flex justify-between items-center px-6 py-5 border-b border-[#262626]">
              <span className="font-display text-2xl">Crafters Market</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" data-testid="nav-mobile-close">
                <X size={24} />
              </button>
            </div>
            <ul className="flex flex-col p-8 gap-6">
              {links.map((l, i) => (
                <motion.li
                  key={l.href}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07 }}
                >
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="font-display text-5xl block hover:text-[#ff4500] transition"
                  >
                    {l.label}
                  </a>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
