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
      { label: "Journal", href: "/journal" },
      { label: "Makers", href: "/makers" },
      { label: "Custom Orders", href: "/custom-order" },
      { label: "Contact", href: "mailto:team@craftersmarket.org" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative w-full bg-[#0a0a0a] border-t border-[#262626]">
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

          <div className="md:col-span-7 grid grid-cols-3 gap-8">
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
            {/* Hidden admin entry — unlabeled brand-mark icon. Internal staff
                learn this once. Reduces bot noise + keeps /signin clean for
                buyer/maker conversion. */}
            <Link
              to="/admin/login"
              aria-label="Staff access"
              title=""
              className="inline-flex items-center justify-center w-3 h-3 text-[#262626] hover:text-[#ff4500] transition-colors"
              data-testid="footer-admin-glyph"
            >
              <span className="text-[10px] leading-none select-none">◆</span>
            </Link>
          </div>
          <div className="flex gap-6">
            <Link to="/policy" className="hover:text-[#ff4500]" data-testid="footer-privacy">Privacy</Link>
            <Link to="/policy" className="hover:text-[#ff4500]" data-testid="footer-terms">Terms</Link>
            <Link to="/contact" className="hover:text-[#ff4500]" data-testid="footer-contact">Contact</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
