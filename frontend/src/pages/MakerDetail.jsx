import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchMaker, fetchProducts, fetchMakerJournalPosts, http } from "../lib/api";
import { useStructuredData } from "../lib/seo";
import ProductCard from "../components/ProductCard";
import MakerReviews from "../components/MakerReviews";
import FollowButton from "../components/FollowButton";
import FollowersList from "../components/FollowersList";
import ShareLinkButton from "../components/ShareLinkButton";
import ContactMakerModal from "../components/ContactMakerModal";
import VeteranBadge from "../components/VeteranBadge";
import { FounderBadge, BetaTesterBadge } from "../components/FounderBadge";
import PlusSlaBadge from "../components/PlusSlaBadge";
import GoogleAdsFeaturedBadge from "../components/GoogleAdsFeaturedBadge";
import RecentShowcaseStrip from "../components/RecentShowcaseStrip";
import CustomOrderCTA from "../components/CustomOrderCTA";
import SaveDropButton from "../components/SaveDropButton";
import WorkshopVideoGrid from "../components/WorkshopVideoGrid";
import { Mail, Facebook, Instagram, Twitter, Youtube, Globe, BookOpen, ArrowUpRight } from "lucide-react";
import Breadcrumbs from "../components/Breadcrumbs";

// Always emit the canonical apex URL — never the preview hostname.
const SITE_URL = "https://craftersmarket.org";

export default function MakerDetail() {
  const { slug } = useParams();
  const [m, setM] = useState(null);
  const [products, setProducts] = useState([]);
  const [posts, setPosts] = useState([]);
  const [contactOpen, setContactOpen] = useState(false);
  // iter302 — real review aggregate; replaces the legacy `listings_count`
  // hack which mis-counted reviewCount as the number of products listed.
  const [reviewAgg, setReviewAgg] = useState(null);

  useEffect(() => {
    fetchMaker(slug).then(setM);
    fetchProducts({ maker: slug }).then(setProducts);
    // Maker-authored posts only — falls back to empty array on 404 /
    // network error so the rail just hides itself.
    fetchMakerJournalPosts(slug, 3).then(setPosts).catch(() => setPosts([]));
    setReviewAgg(null);
    // Public review aggregate for AggregateRating in JSON-LD. Silent
    // on error — schema degrades gracefully to Organization-only.
    http.get(`/reviews/aggregate?maker_slug=${slug}`)
      .then((r) => { if (r?.data?.count > 0) setReviewAgg(r.data); })
      .catch(() => {});
  }, [slug]);

  useStructuredData(m ? {
    title: `${m.name}${m.location ? ` · ${m.location}` : ""} · Crafters Market`,
    description: m.bio,
    image: m.cover || m.portrait,
    url: `${SITE_URL}/makers/${m.slug}`,
    imageAlt: `${m.name} — ${m.location || ""}`.trim(),
    ogType: "profile",
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "name": m.name,
          "description": m.bio,
          "image": m.portrait,
          "url": `${SITE_URL}/makers/${m.slug}`,
          "address": m.location ? { "@type": "PostalAddress", "addressLocality": m.location } : undefined,
          // iter302 — real review-based AggregateRating. We omit the
          // field when there are 0 public reviews (Schema.org rejects
          // reviewCount=0). Falls back to the seeded `m.rating` value
          // only when count ≥ 1 to keep historical seed data visible.
          ...(reviewAgg && reviewAgg.count > 0 ? {
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: String(reviewAgg.average),
              reviewCount: reviewAgg.count,
              bestRating: "5",
              worstRating: "1",
            },
          } : {}),
        },
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": `${SITE_URL}/` },
            { "@type": "ListItem", "position": 2, "name": "Makers", "item": `${SITE_URL}/makers` },
            { "@type": "ListItem", "position": 3, "name": m.name, "item": `${SITE_URL}/makers/${m.slug}` },
          ],
        },
      ],
    },
  } : { jsonLd: null });

  if (!m) return <div className="pt-40 text-center font-mono text-sm text-ink-muted">Loading…</div>;

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="maker-detail">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <Breadcrumbs
          items={[
            { name: "Home", to: "/" },
            { name: "Makers", to: "/makers" },
            { name: m.name },
          ]}
          testId="maker-breadcrumbs"
        />
      </div>
      <div className="relative h-[60vh] overflow-hidden border-b border-line mb-16 -mx-4 md:-mx-8 xl:-mx-12">
        <img
          src={m.banner_image_url || m.cover}
          alt={m.name}
          className="absolute inset-0 w-full h-full object-cover"
          data-testid="maker-detail-hero-image"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-black/60 to-transparent" />
        <div className="absolute bottom-10 left-4 md:left-8 xl:left-12 right-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3 flex items-center gap-3">
            <span>◆ Approved Maker</span>
            {m.subscription_status === "active" && (
              <span
                className="text-emerald-700 border border-emerald-400/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em]"
                data-testid="maker-plus-badge"
              >
                ★ Plus
              </span>
            )}
            {m.is_veteran_owned && (
              <VeteranBadge testId="maker-veteran-badge" />
            )}
            {m.tier === "founder" && (
              <FounderBadge number={m.founder_number} testId="maker-founder-badge" />
            )}
            {m.is_beta_tester && (
              <BetaTesterBadge testId="maker-beta-tester-badge" />
            )}
            {(m.subscription_status === "active" || m.subscription_status === "trialing") && (
              <PlusSlaBadge testId="maker-plus-sla-badge" />
            )}
            <GoogleAdsFeaturedBadge maker={m} testId="maker-google-ads-badge" />
            {m.featured_example && (
              <span
                className="tag text-brand border-amber-400/70 bg-paper/80 text-[9px]"
                data-testid="maker-featured-example-badge"
                title="Founding Maker · Platform Showcase — curated by Crafters Market"
              >
                ✦ FOUNDING MAKER · PLATFORM SHOWCASE
              </span>
            )}
          </div>
          <h1 className="font-display text-[64px] md:text-[120px] leading-[0.88]">{m.name}</h1>
          {m.shop_title && (
            <div
              className="font-display text-xl md:text-2xl text-ink mt-2 italic"
              data-testid="maker-shop-title"
            >
              {m.shop_title}
            </div>
          )}
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-ink-muted mt-2">{m.location} · {m.listings_count} listings · ★ {m.rating}</div>
          {/* iter321 — Trust / proof strip. Loud, scannable, sits above
              the fold so buyers see the credentials before they scroll
              into the bio. Each chip auto-hides when the underlying
              field is empty so we never show "Replies in ~null hours". */}
          {(m.years_crafting || m.response_time_hours || (m.machinery && m.machinery.length) || m.location) && (
            <div
              className="mt-4 flex flex-wrap gap-2"
              data-testid="maker-trust-strip"
            >
              {m.location ? (
                <span
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-line bg-paper/40 backdrop-blur font-mono text-[10px] uppercase tracking-[0.22em] text-ink"
                  data-testid="maker-trust-location"
                >
                  <span className="text-brand">◆</span> Workshop · {m.location}
                </span>
              ) : null}
              {m.years_crafting ? (
                <span
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-line bg-paper/40 backdrop-blur font-mono text-[10px] uppercase tracking-[0.22em] text-ink"
                  data-testid="maker-trust-years"
                >
                  <span className="text-brand">◆</span> {m.years_crafting}+ Years Active
                </span>
              ) : null}
              {m.response_time_hours ? (
                <span
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-amber-500/40 bg-amber-500/[0.08] backdrop-blur font-mono text-[10px] uppercase tracking-[0.22em] text-brand"
                  data-testid="maker-trust-response"
                  title="Typical reply time to messages and custom-order briefs"
                >
                  <span>◆</span> Replies in ~{m.response_time_hours}h
                </span>
              ) : null}
              {m.machinery && m.machinery.length > 0 ? (
                <span
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-line bg-paper/40 backdrop-blur font-mono text-[10px] uppercase tracking-[0.22em] text-ink"
                  data-testid="maker-trust-machines"
                >
                  <span className="text-brand">◆</span> {m.machinery.length} CNC machine{m.machinery.length > 1 ? "s" : ""}
                </span>
              ) : null}
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <FollowButton makerSlug={m.slug} makerName={m.name} />
            <ShareLinkButton kind="maker" slug={m.slug} testId="maker-share-link" />
            <button
              onClick={() => setContactOpen(true)}
              className="px-4 py-2 border border-line hover:border-brand font-mono text-[11px] uppercase tracking-[0.22em] inline-flex items-center gap-2 bg-paper/70 backdrop-blur"
              data-testid="contact-maker-btn"
            >
              <Mail size={14} /> Message {m.name?.split(" ")[0] || "Maker"}
            </button>
          </div>
        </div>
      </div>
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        {/* Pinned shop announcement — operator-controlled notice for sales,
            vacation warnings, or new drops. Kept high on the page so it's
            seen before buyers scroll into listings. */}
        {m.shop_announcement && (
          <div
            className="border-l-4 border-brand bg-brand/5 px-4 py-3 mb-10 font-mono text-sm text-ink leading-relaxed"
            data-testid="maker-shop-announcement"
          >
            <span className="font-bold text-brand mr-2 uppercase tracking-[0.22em] text-[10px]">◆ From the shop</span>
            {m.shop_announcement}
          </div>
        )}
        {/* Shop-closed banner — overrides everything else if the maker
            closed the shop (vacation/pause/pending-deletion states). */}
        {m.shop_closed && (
          <div
            className="border border-amber-600 bg-amber-950/30 px-4 py-3 mb-10 font-mono text-sm text-brand"
            data-testid="maker-shop-closed-banner"
          >
            ◆ This shop is temporarily closed. Existing listings may not be
            fulfilled until the shop reopens.
          </div>
        )}
        <div className="grid md:grid-cols-12 gap-8 mb-16">
          <div className="md:col-span-7">
            <p className="font-mono text-base text-ink leading-relaxed">{m.bio}</p>
            {/* iter228 — "From the Workshop" intro paragraph. Deeper
                story than the bio tagline (~120-180 words: origin
                moment, specific machinery, the one thing the shop
                refuses to compromise on). Auto-hides when empty so
                makers without an intro don't get a barren section
                header. */}
            {m.workshop_intro ? (
              <div className="mt-8 border-l-2 border-brand pl-5" data-testid="maker-workshop-intro">
                <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-3">
                  ◆ From the Workshop
                </div>
                <p className="font-mono text-[13px] text-ink leading-[1.75] whitespace-pre-line">
                  {m.workshop_intro}
                </p>
              </div>
            ) : null}
            {/* iter178 — Meet-the-Makers credentials row. Renders only the
                facts the maker actually filled in (never shows placeholder
                "—" labels for unknown values). */}
            {(m.years_crafting || (m.machinery && m.machinery.length > 0)) && (
              <dl
                className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-xs font-mono"
                data-testid="maker-credentials"
              >
                {m.years_crafting ? (
                  <div className="col-span-1">
                    <dt className="text-ink-muted uppercase tracking-[0.22em] text-[10px] mb-1">
                      Years crafting
                    </dt>
                    <dd className="text-ink text-lg font-display" data-testid="maker-years-crafting">
                      {m.years_crafting}+
                    </dd>
                  </div>
                ) : null}
                {m.machinery && m.machinery.length > 0 ? (
                  <div className="col-span-2 md:col-span-1">
                    <dt className="text-ink-muted uppercase tracking-[0.22em] text-[10px] mb-1.5">
                      Workshop machinery
                    </dt>
                    <dd className="flex flex-wrap gap-1.5" data-testid="maker-machinery">
                      {m.machinery.map((mch) => (
                        <span
                          key={mch}
                          className="tag text-[10px] text-ink-muted border-line"
                        >
                          {mch}
                        </span>
                      ))}
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
          </div>
          <div className="md:col-span-4 md:col-start-9 flex flex-wrap gap-2 self-start">
            {m.techniques.map((t) => <span key={t} className="tag text-brand border-brand">{t}</span>)}
          </div>
        </div>
        <SocialLinks maker={m} />

        {/* iter321 — Workshop photos gallery. Real proof that the
            maker runs a real shop floor. Auto-hides on empty so makers
            without photos uploaded yet don't get a barren section. */}
        {Array.isArray(m.workshop_photos) && m.workshop_photos.length > 0 && (
          <section
            className="mt-16 mb-16"
            data-testid="maker-workshop-photos"
          >
            <div className="flex items-end justify-between mb-6">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2">
                  ◆ Inside the workshop
                </div>
                <h2 className="font-display text-3xl md:text-5xl leading-none">
                  Real shop. Real machines.
                </h2>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hidden md:inline">
                {m.workshop_photos.length} photo{m.workshop_photos.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
              {m.workshop_photos.slice(0, 6).map((src, i) => (
                <a
                  key={`${src}-${i}`}
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block aspect-[4/3] overflow-hidden border border-line hover:border-brand transition-colors bg-paper"
                  data-testid={`maker-workshop-photo-${i}`}
                >
                  <img
                    src={src}
                    alt={`${m.name} workshop · photo ${i + 1}`}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                  />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* iter186 — Workshop video grid (auto-hides when empty) */}
        <WorkshopVideoGrid videos={m.workshop_videos || []} />

        {/* iter181 — Email funnel: "Get notified when this maker drops a
            new piece." Subscribes the buyer to the maker-specific Kit
            segment; new product publishes auto-broadcast to followers. */}
        <div
          className="mb-16 border border-line p-6 md:p-7 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          data-testid="maker-detail-follow-card"
        >
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
              ◆ Stay in the loop
            </div>
            <h3 className="font-display text-xl md:text-2xl text-ink mt-1">
              Get notified when {m.name?.split(" ")[0] || "this maker"} drops a new piece.
            </h3>
            <p className="font-mono text-xs text-ink-muted mt-2 max-w-lg">
              One email per new listing — no spam, no algorithm. Unsubscribe with a click.
            </p>
          </div>
          <div className="shrink-0">
            <SaveDropButton makerSlug={m.slug} makerName={m.name} />
          </div>
        </div>

        <h2 className="font-display text-4xl md:text-6xl mb-8">From the workshop</h2>
        {/* iter281 — Doubled the column count at lg+ so each card lands
            at ~half its previous width on desktop. Mobile keeps 2-col
            (was 1-col — felt sparse at the request to shrink). The
            ProductCard's `aspect-[4/5]` portrait ratio is preserved so
            photos still feel like product hero shots, just smaller. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-5">
          {products.map((p, i) => <ProductCard key={p.id} p={p} i={i} />)}
        </div>

        {/* Showcase carousel — `strict` ensures we only show posts
            tagged to THIS maker, never a fallback to global newest. */}
        <div className="mt-16">
          <RecentShowcaseStrip
            makerSlug={m.slug}
            limit={4}
            strict
            eyebrow="◆ Featured in showcase"
            title={`In ${m.name?.split(" ")[0] || "the"} workshop`}
            testId="maker-showcase-strip"
          />
        </div>

        {/* Maker-authored journal posts — appears only when the maker has
            actually published. Self-hides for makers who haven't yet —
            keeps profile pages clean for shops that focus on listings. */}
        {posts.length > 0 && <MakerJournalRail maker={m} posts={posts} />}

        <FollowersList makerSlug={m.slug} />
        <MakerReviews makerSlug={m.slug} makerName={m.name} />

        {/* Custom-order CTA — preselects this maker on the brief form so
            commissions land directly in their inbox. Mounted late so it
            comes after the reviews trust signal. */}
        <div className="mt-12">
          <CustomOrderCTA
            makerSlug={m.slug}
            headline={`Want something custom from ${m.name}?`}
            testId="maker-custom-cta"
          />
        </div>

        <Link to="/makers" className="inline-block mt-12 industrial-link font-mono text-xs uppercase tracking-[0.22em]">← All makers</Link>
      </div>
      {contactOpen && <ContactMakerModal maker={m} onClose={() => setContactOpen(false)} />}
    </div>
  );
}

// Shop-level social/external links. Rendered between the bio and the
// listings grid. Pure vanity links — no OAuth, no data sync. Hidden
// entirely if the maker hasn't set any (common for new shops).
const SOCIAL_ICONS = {
  social_facebook:  { Icon: Facebook,  label: "Facebook"  },
  social_instagram: { Icon: Instagram, label: "Instagram" },
  social_twitter:   { Icon: Twitter,   label: "Twitter"   },
  social_tiktok:    { Icon: Globe,     label: "TikTok"    },
  social_youtube:   { Icon: Youtube,   label: "YouTube"   },
  social_pinterest: { Icon: Globe,     label: "Pinterest" },
  website_url:      { Icon: Globe,     label: "Website"   },
};

function SocialLinks({ maker }) {
  const links = Object.entries(SOCIAL_ICONS)
    .map(([key, cfg]) => ({ key, url: (maker[key] || "").trim(), ...cfg }))
    .filter((l) => l.url);
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-14" data-testid="maker-social-links">
      {links.map((l) => (
        <a
          key={l.key}
          href={l.url}
          target="_blank"
          rel="noreferrer nofollow"
          className="inline-flex items-center gap-2 px-3 py-2 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition"
          data-testid={`maker-social-${l.key}`}
        >
          <l.Icon size={12} /> {l.label}
        </a>
      ))}
    </div>
  );
}

// Up-to-3 maker-authored journal posts surfaced as an editorial rail.
// Doubles as social proof ("this maker has things to say about their
// craft") and as a free SEO link from a high-authority profile page
// to the longer-form post. Stays hidden for makers who haven't
// published yet so brand-new shops don't render an empty card row.
function MakerJournalRail({ maker, posts }) {
  return (
    <section className="mt-20 pt-10 border-t border-line" data-testid="maker-journal-rail">
      <div className="flex items-end justify-between gap-4 mb-8 flex-wrap">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-brand mb-2 flex items-center gap-2">
            <BookOpen size={12} /> Words from {maker.name?.split(" ")[0] || "the maker"}
          </div>
          <h2 className="font-display text-3xl md:text-4xl uppercase">
            From the journal
          </h2>
        </div>
        <Link
          to="/journal"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand transition"
          data-testid="maker-journal-rail-all"
        >
          All journal entries <ArrowUpRight size={11} />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {posts.map((p) => (
          <Link
            key={p.slug}
            to={`/journal/${p.slug}`}
            className="group block border border-line hover:border-brand transition overflow-hidden"
            data-testid={`maker-journal-rail-post-${p.slug}`}
          >
            {p.cover && (
              <div className="aspect-[16/10] overflow-hidden bg-paper">
                <img
                  src={p.cover}
                  alt={p.title ? `${p.title} — ${m.name} journal` : `${m.name} journal post`}
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-700"
                  loading="lazy"
                />
              </div>
            )}
            <div className="p-4">
              <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-ink-muted mb-2">
                {(p.created_at || "").slice(0, 10)} · {p.read_min || 4} min read
              </div>
              <h3 className="font-display text-lg uppercase leading-tight group-hover:text-brand transition mb-2 line-clamp-2">
                {p.title}
              </h3>
              <p className="font-mono text-xs text-ink-muted leading-relaxed line-clamp-3">
                {p.excerpt}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
