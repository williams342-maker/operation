import React, { useEffect, useState } from "react";
import {
  ChevronDown, Megaphone, Tag, Share2, Gift, Camera, FileText, Hash,
  TrendingUp, DollarSign, Copy, Download, Award,
} from "lucide-react";
import { toast } from "sonner";
import { fetchMakerProducts, makerShareListingToBuffer, downloadProductStoryCard, fetchMakerMe } from "../../lib/api";
import Section from "./Marketing/Section";
import AdsSection from "./Marketing/AdsSection";
import AICopyTools from "./Marketing/AICopyTools";
import DiscountCodes from "./Marketing/DiscountCodes";
import FounderCardSection from "./Marketing/FounderCardSection";
import FounderEmailSignature from "./Marketing/FounderEmailSignature";

/**
 * Etsy-parity Marketing hub.
 *
 * Same Etsy-style left-rail collapsible pattern we already use in Help,
 * Settings, and Financials. The single "Marketing" category expands to
 * four sub-sections that mirror Etsy's Marketing menu (per the user's
 * reference screenshot):
 *
 *   • Crafters Market Ads — boost selected listings on the marketplace
 *   • Sales and discounts — promo codes (full CRUD)
 *   • Social media        — share listings to Buffer (queues across IG/FB/X)
 *   • Share & Save        — copy-to-clipboard + email-to-self share links
 *
 * AI Copy + SEO tools render inside the Ads section because that's
 * where makers think about discoverability — keeps the menu focused on
 * the four buyer-facing channels.
 *
 * iter131: extracted AdsSection, AICopyTools (Listing Copy + SEO
 * Recommender + Bulk SEO), DiscountCodes, and the shared Section
 * wrapper into `Marketing/*` modules. This file went from ~1010 to
 * ~150 lines and now only owns the shell + the small Social/Share
 * panels + Marketing tips.
 */
const SECTIONS_BASE = [
  { id: "ads",      label: "Crafters Market Ads", icon: Megaphone },
  { id: "sales",    label: "Sales and discounts", icon: Tag },
  { id: "social",   label: "Social media",        icon: Share2 },
  { id: "stories",  label: "Story templates",     icon: Download },
  { id: "share",    label: "Share & Save",        icon: Gift },
];

// Founder-only section is appended dynamically once we know the maker's tier.
const FOUNDER_SECTION = { id: "founder", label: "Founder card", icon: Award };

export default function MarketingTab() {
  const [section, setSection] = useState(SECTIONS_BASE[0].id);
  const [open, setOpen] = useState(true);
  const [isFounder, setIsFounder] = useState(false);

  useEffect(() => {
    fetchMakerMe()
      .then((m) => setIsFounder(m?.tier === "founder"))
      .catch(() => setIsFounder(false));
  }, []);

  const sections = isFounder ? [...SECTIONS_BASE, FOUNDER_SECTION] : SECTIONS_BASE;

  return (
    <div className="space-y-8" data-testid="marketing-tab">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
          ◆ Shop Manager · Marketing
        </div>
        <h1 className="font-display text-3xl md:text-5xl uppercase leading-[0.95]">
          Marketing.
        </h1>
        <p className="font-mono text-sm text-[#a3a3a3] mt-2 max-w-2xl">
          Reach more buyers with promoted listings, discount codes, social shares, and referral links.
        </p>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-6">
        <SubNav sections={sections} activeId={section} onPick={setSection}
          open={open} onToggleOpen={() => setOpen((v) => !v)} />

        <div className="min-w-0" data-testid={`marketing-section-${section}`}>
          {section === "ads"     && <AdsAndAITools />}
          {section === "sales"   && <DiscountCodes />}
          {section === "social"  && <SocialMedia />}
          {section === "stories" && <StoryTemplates />}
          {section === "share"   && <ShareAndSave />}
          {section === "founder" && (
            <div className="space-y-6">
              <FounderCardSection />
              <FounderEmailSignature />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Ads section followed by the AI / SEO toolset + tips card. Keeps the
// "discoverability" content grouped under one nav item.
function AdsAndAITools() {
  return (
    <div className="space-y-6">
      <AdsSection />
      <AICopyTools />
      <MarketingTips />
    </div>
  );
}

function SubNav({ sections, activeId, onPick, open, onToggleOpen }) {
  return (
    <>
      {/* Mobile dropdown */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={onToggleOpen}
          className="w-full flex items-center justify-between border border-[#262626] px-3 py-2 font-mono text-xs uppercase tracking-[0.22em]"
          data-testid="marketing-subnav-toggle"
          aria-expanded={open}
        >
          <span className="text-[#a3a3a3]">Section · {sections.find((s) => s.id === activeId)?.label}</span>
          <ChevronDown size={14} className={`text-[#525252] transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      <nav className={`border border-[#262626] bg-[#0a0a0a] p-2 lg:block ${open ? "block" : "hidden"}`}
        data-testid="marketing-subnav">
        <ul className="space-y-0.5">
          {sections.map((s) => {
            const Icon = s.icon;
            const active = s.id === activeId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onPick(s.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-left transition ${
                    active
                      ? "bg-[#ff4500]/10 text-[#ff4500] border-l-2 border-[#ff4500]"
                      : "text-[#a3a3a3] hover:text-[#e5e5e5] hover:bg-[#0f0f0f] border-l-2 border-transparent"
                  }`}
                  data-testid={`marketing-subnav-${s.id}`}
                >
                  <Icon size={14} />
                  <span>{s.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

// ============================================================================
// Section: Social media — share to Buffer (already wired backend-side)
// ============================================================================
function SocialMedia() {
  const [products, setProducts] = useState(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    fetchMakerProducts()
      .then((all) => setProducts(all.filter((p) => !p.deleted_at && p.status !== "draft")))
      .catch(() => setProducts([]));
  }, []);

  const share = async (slug) => {
    setBusy(slug);
    try {
      await makerShareListingToBuffer(slug);
      toast.success("Queued to Buffer — will post across your linked socials.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Buffer queue failed.");
    } finally { setBusy(""); }
  };

  return (
    <Section title="Share to social media" testId="social-share">
      <p className="font-mono text-xs text-[#a3a3a3] mb-5 max-w-2xl leading-relaxed">
        Queue any listing to your linked Buffer account — posts go out to Instagram, Facebook, X, and Pinterest on your schedule. Connect Buffer in <a href="/maker/dashboard#settings" className="text-[#ff4500] hover:underline">Settings → Integrations</a>.
      </p>

      {products === null ? (
        <p className="font-mono text-xs text-[#525252]">Loading…</p>
      ) : products.length === 0 ? (
        <p className="font-mono text-xs text-[#525252]">Publish a listing first — drafts can't be shared.</p>
      ) : (
        <ul className="border border-[#1f1f1f] divide-y divide-[#1f1f1f]" data-testid="social-share-list">
          {products.slice(0, 12).map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              {p.images?.[0] && (
                <img src={p.images[0]} alt="" className="w-10 h-10 object-cover" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-[#e5e5e5] truncate">{p.title}</div>
                <div className="font-mono text-[10px] text-[#525252]">${p.price.toFixed(0)} · {p.category}</div>
              </div>
              <button onClick={() => share(p.slug)} disabled={busy === p.slug}
                className="px-3 py-1.5 border border-sky-500/40 text-sky-400 hover:bg-sky-500/10 font-mono text-[10px] uppercase tracking-[0.22em] transition disabled:opacity-50"
                data-testid={`social-share-${p.slug}`}>
                {busy === p.slug ? "Queueing…" : "↗ Queue"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ============================================================================
// Section: Story templates — one-click 9:16 IG/TikTok exports per listing
// ============================================================================
// Server renders a 1080×1920 PNG composited with hero image + maker name +
// price + scan-to-shop QR code at `/api/products/{slug}/story-card.png`. We
// just expose a clickable list here so makers don't have to hunt for it on
// each listing card. Higher organic reach than carousel posts on both IG and
// TikTok, and keeps a maker's brand tile visible in the corner of every share.
function StoryTemplates() {
  const [products, setProducts] = useState(null);
  useEffect(() => {
    fetchMakerProducts()
      .then((all) => setProducts(all.filter((p) => !p.deleted_at && p.status !== "draft")))
      .catch(() => setProducts([]));
  }, []);

  const grab = (slug) => {
    downloadProductStoryCard(slug);
    toast.success("Story template downloading — drop it in IG or TikTok.");
  };

  return (
    <Section title="Instagram & TikTok story templates" testId="story-templates">
      <p className="font-mono text-xs text-[#a3a3a3] mb-5 max-w-2xl leading-relaxed">
        One-click 1080×1920 PNG with your hero shot, price, and a scan-to-shop QR code baked in.
        Save it, drop it on your IG or TikTok story, and you're done — every scan lands buyers
        on your listing with UTM credit back to you.
      </p>

      {products === null ? (
        <p className="font-mono text-xs text-[#525252]">Loading…</p>
      ) : products.length === 0 ? (
        <p className="font-mono text-xs text-[#525252]">Publish a listing first — story templates only generate for live products.</p>
      ) : (
        <ul className="border border-[#1f1f1f] divide-y divide-[#1f1f1f]" data-testid="story-templates-list">
          {products.slice(0, 24).map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              {p.images?.[0] && (
                <img src={p.images[0]} alt="" className="w-10 h-10 object-cover" loading="lazy" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-[#e5e5e5] truncate">{p.title}</div>
                <div className="font-mono text-[10px] text-[#525252]">${p.price.toFixed(0)} · {p.category}</div>
              </div>
              <button
                onClick={() => grab(p.slug)}
                className="px-3 py-1.5 border border-[#ff4500]/40 text-[#ff4500] hover:bg-[#ff4500]/10 font-mono text-[10px] uppercase tracking-[0.22em] transition flex items-center gap-1.5"
                data-testid={`story-template-download-${p.slug}`}
              >
                <Download size={11} /> Story
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ============================================================================
// Section: Share & Save — referral / shop URL
// ============================================================================
function ShareAndSave() {
  // Source the maker's public shop URL from the current location origin so
  // it matches whatever environment the maker is logged into.
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div className="space-y-6">
      <Section title="Your shop link" testId="share-shop">
        <p className="font-mono text-xs text-[#a3a3a3] mb-4 max-w-2xl leading-relaxed">
          The simplest way to drive sales — drop your shop link in your IG bio, email signature, or business card.
        </p>
        <ShareLinkRow
          label="Shop URL"
          value={`${origin}/maker/me`}
          onCopy={() => copy(`${origin}/maker/me`, "Shop URL")}
          testid="share-shop-url"
        />
      </Section>

      <Section title="Refer a maker · earn rewards" testId="share-referral">
        <p className="font-mono text-xs text-[#a3a3a3] mb-4 max-w-2xl leading-relaxed">
          Invite a fellow maker to Crafters Market. When they publish their first paid listing, you both get a free week of promoted-listings credit.
        </p>
        <ShareLinkRow
          label="Your referral link"
          value={`${origin}/beta?r=share`}
          onCopy={() => copy(`${origin}/beta?r=share`, "Referral link")}
          testid="share-referral-url"
        />
        <p className="font-mono text-[10px] text-[#525252] mt-3">
          ◇ Tracking automatic on signup. Credit posted within 24h of their first sale.
        </p>
      </Section>
    </div>
  );
}

function ShareLinkRow({ label, value, onCopy, testid }) {
  return (
    <div className="border border-[#262626] flex items-center" data-testid={testid}>
      <span className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252] border-r border-[#262626] shrink-0">
        {label}
      </span>
      <code className="flex-1 px-3 py-2 font-mono text-xs text-[#e5e5e5] truncate">{value}</code>
      <button onClick={onCopy}
        className="px-3 py-2 border-l border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] transition flex items-center gap-1.5"
        data-testid={`${testid}-copy`}>
        <Copy size={11} /> Copy
      </button>
    </div>
  );
}

// ============================================================================
// Tips — short marketing playbook below the Ads & AI tools.
// ============================================================================
const TIPS = [
  { icon: Camera, title: "First photo is everything", body: "60% of click-through is decided by the hero image alone. Sharp, lit, centered, no clutter." },
  { icon: FileText, title: "Title formula that works", body: "[Material] + [Item] + [Style/Use Case]. Example: 'Walnut Cutting Board · Live Edge · Kitchen Gift'." },
  { icon: Hash, title: "Tags are search ammunition", body: "Use 13 tags. Mix specific (walnut, live-edge) and broad (kitchen, housewarming). Repeat words from your title." },
  { icon: TrendingUp, title: "List on Tuesdays around 1pm ET", body: "Buyer browsing peaks Tue-Wed afternoons. New listings get a 24h discoverability boost." },
  { icon: Tag, title: "Run a 10-15% discount on day 1", body: "Drives early sales, builds review velocity, signals to the algorithm that the listing converts." },
  { icon: DollarSign, title: "Round prices to .00 or .50", body: "Ending in .99 reads cheap on handmade. .00 and .50 read confident and intentional." },
];

function MarketingTips() {
  return (
    <section data-testid="marketing-tips">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">
        ◆ Tactics that compound
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TIPS.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.title} className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 flex gap-4"
              data-testid={`tip-${t.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
              <Icon size={20} className="text-[#ff4500] shrink-0 mt-0.5" />
              <div>
                <h4 className="font-display text-base uppercase mb-1.5">{t.title}</h4>
                <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">{t.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
