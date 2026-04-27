import React from "react";
import { Sparkles, Search, DollarSign, Tag, TrendingUp, Camera, FileText, Hash } from "lucide-react";

const TIPS = [
  { icon: Camera, title: "First photo is everything", body: "60% of click-through is decided by the hero image alone. Sharp, lit, centered, no clutter." },
  { icon: FileText, title: "Title formula that works", body: "[Material] + [Item] + [Style/Use Case]. Example: 'Walnut Cutting Board · Live Edge · Kitchen Gift'." },
  { icon: Hash, title: "Tags are search ammunition", body: "Use 13 tags. Mix specific (walnut, live-edge) and broad (kitchen, housewarming). Repeat words from your title." },
  { icon: TrendingUp, title: "List on Tuesdays around 1pm ET", body: "Buyer browsing peaks Tue–Wed afternoons. New listings get a 24h discoverability boost." },
  { icon: Tag, title: "Run a 10–15% discount on day 1", body: "Drives early sales, builds review velocity, signals to the algorithm that the listing converts." },
  { icon: DollarSign, title: "Round prices to .00 or .50", body: "Ending in .99 reads cheap on handmade. .00 and .50 read confident and intentional." },
];

const COMING_SOON = [
  {
    icon: Sparkles,
    title: "AI Listing Copy Generator",
    body: "Paste a photo + a few bullet points. Get a title, description, and 13 tags written for the algorithm.",
  },
  {
    icon: Search,
    title: "SEO Recommender",
    body: "We audit each of your listings and tell you the keywords you're missing. Apply with one click.",
  },
  {
    icon: TrendingUp,
    title: "Pricing Assistant",
    body: "Compare your prices against similar listings on Crafters Market. See the comparables count so you know how strong the signal is.",
  },
];

/** Marketing tab — Phase 1 ships static tips + AI Companion previews. */
export default function MarketingTab() {
  return (
    <div className="space-y-10" data-testid="marketing-tab">
      <header className="pb-6 border-b border-[#262626]">
        <h2 className="font-display text-3xl md:text-4xl uppercase">Marketing.</h2>
        <p className="font-mono text-xs text-[#a3a3a3] mt-2 max-w-xl">
          Tactics, AI tools, and discount codes — everything you need to drive demand for your shop.
        </p>
      </header>

      {/* AI Companions — coming-soon previews */}
      <section data-testid="ai-companions">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-3">
          ◆ AI Marketing Companion · shipping next
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {COMING_SOON.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.title}
                className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 relative overflow-hidden"
                data-testid={`ai-${c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                <div className="absolute top-3 right-3 px-2 py-0.5 bg-[#ff4500]/10 border border-[#ff4500] font-mono text-[9px] uppercase tracking-[0.22em] text-[#ff4500]">
                  Soon
                </div>
                <Icon size={22} className="text-[#ff4500] mb-3" />
                <h4 className="font-display text-lg uppercase mb-2">{c.title}</h4>
                <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">{c.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Discount Codes — Phase 2 */}
      <section data-testid="discount-codes">
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            ◆ Discount Codes
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">Phase 2</span>
        </div>
        <div className="border border-[#1f1f1f] bg-[#0d0d0d] p-6 text-center">
          <Tag size={28} className="text-[#a3a3a3] mx-auto mb-3" />
          <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed max-w-md mx-auto">
            Per-shop promo codes (10% off first order, free shipping over $X, etc.) are
            on the next milestone. Email <a href="mailto:team@craftersmarket.org" className="text-[#ff4500] hover:underline">team@craftersmarket.org</a> if you need a code right now.
          </p>
        </div>
      </section>

      {/* Tips — always live */}
      <section data-testid="marketing-tips">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3">
          ◆ Tactics that compound
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TIPS.map((t) => {
            const Icon = t.icon;
            return (
              <div
                key={t.title}
                className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 flex gap-4"
                data-testid={`tip-${t.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
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
    </div>
  );
}
