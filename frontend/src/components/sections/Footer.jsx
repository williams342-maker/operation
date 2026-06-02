import React from "react";
import { Link } from "react-router-dom";
import { Instagram, Mail, MapPin } from "lucide-react";

const cols = [
  {
    title: "Shop",
    links: [
      { label: "Wall Art", href: "/shop?category=Wall%20Art" },
      { label: "Custom Signs", href: "/shop?category=Custom%20Signs" },
      { label: "Outdoor Art", href: "/shop?category=Outdoor%20Art" },
      { label: "All Listings", href: "/shop" },
    ],
  },
  {
    title: "Makers",
    links: [
      { label: "Apply", href: "/apply" },
      { label: "How it Works", href: "/apply" },
      { label: "Maker Login", href: "/maker/login" },
      { label: "Custom Orders", href: "/custom-order" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "What's New", href: "/updates" },
      { label: "Where We're Going", href: "/grow" },
      { label: "Journal", href: "/journal" },
      { label: "Makers", href: "/makers" },
      { label: "Custom Orders", href: "/custom-order" },
      { label: "Contact", href: "mailto:team@craftersmarket.org" },
    ],
  },
  // SEO landing-page links — buried in the footer specifically for
  // search-engine discovery / link-equity flow. Keep human-readable
  // labels but link directly to the keyword-targeted slugs.
  {
    title: "Explore",
    links: [
      { label: "CNC Metal Art", href: "/cnc-metal-art" },
      { label: "CNC Laser Art", href: "/cnc-laser-art" },
      { label: "CNC Manufacturing", href: "/cnc-manufacturing" },
      { label: "CNC USA", href: "/cnc-usa" },
      { label: "Artisan Marketplace", href: "/artisan-marketplace" },
      { label: "Custom Handmade Goods", href: "/custom-handmade-goods" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative w-full bg-[#0a0a0a] border-t border-[#262626]">
      {/* Grow With Us cinematic CTA band — recruiting surface for
          founding sellers / partners / press. Sits at the top of the
          footer so every page exit funnel touches it. Cyan accent
          matches the /grow page's secondary palette. */}
      <Link
        to="/grow"
        className="group block border-b border-[#262626] hover:border-[#00ffff] transition-colors"
        data-testid="footer-grow-cta"
      >
        <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-8 md:py-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.32em] text-[#00ffff]">
              ◆ The Build Log
            </span>
            <span className="hidden md:inline-block w-px h-4 bg-[#262626]" />
            <span className="font-display text-2xl md:text-3xl lg:text-4xl leading-none tracking-tight group-hover:text-[#00ffff] transition-colors">
              See where we&apos;re going
            </span>
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#a3a3a3] group-hover:text-[#00ffff] transition-colors flex items-center gap-2">
            Public roadmap &amp; founder letter
            <span aria-hidden="true" className="text-[#00ffff] transition-transform group-hover:translate-x-1 inline-block">→</span>
          </span>
        </div>
      </Link>

      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-20">
        <div className="grid md:grid-cols-12 gap-10 mb-16">
          <div className="md:col-span-5">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 border border-[#ff4500] flex items-center justify-center">
                <span className="font-display text-[#ff4500] text-lg">CM</span>
              </div>
              <span className="font-display text-2xl">Crafters Market</span>
            </div>
            <h3 className="font-display text-4xl md:text-6xl leading-[0.95] mb-6">
              Precision craft.
              <br />
              <span className="text-outline-orange">Delivered.</span>
            </h3>
            <p className="font-mono text-sm text-[#a3a3a3] max-w-md leading-relaxed">
              A marketplace connecting buyers with approved CNC artisan makers. Built in workshops.
              Shipped to doorsteps.
            </p>
            <ul className="mt-8 space-y-2 font-mono text-xs uppercase tracking-[0.22em] text-[#a3a3a3]">
              <li className="flex items-center gap-3">
                <Mail size={14} className="text-[#ff4500]" /> team@craftersmarket.org
              </li>
              <li className="flex items-center gap-3">
                <MapPin size={14} className="text-[#ff4500]" /> Continental US · Ships nationwide
              </li>
              <li className="flex items-center gap-3">
                <Instagram size={14} className="text-[#ff4500]" /> @craftersmarket
              </li>
            </ul>
          </div>

          <div className="md:col-span-7 grid grid-cols-2 md:grid-cols-4 gap-8">
            {cols.map((c) => (
              <div key={c.title}>
                <h4 className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-5">
                  {c.title}
                </h4>
                <ul className="space-y-3">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      {l.href.startsWith("mailto:") ? (
                        <a
                          href={l.href}
                          className="industrial-link font-mono text-xs uppercase tracking-[0.2em] text-[#e5e5e5] hover:text-[#ff4500]"
                          data-testid={`footer-link-${l.label.toLowerCase().replace(/\s/g, "-")}`}
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link
                          to={l.href}
                          className="industrial-link font-mono text-xs uppercase tracking-[0.2em] text-[#e5e5e5] hover:text-[#ff4500]"
                          data-testid={`footer-link-${l.label.toLowerCase().replace(/\s/g, "-")}`}
                        >
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Massive type */}
        <div className="border-t border-[#262626] py-12 -mx-4 md:-mx-8 xl:-mx-12 px-4 md:px-8 xl:px-12">
          <div className="font-display text-[18vw] leading-[0.85] text-outline">
            CRAFTERS MARKET
          </div>
        </div>

        <div className="border-t border-[#262626] pt-8 flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          <div className="flex items-center gap-3">
            <span>© {new Date().getFullYear()} Crafters Market · All rights reserved</span>
            {/* Discreet ◆ glyph next to the copyright = admin staff entry
                point. Painted text-[#262626] on the near-black footer so
                it's effectively invisible to visitors but instantly
                recognizable / clickable for the admin team who knows it's
                here. Restored in iter153 after a brief stint as a labeled
                "Admin" link in the bottom-row cluster. */}
            <Link
              to="/admin/login"
              aria-label="Admin login"
              title="Admin"
              className="text-[#262626] hover:text-[#ff4500] transition-colors text-[10px] leading-none select-none"
              data-testid="footer-admin"
            >
              ◆
            </Link>
          </div>
          <div className="flex gap-6 flex-wrap">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("cm:open-live-chat", { detail: { channel: "help" } }))}
              className="hover:text-[#ff4500] cursor-pointer"
              data-testid="footer-live-chat"
            >
              Live chat
            </button>
            <Link to="/updates" className="hover:text-[#ff4500]" data-testid="footer-updates">What's New</Link>
            <a
              href="/fees.pdf"
              target="_blank"
              rel="noopener"
              className="hover:text-[#ff4500]"
              data-testid="footer-pricing"
            >
              Transparent pricing
            </a>
            <Link to="/policy#privacy" className="hover:text-[#ff4500]" data-testid="footer-privacy">Privacy</Link>
            <Link to="/policy#terms" className="hover:text-[#ff4500]" data-testid="footer-terms">Terms</Link>
            <Link to="/policy#returns" className="hover:text-[#ff4500]" data-testid="footer-returns">Returns</Link>
            <Link to="/policy#shipping" className="hover:text-[#ff4500]" data-testid="footer-shipping">Shipping</Link>
            <Link to="/policy#buyer-protection" className="hover:text-[#ff4500]" data-testid="footer-buyer-protection">Buyer Protection</Link>
            <Link to="/policy#maker-agreement" className="hover:text-[#ff4500]" data-testid="footer-maker-agreement">Maker Agreement</Link>
            <Link to="/contact" className="hover:text-[#ff4500]" data-testid="footer-contact">Contact</Link>
            <Link to="/press" className="hover:text-[#ff4500]" data-testid="footer-press">Press</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
