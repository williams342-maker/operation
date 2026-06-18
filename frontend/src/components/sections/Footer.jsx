import React from "react";
import { Link } from "react-router-dom";
import { Instagram, Mail, MapPin } from "lucide-react";
import { reopenBanner } from "../../lib/consent";

// iter413at — Live CI badge that fetches /api/ci/health on mount.
// Renders a discreet mono-caps line under the brand tagline. Fails open:
// hides itself if the endpoint 404s or returns unparseable JSON.
function CIBadge() {
  const [stats, setStats] = React.useState(null);
  React.useEffect(() => {
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/ci/health`;
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && d.passed && setStats(d))
      .catch(() => {});
  }, []);
  if (!stats) return null;
  const color =
    stats.status === "green"
      ? "text-brand"
      : stats.status === "yellow"
        ? "text-warn"
        : "text-danger";
  return (
    <div
      className="font-mono text-[10px] uppercase tracking-[0.32em] text-ink-muted mt-2"
      data-testid="footer-ci-badge"
    >
      <span className={color}>●</span>{" "}
      {stats.passed.toLocaleString()} tests passing · {stats.pass_rate}% green
    </div>
  );
}

const cols = [
  {
    title: "Shop",
    links: [
      { label: "Wall Art", href: "/shop?category=Wall%20Art" },
      { label: "Custom Signs", href: "/shop?category=Custom%20Signs" },
      { label: "Outdoor Art", href: "/shop?category=Outdoor%20Art" },
      { label: "Jewelry & Wearables", href: "/shop?category=Jewelry%20%26%20Wearables" },
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
  //
  // iter321: rotated to surface the 5 new high-intent category pages
  // (plasma-cut wall art, CNC wood signs, laser engraved gifts, custom
  // address signs, engraved cutting boards) alongside the older slugs.
  {
    title: "Browse by Craft",
    links: [
      { label: "Plasma Cut Wall Art", href: "/plasma-cut-wall-art" },
      { label: "CNC Wood Signs", href: "/cnc-wood-signs" },
      { label: "Laser Engraved Gifts", href: "/laser-engraved-gifts" },
      { label: "Custom Address Signs", href: "/custom-address-signs" },
      { label: "Engraved Cutting Boards", href: "/engraved-cutting-boards" },
      { label: "Custom Metal Signs", href: "/custom-metal-signs" },
    ],
  },
  // iter411: surface the newly-broadened craft categories (Woodworking,
  // Pottery, Jewelry, Leather, Fiber) so crawler link-equity flows to
  // the new SEO landing pages from every page of the site.
  {
    title: "Handmade by Category",
    links: [
      { label: "Handmade Woodworking", href: "/handmade-woodworking" },
      { label: "Handmade Pottery", href: "/handmade-pottery" },
      { label: "Handmade Jewelry", href: "/handmade-jewelry" },
      { label: "Leather Goods", href: "/leather-goods" },
      { label: "Handmade Textiles", href: "/handmade-textiles" },
      { label: "Artisan Marketplace", href: "/artisan-marketplace" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative w-full cm-footer-dark bg-paper border-t border-line">
      {/* Grow With Us cinematic CTA band — recruiting surface for
          founding sellers / partners / press. Sits at the top of the
          footer so every page exit funnel touches it. Cyan accent
          matches the /grow page's secondary palette. */}
      <Link
        to="/grow"
        className="group block border-b border-line hover:border-[#00ffff] transition-colors"
        data-testid="footer-grow-cta"
      >
        <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-8 md:py-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.32em] text-[#00ffff]">
              ◆ The Build Log
            </span>
            <span className="hidden md:inline-block w-px h-4 bg-line" />
            <span className="font-display text-2xl md:text-3xl lg:text-4xl leading-none tracking-tight group-hover:text-[#00ffff] transition-colors">
              See where we&apos;re going
            </span>
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-ink-muted group-hover:text-[#00ffff] transition-colors flex items-center gap-2">
            Public roadmap &amp; founder letter
            <span aria-hidden="true" className="text-[#00ffff] transition-transform group-hover:translate-x-1 inline-block">→</span>
          </span>
        </div>
      </Link>

      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-20">
        <div className="grid md:grid-cols-12 gap-10 mb-16">
          <div className="md:col-span-5">
            <div className="flex items-center gap-3 mb-6">
              {/* iter413ag — rebranded monogram. */}
              <img
                src="/icons/logo-monogram-transparent.png"
                alt="Crafters Market"
                width="40"
                height="40"
                className="w-10 h-10 object-contain"
              />
              <span className="font-display text-2xl">Crafters Market</span>
            </div>
            <h3 className="font-display text-4xl md:text-6xl leading-[0.95] mb-6">
              Precision craft.
              <br />
              <span className="text-outline-orange">Delivered.</span>
            </h3>
            <p className="font-mono text-sm text-ink-muted max-w-md leading-relaxed">
              A marketplace connecting buyers with approved CNC artisan makers. Built in workshops.
              Shipped to doorsteps.
            </p>
            {/* iter321 — Trust / business-model strip. Loud and unambiguous:
                makers keep 95% of every sale. No listing fees, no setup.
                Surfaces the same message we publish in /fees.pdf so the
                value prop is visible without a click. */}
            <div
              className="mt-6 border border-brand/40 bg-brand/[0.06] p-4 max-w-md"
              data-testid="footer-business-model"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2">
                ◆ How we make money
              </div>
              <p className="font-mono text-xs text-ink leading-relaxed">
                <span className="text-ink font-bold">Makers keep 95%.</span>{" "}
                We take a flat <span className="text-ink font-bold">5% platform fee</span> — no
                listing fees, no setup costs, no hidden surcharges. Plus &amp; Founder makers pay
                even less.{" "}
                <a
                  href="/fees.pdf"
                  target="_blank"
                  rel="noopener"
                  className="text-brand hover:text-ink underline underline-offset-2"
                  data-testid="footer-fees-pdf-link"
                >
                  See the full pricing PDF →
                </a>
              </p>
            </div>
            <ul className="mt-8 space-y-2 font-mono text-xs uppercase tracking-[0.22em] text-ink-muted">
              <li className="flex items-center gap-3">
                <Mail size={14} className="text-brand" /> team@craftersmarket.org
              </li>
              <li className="flex items-center gap-3">
                <MapPin size={14} className="text-brand" /> Continental US · Ships nationwide
              </li>
              <li className="flex items-center gap-3">
                <a
                  href="https://instagram.com/team_craftersmarket"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 hover:text-brand transition-colors"
                  data-testid="footer-instagram-link"
                >
                  <Instagram size={14} className="text-brand" /> @team_craftersmarket
                </a>
              </li>
            </ul>
          </div>

          <div className="md:col-span-7 grid grid-cols-2 md:grid-cols-4 gap-8">
            {cols.map((c) => (
              <div key={c.title}>
                <h4 className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-5">
                  {c.title}
                </h4>
                <ul className="space-y-3">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      {l.href.startsWith("mailto:") ? (
                        <a
                          href={l.href}
                          className="industrial-link font-mono text-xs uppercase tracking-[0.2em] text-ink hover:text-brand"
                          data-testid={`footer-link-${l.label.toLowerCase().replace(/\s/g, "-")}`}
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link
                          to={l.href}
                          className="industrial-link font-mono text-xs uppercase tracking-[0.2em] text-ink hover:text-brand"
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

        {/* Massive type — Aged Canvas watermark (iter369). Single line in
            a low-opacity burnt-copper fill (like a maker's stamp pressed
            into the charcoal), replacing the old hollow 18vw outline that
            wrapped to two harsh lines and read as leftover dark-industrial
            branding. Mono caption above ties it to the site's ◆ label
            language. */}
        <div className="border-t border-line py-10 -mx-4 md:-mx-8 xl:-mx-12 px-4 md:px-8 xl:px-12 overflow-hidden text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-ink-muted mb-4">
            ◆ Est · 2026 — Built in workshops · Shipped to doorsteps
          </div>
          <div
            className="font-display text-[10vw] leading-[0.9] tracking-tight whitespace-nowrap text-brand/25 select-none"
            aria-hidden="true"
            data-testid="footer-wordmark"
          >
            CRAFTERS MARKET
          </div>
          {/* iter413ag — new brand tagline alongside the rebrand. Sits
              under the giant wordmark so it reads as the literal
              "byline" of the brand, not a marketing claim. Mono caps
              for the same chevron-language as the eyebrow above. */}
          <div
            className="font-mono text-[10px] uppercase tracking-[0.32em] text-brand mt-3"
            data-testid="footer-brand-tagline"
          >
            Built on craft · Driven by makers
          </div>
        </div>

        <div className="border-t border-line pt-8 flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted">
          <div className="flex items-center gap-3">
            <span>© {new Date().getFullYear()} Crafters Market · All rights reserved</span>
            {/* Discreet ◆ glyph next to the copyright = admin staff entry
                point. Painted text-ink-muted/40 on the near-black footer so
                it's effectively invisible to visitors but instantly
                recognizable / clickable for the admin team who knows it's
                here. Restored in iter153 after a brief stint as a labeled
                "Admin" link in the bottom-row cluster. */}
            <Link
              to="/admin/login"
              aria-label="Admin login"
              title="Admin"
              className="text-ink-muted/40 hover:text-brand transition-colors text-[10px] leading-none select-none"
              data-testid="footer-admin"
            >
              ◆
            </Link>
          </div>
          <div className="flex gap-6 flex-wrap">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("cm:open-live-chat", { detail: { channel: "help" } }))}
              className="hover:text-brand cursor-pointer"
              data-testid="footer-live-chat"
            >
              Live chat
            </button>
            <Link to="/updates" className="hover:text-brand" data-testid="footer-updates">What's New</Link>
            <a
              href="/fees.pdf"
              target="_blank"
              rel="noopener"
              className="hover:text-brand"
              data-testid="footer-pricing"
            >
              Transparent pricing
            </a>
            <Link to="/policy#privacy" className="hover:text-brand" data-testid="footer-privacy">Privacy</Link>
            <Link to="/policy#terms" className="hover:text-brand" data-testid="footer-terms">Terms</Link>
            <Link to="/policy#returns" className="hover:text-brand" data-testid="footer-returns">Returns</Link>
            <Link to="/policy#shipping" className="hover:text-brand" data-testid="footer-shipping">Shipping</Link>
            <Link to="/policy#buyer-protection" className="hover:text-brand" data-testid="footer-buyer-protection">Buyer Protection</Link>
            <Link to="/policy#maker-agreement" className="hover:text-brand" data-testid="footer-maker-agreement">Maker Agreement</Link>
            <Link to="/contact" className="hover:text-brand" data-testid="footer-contact">Contact</Link>
            <Link to="/pricing" className="hover:text-brand" data-testid="footer-pricing">Pricing</Link>
            <Link to="/press" className="hover:text-brand" data-testid="footer-press">Press</Link>
            {/* iter334e — Re-opens the GDPR cookie banner so users can
                change their analytics + ads consent any time. */}
            <button
              type="button"
              onClick={reopenBanner}
              className="hover:text-brand cursor-pointer bg-transparent border-none p-0 font-inherit text-inherit text-left"
              data-testid="footer-cookie-preferences"
            >
              Cookie preferences
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
