import React, { useState } from "react";
import {
  ChevronDown, Camera, Package, DollarSign, Truck, Award, Sparkles, Shield, Upload,
  Rocket, ImageIcon, Tag, MessageSquare, BarChart3, BookOpen, Mail, FileText,
  Building2, Wrench, ScrollText,
} from "lucide-react";
import CsvImportModal from "./CsvImportModal";

/**
 * Etsy-style Help center.
 *
 * Left rail: collapsible categories (Finances, Listings, Orders, etc.) with
 * indented child links. Right pane: the active guide's content. Mobile
 * collapses to a single accordion.
 *
 * Categories mirror the Etsy reference screenshot pattern (parent + children).
 * Most guides are static markdown-ish text; a few sub-items are actions
 * (e.g. CSV import, Email support) that trigger modals or mailto: links
 * instead of rendering an article.
 */

// Each guide can be one of:
//  - article: free-form rich content rendered in the right pane
//  - action:  triggers a side-effect on click (e.g. opens CSV import modal)
//  - mailto:  pre-filled support email link
const CATEGORIES = [
  {
    id: "getting-started",
    label: "Getting started",
    icon: Rocket,
    children: [
      {
        id: "open-shop",
        label: "Open your shop",
        kind: "article",
        body: {
          title: "Open your shop",
          intro: "From application to first listing in under an hour.",
          steps: [
            "Apply via /apply (or the bold ◆ Beta Signup button) — we review every application personally.",
            "Once approved you'll get a magic-link email. Click it to land in the Shop Manager.",
            "Connect Stripe payouts (Settings → Subscription path → Stripe Connect button) — required to receive money.",
            "Fill out your profile under Settings → About your shop. Buyers trust filled-out shops.",
            "Publish your first 3 listings. The first 10 are free for life.",
          ],
        },
      },
      {
        id: "csv-import",
        label: "Migrate from Etsy or Shopify",
        kind: "action",
        action: "openImport",
        ctaLabel: "Open CSV importer",
        body: {
          title: "Migrate from Etsy or Shopify",
          intro: "Already selling somewhere else? Export your listings as a CSV — we'll import them as drafts you can review before publishing. Etsy and Shopify formats both supported.",
        },
      },
    ],
  },
  {
    id: "listings",
    label: "Listings & photography",
    icon: ImageIcon,
    children: [
      {
        id: "first-listing",
        label: "Post your first listing",
        kind: "article",
        body: {
          title: "Post your first listing",
          intro: "The mechanics of getting a piece live and discoverable.",
          steps: [
            "Open the Listings tab → click + New Listing.",
            "Upload 4–6 photos. The first image is your hero — make it sharp, well-lit, centered.",
            "Title (max 80 chars): include material + style + use case (e.g. 'Walnut cutting board · live edge · 18in').",
            "Description: lead with the buyer's win, then dimensions, materials, finish, care.",
            "Set price, stock, category. Click Publish.",
            "First 10 listings are free for life. After that, $0.20 each.",
          ],
        },
      },
      {
        id: "photography",
        label: "Photography that sells",
        kind: "article",
        body: {
          title: "Photography that sells",
          intro: "You don't need a studio — you need light, space, and 4 angles.",
          steps: [
            "Natural light beats studio lights for handmade. Shoot near a window, no direct sun.",
            "Use a clean neutral background — white, grey, or wood.",
            "Show scale: include a hand, cup, or tape measure in at least one shot.",
            "4 angles minimum: hero, side, detail (texture/grain), lifestyle (in use).",
            "Square or 4:5 vertical works best on mobile feeds.",
          ],
        },
      },
      {
        id: "seo-tags",
        label: "SEO & search tags",
        kind: "article",
        body: {
          title: "SEO & search tags",
          intro: "How buyers actually find you.",
          steps: [
            "Tags are buyer search terms, not your jargon. 'Wood lamp' beats 'walnut cnc-engraved illumination accessory'.",
            "Use all 13 tag slots. Leaving slots empty is leaving traffic on the table.",
            "Rotate seasonal tags (Christmas gift, Father's Day, housewarming) on relevant items.",
            "The Marketing tab has an AI Bulk SEO tool — generate tags for all your listings in one click.",
          ],
        },
      },
    ],
  },
  {
    id: "orders",
    label: "Orders & shipping",
    icon: Truck,
    children: [
      {
        id: "shipping",
        label: "Shipping & fulfillment",
        kind: "article",
        body: {
          title: "Shipping & fulfillment",
          intro: "Honest handling times build trust. Tracking numbers prevent disputes.",
          steps: [
            "Set your handling time honestly — 1–3 business days is the platform standard.",
            "Buy shipping labels through Stripe or USPS Click-N-Ship. Save the tracking number.",
            "Add tracking to the order from the Orders tab. Buyer gets an automatic email.",
            "U.S.-only shipping right now. International is on the roadmap.",
            "Damaged-in-transit insurance: include it on items >$100. Pays for itself.",
          ],
        },
      },
      {
        id: "custom-orders",
        label: "Custom orders",
        kind: "article",
        body: {
          title: "Custom orders",
          intro: "Bespoke work, on the same payout cycle.",
          steps: [
            "Buyers request custom work via the Custom Order page (5-step wizard).",
            "You'll get an email with the brief + reference photos. Reply within 24 hours.",
            "Quote a fixed total or hourly rate. Buyer pays a deposit before you start.",
            "Custom orders count toward your stats and feed the same Stripe payout cycle.",
          ],
        },
      },
    ],
  },
  {
    id: "finances",
    label: "Finances",
    icon: Building2,
    children: [
      {
        id: "pricing",
        label: "Pricing without leaving money on the table",
        kind: "article",
        body: {
          title: "Pricing without leaving money on the table",
          intro: "If you're not sure what to charge, you're charging too little.",
          steps: [
            "Materials cost × 3 = your minimum. Triple-cost covers shop overhead, time, and platform fees.",
            "Add 20–30% above minimum if your work has a signature finish or is in a niche.",
            "Free tier deducts 5% commission + 3% processing = 8% per sale. Plus tier deducts 7%.",
            "On a $100 sale you keep $92 (Free) or $93 (Plus). Plan accordingly.",
            "Don't undercut yourself — raising prices loses 0 buyers; underpricing loses your shop.",
          ],
        },
      },
      {
        id: "payouts",
        label: "Payouts & taxes",
        kind: "article",
        body: {
          title: "Payouts & taxes",
          intro: "How your money actually gets to your bank, and what to set aside.",
          steps: [
            "Payouts go through Stripe Connect — connect once in Financials → Payouts.",
            "Stripe pays out automatically every 2 business days after the buyer's funds clear.",
            "Crafters Market issues a 1099-K via Stripe if you cross IRS reporting thresholds.",
            "Track gross revenue in Stats. Save 25–30% for income + self-employment tax.",
          ],
        },
      },
    ],
  },
  {
    id: "marketing",
    label: "Marketing & growth",
    icon: BarChart3,
    children: [
      {
        id: "newsletter",
        label: "Newsletter & buyer retention",
        kind: "article",
        body: {
          title: "Newsletter & buyer retention",
          intro: "Repeat buyers are 3× more profitable than new ones.",
          steps: [
            "Crafters Market auto-syncs your buyers to a newsletter list (via Kit.com) — opt-in only.",
            "Send a 'new piece' campaign every 2–3 weeks. Don't blast daily; that kills open rates.",
            "Dormant-buyer retention: we auto-tag buyers who haven't ordered in 60 days. You get a nudge tool to send them a 10% discount code.",
          ],
        },
      },
      {
        id: "off-site-ads",
        label: "Off-site ads",
        kind: "article",
        body: {
          title: "Off-site ads",
          intro: "We pay to bring buyers in — you only pay if they buy.",
          steps: [
            "Crafters Market runs paid ads on Google + Meta on the platform's behalf.",
            "If a buyer arrives via off-site ad and orders, we deduct a 12% off-site ad fee from that order's payout.",
            "Free-tier sellers can opt out (Settings → Options → 'Opt out of off-site ads') — no surcharge, but no traffic boost either.",
          ],
        },
      },
    ],
  },
  {
    id: "policy",
    label: "Policy & account",
    icon: Shield,
    children: [
      {
        id: "violations",
        label: "What gets your account banned",
        kind: "article",
        body: {
          title: "What gets your account banned",
          intro: "Be transparent, ship on time, treat buyers right. Almost everything else is fine.",
          steps: [
            "Selling items you didn't make yourself (resale, drop-ship).",
            "Misrepresenting another seller's designs as your own.",
            "Failing to ship orders within the promised time, repeatedly.",
            "Harassing buyers in messages or community chat.",
            "Routing payment off-platform to dodge commission.",
            "Full list: Site Policy → Seller Misconduct.",
          ],
        },
      },
      {
        id: "security",
        label: "Account security",
        kind: "article",
        body: {
          title: "Account security",
          intro: "Your shop is your livelihood. Treat the password accordingly.",
          steps: [
            "Use a unique password (≥10 chars). A password manager is the easiest way to do this.",
            "Magic-link login is available — no password needed, just email.",
            "Admin accounts are forced to rotate their password every 30 days. Maker accounts are not (yet).",
            "If you suspect a leak: hit Forgot Password from /maker/login → reset → done.",
          ],
        },
      },
    ],
  },
  {
    id: "support",
    label: "Contact support",
    icon: Mail,
    children: [
      {
        id: "email-support",
        label: "Email support",
        kind: "mailto",
        href: "mailto:team@craftersmarket.org?subject=Maker%20support%20%E2%80%94%20",
        body: {
          title: "Email support",
          intro: "We answer within 1 business day. Include your shop name + the listing URL if relevant.",
        },
      },
    ],
  },
];

// Flatten for quick lookup by leaf id.
const ALL_LEAVES = Object.fromEntries(
  CATEGORIES.flatMap((c) => c.children.map((ch) => [ch.id, { ...ch, parent: c.id }])),
);

export default function HelpTab() {
  const [activeId, setActiveId] = useState(CATEGORIES[0].children[0].id);
  // Categories user has expanded — default: just the active one's parent.
  const [openCategories, setOpenCategories] = useState(() =>
    new Set([CATEGORIES.find((c) => c.children.some((ch) => ch.id === CATEGORIES[0].children[0].id)).id]),
  );
  const [importing, setImporting] = useState(false);

  const active = ALL_LEAVES[activeId] || ALL_LEAVES[CATEGORIES[0].children[0].id];

  const toggleCategory = (id) =>
    setOpenCategories((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handlePick = (leaf) => {
    setActiveId(leaf.id);
    if (leaf.kind === "action" && leaf.action === "openImport") {
      setImporting(true);
    }
  };

  return (
    <div className="space-y-8" data-testid="help-tab">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
          ◆ Shop Manager · Help
        </div>
        <h1 className="font-display text-3xl md:text-5xl uppercase leading-[0.95]">
          Help Center.
        </h1>
        <p className="font-mono text-sm text-[#a3a3a3] mt-2 max-w-2xl">
          Everything we wish we'd known before opening our first shop. Pick a topic
          on the left.
        </p>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-6">
        {/* Sub-nav */}
        <HelpSubNav
          categories={CATEGORIES}
          activeId={activeId}
          openCategories={openCategories}
          onToggleCategory={toggleCategory}
          onPick={handlePick}
        />

        {/* Active leaf content */}
        <div className="min-w-0" data-testid={`help-leaf-${active.id}`}>
          <ArticlePane
            leaf={active}
            onAction={(leaf) => {
              if (leaf.action === "openImport") setImporting(true);
            }}
          />
        </div>
      </div>

      {importing && (
        <CsvImportModal
          onClose={() => setImporting(false)}
          onImported={() => setImporting(false)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-nav — collapsible categories, Etsy-style
// ============================================================================
function HelpSubNav({ categories, activeId, openCategories, onToggleCategory, onPick }) {
  return (
    <>
      {/* Mobile: flat select */}
      <div className="lg:hidden">
        <select
          value={activeId}
          onChange={(e) => {
            const leaf = categories
              .flatMap((c) => c.children)
              .find((ch) => ch.id === e.target.value);
            if (leaf) onPick(leaf);
          }}
          className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5]"
          data-testid="help-subnav-mobile"
        >
          {categories.map((c) => (
            <optgroup key={c.id} label={c.label}>
              {c.children.map((ch) => (
                <option key={ch.id} value={ch.id}>{ch.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Desktop: collapsible categories */}
      <nav
        className="hidden lg:block bg-[#0d0d0d] border border-[#1f1f1f] p-2 self-start"
        data-testid="help-subnav"
      >
        {categories.map((c) => {
          const Icon = c.icon;
          const isOpen = openCategories.has(c.id);
          const containsActive = c.children.some((ch) => ch.id === activeId);
          return (
            <div key={c.id} data-testid={`help-cat-${c.id}`}>
              <button
                type="button"
                onClick={() => onToggleCategory(c.id)}
                aria-expanded={isOpen}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] transition border-l-2 ${
                  containsActive
                    ? "border-[#ff4500] text-[#e5e5e5]"
                    : "border-transparent text-[#a3a3a3] hover:text-[#e5e5e5] hover:bg-[#161616]"
                }`}
                data-testid={`help-cat-${c.id}-toggle`}
              >
                <Icon size={14} className="shrink-0" />
                <span className="flex-1 truncate">{c.label}</span>
                <ChevronDown
                  size={12}
                  className={`opacity-60 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isOpen && (
                <ul className="pb-1.5">
                  {c.children.map((ch) => {
                    const isActive = ch.id === activeId;
                    return (
                      <li key={ch.id}>
                        <button
                          type="button"
                          onClick={() => onPick(ch)}
                          className={`w-full text-left pl-10 pr-3 py-2 font-mono text-[11px] tracking-[0.04em] transition ${
                            isActive
                              ? "bg-[#ff4500]/10 text-[#ff4500]"
                              : "text-[#a3a3a3] hover:text-[#e5e5e5] hover:bg-[#161616]"
                          }`}
                          data-testid={`help-leaf-link-${ch.id}`}
                        >
                          {ch.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </>
  );
}

// ============================================================================
// Right pane — renders the active guide
// ============================================================================
function ArticlePane({ leaf, onAction }) {
  const { body, kind } = leaf;
  return (
    <article className="border border-[#262626] p-5 md:p-7 space-y-5">
      <header className="border-b border-[#1f1f1f] pb-4">
        <h2 className="font-display text-2xl md:text-3xl uppercase leading-[1.05]">
          {body?.title || leaf.label}
        </h2>
        {body?.intro && (
          <p className="font-mono text-xs text-[#a3a3a3] mt-2 leading-relaxed">{body.intro}</p>
        )}
      </header>

      {body?.steps?.length > 0 && (
        <ul className="space-y-2.5" data-testid="help-article-steps">
          {body.steps.map((line, i) => (
            <li key={i} className="font-mono text-xs text-[#e5e5e5] leading-relaxed flex gap-3">
              <span className="text-[#ff4500] shrink-0 font-bold">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      {kind === "action" && (
        <div className="pt-3">
          <button
            onClick={() => onAction?.(leaf)}
            className="btn-industrial btn-primary"
            data-testid={`help-action-${leaf.id}`}
          >
            {leaf.ctaLabel || "Open"}
          </button>
        </div>
      )}

      {kind === "mailto" && (
        <div className="pt-3">
          <a
            href={leaf.href}
            className="btn-industrial btn-primary inline-flex"
            data-testid={`help-mailto-${leaf.id}`}
          >
            Email support →
          </a>
        </div>
      )}

      <footer className="border-t border-[#1f1f1f] pt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-[#525252] flex items-center gap-2">
        <span>◇ Was this helpful?</span>
        <a
          href={`mailto:team@craftersmarket.org?subject=Help%20feedback%20%E2%80%94%20${encodeURIComponent(body?.title || leaf.label)}`}
          className="text-[#a3a3a3] hover:text-[#ff4500] transition"
          data-testid={`help-feedback-${leaf.id}`}
        >
          Send feedback →
        </a>
      </footer>
    </article>
  );
}
