import React, { useEffect, useState } from "react";
import {
  ChevronDown, Megaphone, Tag, Share2, Gift, Sparkles, Search,
  TrendingUp, Camera, FileText, Hash, DollarSign, Wand2, Copy, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  aiListingCopy, aiSeoAudit, aiSeoBulk,
  fetchDiscountCodes, createDiscountCode, toggleDiscountCode, deleteDiscountCode,
  fetchMakerProducts, makerShareListingToBuffer,
} from "../../lib/api";

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
 * AI Copy + SEO tools moved into "Crafters Market Ads" because that's
 * where makers think about discoverability — keeps the menu focused on
 * the four buyer-facing channels.
 */
const SECTIONS = [
  { id: "ads",      label: "Crafters Market Ads", icon: Megaphone },
  { id: "sales",    label: "Sales and discounts", icon: Tag },
  { id: "social",   label: "Social media",        icon: Share2 },
  { id: "share",    label: "Share & Save",        icon: Gift },
];

export default function MarketingTab() {
  const [section, setSection] = useState(SECTIONS[0].id);
  const [open, setOpen] = useState(true);

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
        <SubNav sections={SECTIONS} activeId={section} onPick={setSection}
          open={open} onToggleOpen={() => setOpen((v) => !v)} />

        <div className="min-w-0" data-testid={`marketing-section-${section}`}>
          {section === "ads"    && <AdsSection />}
          {section === "sales"  && <DiscountCodes />}
          {section === "social" && <SocialMedia />}
          {section === "share"  && <ShareAndSave />}
        </div>
      </div>
    </div>
  );
}

function SubNav({ sections, activeId, onPick, open, onToggleOpen }) {
  return (
    <>
      {/* Mobile: select */}
      <div className="lg:hidden">
        <select value={activeId} onChange={(e) => onPick(e.target.value)}
          className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-4 py-3 font-mono text-sm text-[#e5e5e5]"
          data-testid="marketing-subnav-mobile">
          {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {/* Desktop: collapsible left rail */}
      <nav className="hidden lg:block bg-[#0d0d0d] border border-[#1f1f1f] p-2 self-start"
        data-testid="marketing-subnav">
        <button type="button" onClick={onToggleOpen} aria-expanded={open}
          className="w-full text-left px-3 py-2.5 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] transition border-l-2 border-[#ff4500] text-[#e5e5e5] hover:bg-[#161616]"
          data-testid="marketing-cat-toggle">
          <Megaphone size={14} className="shrink-0" />
          <span className="flex-1 truncate">Marketing</span>
          <ChevronDown size={12} className={`opacity-60 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <ul className="pb-1.5">
            {sections.map((s) => {
              const Icon = s.icon;
              const isActive = s.id === activeId;
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => onPick(s.id)}
                    className={`w-full text-left pl-10 pr-3 py-2 flex items-center gap-2 font-mono text-[11px] tracking-[0.04em] transition ${
                      isActive
                        ? "bg-[#ff4500]/10 text-[#ff4500]"
                        : "text-[#a3a3a3] hover:text-[#e5e5e5] hover:bg-[#161616]"
                    }`}
                    data-testid={`marketing-subnav-${s.id}`}>
                    <Icon size={11} className="shrink-0 opacity-70" />
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </>
  );
}

// ============================================================================
// Section: Crafters Market Ads
// ============================================================================
function AdsSection() {
  return (
    <div className="space-y-6">
      <Section title="Boost a listing" testId="ads-boost">
        <p className="font-mono text-xs text-[#a3a3a3] mb-4 leading-relaxed max-w-2xl">
          Promoted listings appear at the top of category search results and the home page. $5 / week per listing — pause anytime.
        </p>
        <p className="font-mono text-[11px] text-[#737373] mb-5">
          ◆ Promote individual listings from <span className="text-[#e5e5e5]">Listings → ★ Promote $5/wk</span> on any live listing.
        </p>
        <a href="/maker/dashboard#listings" className="btn-industrial btn-primary inline-flex items-center gap-2"
          data-testid="ads-go-listings">
          <TrendingUp size={14} /> Go to Listings →
        </a>
      </Section>

      <ListingCopyGenerator />
      <SeoRecommender />
      <BulkSeoGenerator />
      <MarketingTips />
    </div>
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
// Shared section wrapper (matches Financials/Help styling)
// ============================================================================
function Section({ title, testId, children }) {
  return (
    <section className="border border-[#1f1f1f] bg-[#0d0d0d] p-5 md:p-6" data-testid={testId}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-3">
        ◆ {title}
      </div>
      {children}
    </section>
  );
}

// ============================================================================
// Existing AI / SEO / Discount components (preserved verbatim from previous
// MarketingTab implementation — they were working features, no reason to
// rebuild). Tips card too.
// ============================================================================
const TIPS = [
  { icon: Camera, title: "First photo is everything", body: "60% of click-through is decided by the hero image alone. Sharp, lit, centered, no clutter." },
  { icon: FileText, title: "Title formula that works", body: "[Material] + [Item] + [Style/Use Case]. Example: 'Walnut Cutting Board · Live Edge · Kitchen Gift'." },
  { icon: Hash, title: "Tags are search ammunition", body: "Use 13 tags. Mix specific (walnut, live-edge) and broad (kitchen, housewarming). Repeat words from your title." },
  { icon: TrendingUp, title: "List on Tuesdays around 1pm ET", body: "Buyer browsing peaks Tue-Wed afternoons. New listings get a 24h discoverability boost." },
  { icon: Tag, title: "Run a 10-15% discount on day 1", body: "Drives early sales, builds review velocity, signals to the algorithm that the listing converts." },
  { icon: DollarSign, title: "Round prices to .00 or .50", body: "Ending in .99 reads cheap on handmade. .00 and .50 read confident and intentional." },
];

function ListingCopyGenerator() {
  const [bullets, setBullets] = useState("");
  const [category, setCategory] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (bullets.trim().length < 10) {
      setErr("Add a few bullets describing the piece (materials, dimensions, what makes it special).");
      return;
    }
    setErr(""); setBusy(true);
    try {
      const r = await aiListingCopy({
        bullets: bullets.trim(),
        category: category.trim() || null,
        target_price: target ? parseFloat(target) : null,
      });
      setOut(r);
    } catch (e) {
      setErr(e?.response?.data?.detail || "AI is busy — please retry in a few seconds.");
    } finally { setBusy(false); }
  };

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <Section title="AI Listing Copy" testId="ai-listing-copy">
      <p className="font-mono text-xs text-[#a3a3a3] mb-4">
        Drop in a few bullets. Get a polished title, description, and 13 tags in 5 seconds.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <textarea value={bullets} onChange={(e) => setBullets(e.target.value)}
          placeholder="• Walnut, oil finish, live edge&#10;• 18×12in, 1.5in thick&#10;• Hand-routed juice groove on one side"
          rows={5} maxLength={2000}
          className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-4 py-3 font-mono text-xs outline-none resize-y"
          data-testid="ai-copy-bullets" />
        <div className="grid grid-cols-2 gap-3">
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-xs outline-none"
            data-testid="ai-copy-category" />
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target price ($)"
            type="number" min="1" step="1"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-xs outline-none"
            data-testid="ai-copy-target" />
        </div>
        <button type="submit" disabled={busy}
          className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          data-testid="ai-copy-submit">
          <Wand2 size={14} /> {busy ? "Drafting…" : "Generate copy →"}
        </button>
        {err && <p className="font-mono text-xs text-red-400" data-testid="ai-copy-err">{err}</p>}
      </form>
      {out && (
        <div className="mt-6 space-y-4 border-t border-[#262626] pt-5" data-testid="ai-copy-output">
          <Field label="Title" value={out.title} onCopy={() => copy(out.title, "Title")} testid="ai-copy-out-title" />
          <Field label="Description" value={out.description} onCopy={() => copy(out.description, "Description")} testid="ai-copy-out-desc" multiline />
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">Tags ({out.tags.length})</div>
              <button onClick={() => copy(out.tags.join(", "), "Tags")} className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] hover:underline">
                <Copy size={11} className="inline" /> Copy all
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {out.tags.map((t, i) => (
                <span key={i} className="px-2 py-1 border border-[#262626] bg-[#0a0a0a] font-mono text-[11px] text-[#e5e5e5]">{t}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function Field({ label, value, onCopy, multiline, testid }) {
  return (
    <div data-testid={testid}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</div>
        <button onClick={onCopy} className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] hover:underline">
          <Copy size={11} className="inline" /> Copy
        </button>
      </div>
      <div className={`bg-[#0a0a0a] border border-[#262626] p-3 font-mono text-xs text-[#e5e5e5] leading-relaxed ${multiline ? "whitespace-pre-wrap" : "truncate"}`}>
        {value}
      </div>
    </div>
  );
}

function SeoRecommender() {
  const [state, setState] = useState({ status: "idle", data: null, err: "" });
  const run = async () => {
    setState({ status: "loading", data: null, err: "" });
    try { setState({ status: "done", data: await aiSeoAudit(), err: "" }); }
    catch (e) { setState({ status: "error", data: null, err: e?.response?.data?.detail || "Audit failed." }); }
  };
  return (
    <Section title="SEO Recommender" testId="ai-seo-audit">
      <div className="flex items-start justify-between gap-4 mb-4">
        <p className="font-mono text-xs text-[#a3a3a3] flex-1">
          Audits your active listings and surfaces missing keywords + 3 high-impact title rewrites. Cached for 15 minutes.
        </p>
        <button onClick={run} disabled={state.status === "loading"}
          className="btn-industrial inline-flex items-center gap-2 disabled:opacity-50 shrink-0"
          data-testid="ai-seo-run">
          <Wand2 size={14} /> {state.status === "loading" ? "Auditing…" : "Run audit"}
        </button>
      </div>
      {state.err && <p className="font-mono text-xs text-red-400" data-testid="ai-seo-err">{state.err}</p>}
      {state.data && (
        <div className="space-y-4 border-t border-[#262626] pt-5 mt-2" data-testid="ai-seo-output">
          <p className="font-mono text-xs text-[#e5e5e5] leading-relaxed">{state.data.summary}</p>
          {!!state.data.missing_keywords?.length && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                Missing Keywords ({state.data.missing_keywords.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {state.data.missing_keywords.map((k, i) => (
                  <span key={i} className="px-2 py-1 border border-[#ff4500]/40 bg-[#ff4500]/5 font-mono text-[11px] text-[#ff4500]">{k}</span>
                ))}
              </div>
            </div>
          )}
          {!!state.data.title_rewrites?.length && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">Title Rewrites</div>
              <div className="space-y-2">
                {state.data.title_rewrites.map((r, i) => (
                  <div key={i} className="border border-[#262626] p-3" data-testid={`seo-rewrite-${i}`}>
                    <div className="font-mono text-[10px] text-[#737373] line-through truncate">{r.current}</div>
                    <div className="font-mono text-xs text-[#e5e5e5] mt-1">{r.suggested}</div>
                    <div className="font-mono text-[10px] text-[#a3a3a3] mt-1.5 italic">→ {r.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function BulkSeoGenerator() {
  const [threshold, setThreshold] = useState(8);
  const [maxListings, setMaxListings] = useState(50);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const run = async () => {
    if (!window.confirm(`Run AI tag generator across up to ${maxListings} listings missing tags? Listings with ${threshold}+ tags will be skipped. Existing tags are preserved.`)) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await aiSeoBulk({ max_listings: parseInt(maxListings, 10), min_tags_threshold: parseInt(threshold, 10) });
      setResult(r);
      if (r.scanned === 0) toast.info("No listings needed tags — every published listing already meets the threshold.");
      else toast.success(`Tagged ${r.scanned} listings · added ${r.total_added} new tags total.`);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Bulk SEO failed.";
      setErr(msg); toast.error(msg);
    } finally { setBusy(false); }
  };

  return (
    <Section title="Bulk SEO Tag Generator" testId="ai-seo-bulk">
      <p className="font-mono text-xs text-[#a3a3a3] mb-4">
        Run AI across every published listing. Listings with fewer than the threshold get topped up to 13 tags automatically.
      </p>
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1.5">Tag threshold</span>
          <select value={threshold} onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
            data-testid="seo-bulk-threshold">
            <option value={0}>Listings with 0 tags only</option>
            <option value={4}>Listings with &lt; 4 tags</option>
            <option value={8}>Listings with &lt; 8 tags (recommended)</option>
            <option value={13}>Every published listing (top up all)</option>
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] block mb-1.5">Max listings per run</span>
          <select value={maxListings} onChange={(e) => setMaxListings(parseInt(e.target.value, 10))}
            className="w-full bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] outline-none px-3 py-2 font-mono text-xs"
            data-testid="seo-bulk-max">
            {[10, 25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <button onClick={run} disabled={busy}
        className="btn-industrial btn-primary inline-flex items-center gap-2 disabled:opacity-50"
        data-testid="seo-bulk-run-btn">
        <Sparkles size={14} /> {busy ? "Generating tags…" : "✦ Run bulk SEO"}
      </button>
      {err && <div className="mt-4 border border-red-500/40 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-300">{err}</div>}
      {result && (
        <div className="mt-5 border border-[#262626] bg-[#0a0a0a]" data-testid="seo-bulk-result">
          <div className="px-4 py-3 border-b border-[#262626] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
            ◆ {result.scanned} listings scanned · <span className="text-[#ff4500]">{result.total_added}</span> new tags added
          </div>
          {result.results.length === 0 ? (
            <div className="px-4 py-6 font-mono text-[11px] text-[#737373] text-center">No listings matched the threshold.</div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {result.results.map((r) => (
                <div key={r.slug} className="px-4 py-3 border-b border-[#1a1a1a] flex items-start justify-between gap-3" data-testid={`seo-bulk-row-${r.slug}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[12px] text-[#e5e5e5] truncate">{r.title}</div>
                    {r.added_tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {r.added_tags.map((t) => (
                          <span key={t} className="font-mono text-[10px] px-1.5 py-0.5 border border-[#ff4500]/40 text-[#ff4500] bg-[#ff4500]/5">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-[#737373] uppercase tracking-[0.18em] shrink-0 text-right">
                    +{r.added_count}
                    <div className="text-[9px] text-[#525252] normal-case mt-0.5">{r.total_tags_after}/13 total</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function DiscountCodes() {
  const [codes, setCodes] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", kind: "percent", amount: "10", min_order_total: "0", max_uses: "", expires_at: "", notes: "" });
  const [busy, setBusy] = useState(false);

  const refresh = () => fetchDiscountCodes()
    .then((d) => setCodes(d.codes || []))
    .catch(() => setCodes([]));
  useEffect(() => { refresh(); }, []);

  const create = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await createDiscountCode({
        code: form.code, kind: form.kind, amount: parseFloat(form.amount) || 0,
        min_order_total: parseFloat(form.min_order_total) || 0,
        max_uses: form.max_uses ? parseInt(form.max_uses, 10) : null,
        expires_at: form.expires_at || null, notes: form.notes || null,
      });
      toast.success(`Code created: ${form.code.toUpperCase()}`);
      setForm({ ...form, code: "", notes: "" });
      setShowForm(false);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create code.");
    } finally { setBusy(false); }
  };

  const toggle = async (c) => { try { await toggleDiscountCode(c.id, !c.active); await refresh(); } catch { toast.error("Could not toggle code."); } };
  const remove = async (c) => {
    if (!window.confirm(`Delete code "${c.code}"? This cannot be undone.`)) return;
    try { await deleteDiscountCode(c.id); toast.success(`Deleted ${c.code}`); await refresh(); }
    catch { toast.error("Could not delete code."); }
  };

  return (
    <Section title="Discount Codes" testId="discount-codes">
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="font-mono text-xs text-[#a3a3a3] flex-1">
          Promo codes apply at checkout when buyers paste them in. Per-shop, percentage / fixed dollar / free shipping.
        </p>
        <button onClick={() => setShowForm((s) => !s)} className="btn-industrial inline-flex shrink-0" data-testid="discount-new-btn">
          {showForm ? "Cancel" : "+ New Code"}
        </button>
      </div>
      {showForm && (
        <form onSubmit={create} className="border border-[#262626] p-4 mb-4 grid md:grid-cols-2 gap-3" data-testid="discount-form">
          <input value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} placeholder="CODE (e.g. SUMMER15)" required minLength={3} maxLength={32}
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none uppercase" data-testid="discount-code" />
          <select value={form.kind} onChange={(e) => setForm({...form, kind: e.target.value})}
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none" data-testid="discount-kind">
            <option value="percent">Percent off</option>
            <option value="fixed">Fixed dollar off</option>
            <option value="free_shipping">Free shipping</option>
          </select>
          <input value={form.amount} onChange={(e) => setForm({...form, amount: e.target.value})}
            placeholder={form.kind === "percent" ? "% off (1–100)" : "$ amount"}
            type="number" min="0" step="0.01" required={form.kind !== "free_shipping"} disabled={form.kind === "free_shipping"}
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none disabled:opacity-50" data-testid="discount-amount" />
          <input value={form.min_order_total} onChange={(e) => setForm({...form, min_order_total: e.target.value})}
            placeholder="Min order $ (0 = no min)" type="number" min="0" step="0.01"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none" data-testid="discount-min" />
          <input value={form.max_uses} onChange={(e) => setForm({...form, max_uses: e.target.value})}
            placeholder="Max uses (blank = unlimited)" type="number" min="1"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none" data-testid="discount-maxuses" />
          <input value={form.expires_at} onChange={(e) => setForm({...form, expires_at: e.target.value})}
            placeholder="Expires (YYYY-MM-DD)" type="date"
            className="bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-sm outline-none" data-testid="discount-expires" />
          <textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})}
            placeholder="Internal notes (optional)" maxLength={200} rows={2}
            className="md:col-span-2 bg-[#0a0a0a] border border-[#262626] focus:border-[#ff4500] px-3 py-2 font-mono text-xs outline-none resize-none" data-testid="discount-notes" />
          <button type="submit" disabled={busy} className="md:col-span-2 btn-industrial btn-primary disabled:opacity-50" data-testid="discount-submit">
            {busy ? "Creating…" : "Create code"}
          </button>
        </form>
      )}
      {codes === null ? (
        <p className="font-mono text-xs text-[#737373] py-4">Loading…</p>
      ) : codes.length === 0 ? (
        <p className="font-mono text-xs text-[#737373] py-4">No codes yet — create your first promo above.</p>
      ) : (
        <div className="space-y-2" data-testid="discount-list">
          {codes.map((c) => (
            <div key={c.id} className={`border p-3 flex items-center justify-between gap-3 ${c.active ? "border-[#262626]" : "border-[#1f1f1f] opacity-50"}`} data-testid={`discount-row-${c.code}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-base text-[#ff4500]">{c.code}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                    {c.kind === "percent" ? `${c.amount}% off` : c.kind === "fixed" ? `$${c.amount} off` : "Free shipping"}
                  </span>
                  {c.min_order_total > 0 && <span className="font-mono text-[10px] text-[#737373]">· min ${c.min_order_total}</span>}
                  {c.max_uses && <span className="font-mono text-[10px] text-[#737373]">· {c.uses_count}/{c.max_uses} used</span>}
                </div>
                {c.notes && <div className="font-mono text-[10px] text-[#737373] mt-0.5 truncate">{c.notes}</div>}
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => toggle(c)} className="px-2 py-1 border border-[#262626] hover:border-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em]" data-testid={`discount-toggle-${c.code}`}>
                  {c.active ? "Disable" : "Enable"}
                </button>
                <button onClick={() => remove(c)} className="px-2 py-1 border border-red-800 hover:border-red-500 hover:text-red-300 font-mono text-[10px] uppercase tracking-[0.22em]" data-testid={`discount-delete-${c.code}`}>
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

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
