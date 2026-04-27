import React from "react";
import { Camera, Package, DollarSign, Truck, Award, Sparkles, Shield } from "lucide-react";

const GUIDES = [
  {
    icon: Package,
    title: "Post your first listing",
    body: [
      "Open the Listings tab and click + New Listing.",
      "Upload 4–6 photos. The first image is your hero — make it sharp, well-lit, and centered.",
      "Title (max 80 chars): include material + style + use case (e.g., 'Walnut cutting board · live edge · 18in').",
      "Description: lead with the buyer's win, then dimensions, materials, finish, and care.",
      "Set price, stock, and category. Click Publish.",
      "First 10 listings on the Free tier are free for life. After that, $0.20 each.",
    ],
  },
  {
    icon: Camera,
    title: "Photography that sells",
    body: [
      "Natural light beats studio lights for handmade. Shoot near a window, no direct sun.",
      "Use a clean neutral background — white, grey, or wood.",
      "Show scale: include a hand, a cup, or a tape measure in at least one shot.",
      "4 angles minimum: hero, side, detail (texture/grain), and lifestyle (in use).",
      "Square or 4:5 vertical works best on mobile feeds.",
    ],
  },
  {
    icon: DollarSign,
    title: "Pricing without leaving money on the table",
    body: [
      "Materials cost × 3 = your minimum. Triple-cost covers shop overhead, time, and platform fees.",
      "Add 20–30% above your minimum if your work has a signature finish or is in a niche.",
      "Free tier deducts 5% commission + 3% processing = 8% per sale. Plus tier deducts 7%.",
      "On a $100 sale you keep $92 (Free) or $93 (Plus). Plan accordingly.",
      "Don't undercut yourself — raising prices loses 0 buyers; underpricing loses your shop.",
    ],
  },
  {
    icon: Truck,
    title: "Shipping & fulfillment",
    body: [
      "Set your handling time honestly — 1–3 business days is the platform standard.",
      "Buy shipping labels through Stripe or USPS Click-N-Ship. Save the tracking number.",
      "Add tracking to the order from the Orders tab. Buyer gets an automatic email.",
      "Crafters Market ships U.S.-only right now. International is on the roadmap.",
      "Damaged-in-transit insurance: include it on items >$100. It pays for itself.",
    ],
  },
  {
    icon: Award,
    title: "Payouts & taxes",
    body: [
      "Payouts go through Stripe Connect — connect once in Financials → Payouts.",
      "Stripe pays out automatically every 2 business days after the buyer's funds clear.",
      "Crafters Market issues a 1099-K via Stripe if you cross IRS reporting thresholds.",
      "Track your gross revenue in Stats. Save 25–30% for income + self-employment tax.",
    ],
  },
  {
    icon: Sparkles,
    title: "Custom orders",
    body: [
      "Buyers request custom work via the Custom Order page (5-step wizard).",
      "You'll get an email with the brief + reference photos. Reply within 24 hours.",
      "Quote a fixed total or hourly rate. Buyer pays a deposit before you start.",
      "Custom orders count toward your stats and feed the same payout cycle.",
    ],
  },
  {
    icon: Shield,
    title: "What gets your account banned",
    body: [
      "Selling items you didn't make yourself (resale, drop-ship).",
      "Misrepresenting another seller's designs as your own.",
      "Failing to ship orders within the promised time, repeatedly.",
      "Harassing buyers in messages or community chat.",
      "Routing payment off-platform to dodge commission.",
      "Full list: Site Policy → Seller Misconduct.",
    ],
  },
];

/** Help tab — curated guidance for new makers. Static, fast to read. */
export default function HelpTab() {
  return (
    <div className="space-y-8" data-testid="help-tab">
      <header className="pb-6 border-b border-[#262626]">
        <h2 className="font-display text-3xl md:text-4xl uppercase">Help.</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-xl">
          Everything we wish we'd known before opening our first shop.
          Need something specific? Email{" "}
          <a href="mailto:team@craftersmarket.org" className="text-[#ff4500] hover:underline">
            team@craftersmarket.org
          </a>.
        </p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        {GUIDES.map((g) => {
          const Icon = g.icon;
          return (
            <article
              key={g.title}
              className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 md:p-6"
              data-testid={`help-${g.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              <div className="flex items-center gap-3 mb-3">
                <Icon size={18} className="text-[#ff4500] shrink-0" />
                <h3 className="font-display text-xl md:text-2xl uppercase">{g.title}</h3>
              </div>
              <ul className="space-y-2">
                {g.body.map((line, i) => (
                  <li key={i} className="font-mono text-xs text-[#a3a3a3] leading-relaxed flex gap-2">
                    <span className="text-[#ff4500] shrink-0">·</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      <div className="border border-[#ff4500] bg-[#ff4500]/5 p-5 md:p-6 text-center">
        <h3 className="font-display text-xl uppercase mb-2">Still stuck?</h3>
        <p className="font-mono text-xs text-[#a3a3a3] mb-4">
          We answer maker emails within 1 business day. Include your shop name + the listing URL.
        </p>
        <a
          href="mailto:team@craftersmarket.org?subject=Maker%20support%20—%20"
          className="btn-industrial btn-primary inline-flex"
          data-testid="help-contact-btn"
        >
          Email support →
        </a>
      </div>
    </div>
  );
}
