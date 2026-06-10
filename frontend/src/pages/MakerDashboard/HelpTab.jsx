import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, Camera, Package, DollarSign, Truck, Award, Sparkles, Shield, Upload,
  Rocket, ImageIcon, Tag, MessageSquare, BarChart3, BookOpen, Mail, FileText,
  Building2, Wrench, ScrollText, Search, X,
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
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);

  // Cmd/Ctrl+K focuses the search box. Esc clears it. The keyboard shortcut
  // is one of the things that makes a help center feel "fast" instead of
  // "clicky", so the muscle-memory cost is worth it.
  useEffect(() => {
    const onKey = (e) => {
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (cmdK) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Build a filtered category tree based on the query. Match against:
  //  - Category label
  //  - Leaf label
  //  - Body title + intro
  //  - Every step in body.steps
  // Returns the same shape as `CATEGORIES` but with only matching leaves.
  // Empty query short-circuits to the unfiltered tree.
  const { filtered, matchCount, isSearching } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { filtered: CATEGORIES, matchCount: 0, isSearching: false };
    const matches = (s) => (s || "").toLowerCase().includes(q);
    let count = 0;
    const trimmed = CATEGORIES.map((c) => {
      const catMatch = matches(c.label);
      const kids = c.children.filter((ch) => {
        if (catMatch) return true;
        if (matches(ch.label)) return true;
        if (matches(ch.body?.title)) return true;
        if (matches(ch.body?.intro)) return true;
        if ((ch.body?.steps || []).some(matches)) return true;
        return false;
      });
      count += kids.length;
      return kids.length > 0 ? { ...c, children: kids } : null;
    }).filter(Boolean);
    return { filtered: trimmed, matchCount: count, isSearching: true };
  }, [query]);

  // When searching, auto-expand every matching category so results are
  // visible without an extra click.
  const effectiveOpen = useMemo(() => {
    if (!isSearching) return openCategories;
    return new Set(filtered.map((c) => c.id));
  }, [isSearching, filtered, openCategories]);

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
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
          ◆ Shop Manager · Help
        </div>
        <h1 className="font-display text-3xl md:text-5xl uppercase leading-[0.95]">
          Help Center.
        </h1>
        <p className="font-mono text-sm text-ink-muted mt-2 max-w-2xl">
          Everything we wish we'd known before opening our first shop. Pick a topic
          on the left, or search across every article.
        </p>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-6">
        {/* Sub-nav */}
        <HelpSubNav
          categories={filtered}
          activeId={activeId}
          openCategories={effectiveOpen}
          onToggleCategory={toggleCategory}
          onPick={handlePick}
          query={query}
          setQuery={setQuery}
          searchRef={searchRef}
          isSearching={isSearching}
          matchCount={matchCount}
        />

        {/* Active leaf content */}
        <div className="min-w-0" data-testid={`help-leaf-${active.id}`}>
          {isSearching && matchCount === 0 ? (
            <NoResults query={query} onClear={() => setQuery("")} />
          ) : (
            <ArticlePane
              leaf={active}
              query={query}
              onAction={(leaf) => {
                if (leaf.action === "openImport") setImporting(true);
              }}
            />
          )}
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
function HelpSubNav({ categories, activeId, openCategories, onToggleCategory, onPick, query, setQuery, searchRef, isSearching, matchCount }) {
  return (
    <div className="space-y-3">
      {/* Search box — Cmd/Ctrl+K to focus, Esc to clear. Live-filters
          categories AND right-pane content match-count messaging. */}
      <div className="relative" data-testid="help-search-wrap">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help…"
          aria-label="Search help articles"
          className="w-full bg-paper border border-line focus:border-brand outline-none pl-9 pr-16 py-2.5 font-mono text-xs text-ink placeholder:text-ink-muted"
          data-testid="help-search-input"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-brand transition"
            aria-label="Clear search"
            data-testid="help-search-clear"
          >
            <X size={14} />
          </button>
        ) : (
          <kbd className="hidden md:inline-flex absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 border border-line font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">
            ⌘K
          </kbd>
        )}
      </div>
      {isSearching && (
        <div
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand px-1"
          data-testid="help-search-result-count"
        >
          ◆ {matchCount} match{matchCount === 1 ? "" : "es"}
        </div>
      )}

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
          className="w-full bg-paper border border-line focus:border-brand outline-none px-4 py-3 font-mono text-sm text-ink"
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
        className="hidden lg:block bg-paper border border-line p-2 self-start"
        data-testid="help-subnav"
      >
        {categories.length === 0 ? (
          <div className="px-3 py-6 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted" data-testid="help-subnav-empty">
            No matches.
          </div>
        ) : (
          categories.map((c) => {
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
                      ? "border-brand text-ink"
                      : "border-transparent text-ink-muted hover:text-ink hover:bg-surface"
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
                                ? "bg-brand/10 text-brand"
                                : "text-ink-muted hover:text-ink hover:bg-surface"
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
          })
        )}
      </nav>
    </div>
  );
}

// Empty-state right-pane shown only when search query has zero results.
function NoResults({ query, onClear }) {
  return (
    <div
      className="border border-dashed border-line p-10 text-center"
      data-testid="help-no-results"
    >
      <Search size={28} className="mx-auto text-ink-muted mb-3" />
      <h2 className="font-display text-2xl uppercase mb-2">
        No help articles match "<span className="text-brand">{query}</span>"
      </h2>
      <p className="font-mono text-xs text-ink-muted max-w-md mx-auto mb-5 leading-relaxed">
        Try a broader term, or email{" "}
        <a href="mailto:team@craftersmarket.org" className="text-brand hover:underline">
          team@craftersmarket.org
        </a>{" "}
        — we usually reply within a business day.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="px-4 py-2 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
        data-testid="help-no-results-clear"
      >
        Clear search →
      </button>
    </div>
  );
}

// ============================================================================
// Right pane — renders the active guide
// ============================================================================
function ArticlePane({ leaf, query, onAction }) {
  const { body, kind } = leaf;
  return (
    <article className="border border-line p-5 md:p-7 space-y-5">
      <header className="border-b border-line pb-4">
        <h2 className="font-display text-2xl md:text-3xl uppercase leading-[1.05]">
          <Highlight text={body?.title || leaf.label} query={query} />
        </h2>
        {body?.intro && (
          <p className="font-mono text-xs text-ink-muted mt-2 leading-relaxed">
            <Highlight text={body.intro} query={query} />
          </p>
        )}
      </header>

      {body?.steps?.length > 0 && (
        <ul className="space-y-2.5" data-testid="help-article-steps">
          {body.steps.map((line, i) => (
            <li key={i} className="font-mono text-xs text-ink leading-relaxed flex gap-3">
              <span className="text-brand shrink-0 font-bold">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span><Highlight text={line} query={query} /></span>
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

      <footer className="border-t border-line pt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted flex items-center gap-2">
        <span>◇ Was this helpful?</span>
        <a
          href={`mailto:team@craftersmarket.org?subject=Help%20feedback%20%E2%80%94%20${encodeURIComponent(body?.title || leaf.label)}`}
          className="text-ink-muted hover:text-brand transition"
          data-testid={`help-feedback-${leaf.id}`}
        >
          Send feedback →
        </a>
      </footer>
    </article>
  );
}

// Highlights any case-insensitive occurrences of `query` inside `text`.
// Returns plain text when query is empty (zero overhead for the common case).
function Highlight({ text, query }) {
  if (!query || !query.trim() || !text) return text || null;
  const q = query.trim().toLowerCase();
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = String(text).split(re);
  return (
    <>
      {parts.map((p, i) =>
        p && p.toLowerCase() === q ? (
          <mark key={i} className="bg-brand/30 text-[#ffe5d6] px-0.5 rounded-sm">
            {p}
          </mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </>
  );
}
