import React, { useEffect, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { fetchMaker, fetchProducts, fetchMakerJournalPosts, fetchPublicSections, http } from "../lib/api";
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
  const { slug, sectionSlug } = useParams();
  const [m, setM] = useState(null);
  const [products, setProducts] = useState([]);
  const [posts, setPosts] = useState([]);
  // iter450 — Store Sections nav ("Browse Sections" buyer-facing)
  const [sectionsData, setSectionsData] = useState(null);
  const [contactOpen, setContactOpen] = useState(false);
  // iter302 — real review aggregate; replaces the legacy `listings_count`
  // hack which mis-counted reviewCount as the number of products listed.
  const [reviewAgg, setReviewAgg] = useState(null);

  useEffect(() => {
    fetchMaker(slug).then(setM);
    fetchProducts({ maker: slug }).then(setProducts);
    // iter450 — sections nav; empty payload keeps the classic all-products
    // layout for makers who haven't configured sections.
    fetchPublicSections(slug)
      .then(setSectionsData)
      .catch(() => setSectionsData({ sections: [], all_count: 0, redirects: {} }));
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

  // iter450 — resolve the active section from the URL.
  const sections = sectionsData?.sections || [];
  const activeSection = sectionSlug ? sections.find((s) => s.slug === sectionSlug) : null;
  const redirectTo = sectionSlug && sectionsData ? sectionsData.redirects?.[sectionSlug] : null;
  const sectionMissing = !!(sectionSlug && sectionsData && !activeSection && !redirectTo);
  const shownProducts = activeSection
    ? products.filter((p) => (p.section_slugs || []).includes(activeSection.slug))
    : products;
  const pageUrl = `${SITE_URL}/makers/${slug}${activeSection ? `/${activeSection.slug}` : ""}`;

  useStructuredData(m ? {
    title: `${activeSection ? `${activeSection.name} · ` : ""}${m.name}${m.location ? ` · ${m.location}` : ""} · Crafters Market`,
    description: activeSection?.description || m.bio,
    image: m.cover || m.portrait,
    url: pageUrl,
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
            ...(activeSection ? [{ "@type": "ListItem", "position": 4, "name": activeSection.name, "item": pageUrl }] : []),
          ],
        },
      ],
    },
  } : { jsonLd: null });

  // iter450 — old section slug → permanent-style client redirect; unknown
  // slug (hidden/deleted) falls back to the storefront root.
  if (redirectTo) return <Navigate to={`/makers/${slug}/${redirectTo}`} replace />;
  if (sectionMissing) return <Navigate to={`/makers/${slug}`} replace />;

  if (!m) return <div className="pt-40 text-center font-mono text-sm text-ink-muted">Loading…</div>;

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="maker-detail">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <Breadcrumbs
          items={[
            { name: "Home", to: "/" },
            { name: "Makers", to: "/makers" },
            ...(activeSection
              ? [{ name: m.name, to: `/makers/${m.slug}` }, { name: activeSection.name }]
              : [{ name: m.name }]),
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
        {/* iter415 — Theme-independent scrim. Was fading to transparent
            at the top which left overlay text on `text-ink` (dark
            charcoal in light mode) unreadable on light cover photos.
            New gradient stays ≥25% dark throughout so white overlay
            text reads on any cover in either theme. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/75 to-black/25" />
        {/* Overlay text is forced to white (via `text-white` on the
            wrapper) because the scrim above guarantees a dark backdrop.
            No `text-ink` / `text-ink-muted` usage inside — those flip
            to dark in light mode and vanish. */}
        <div className="absolute bottom-10 left-4 md:left-8 xl:left-12 right-4 text-white [text-shadow:_0_2px_10px_rgba(0,0,0,0.55)]">
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
              className="font-display text-xl md:text-2xl text-white/95 mt-2 italic"
              data-testid="maker-shop-title"
            >
              {m.shop_title}
            </div>
          )}
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-white/75 mt-2">{m.location} · {m.listings_count} listings · ★ {m.rating}</div>
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
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-white/25 bg-black/40 backdrop-blur font-mono text-[10px] uppercase tracking-[0.22em] text-white/90"
                  data-testid="maker-trust-location"
                >
                  <span className="text-brand">◆</span> Workshop · {m.location}
                </span>
              ) : null}
              {m.years_crafting ? (
                <span
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-white/25 bg-black/40 backdrop-blur font-mono text-[10px] uppercase tracking-[0.22em] text-white/90"
                  data-testid="maker-trust-years"
                >
                  <span className="text-brand">◆</span> {m.years_crafting}+ Years Active
                </span>
              ) : null}
              {m.response_time_hours ? (
                <span
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-amber-500/50 bg-amber-500/[0.14] backdrop-blur font-mono text-[10px] uppercase tracking-[0.22em] text-amber-200"
                  data-testid="maker-trust-response"
                  title="Typical reply time to messages and custom-order briefs"
                >
                  <span>◆</span> Replies in ~{m.response_time_hours}h
                </span>
              ) : null}
              {m.machinery && m.machinery.length > 0 ? (
                <span
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-white/25 bg-black/40 backdrop-blur font-mono text-[10px] uppercase tracking-[0.22em] text-white/90"
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
              className="px-4 py-2 border border-white/25 hover:border-brand font-mono text-[11px] uppercase tracking-[0.22em] inline-flex items-center gap-2 bg-black/50 backdrop-blur text-white/90"
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

        <h2 className="font-display text-4xl md:text-6xl mb-8">
          {activeSection ? activeSection.name : "From the workshop"}
        </h2>
        {activeSection?.description && (
          <p className="font-mono text-xs text-ink-muted -mt-4 mb-8 max-w-xl leading-relaxed" data-testid="section-description">
            {activeSection.description}
          </p>
        )}

        {/* iter450 — Browse Sections nav. Renders ONLY when the maker has
            configured sections; classic single-grid layout otherwise. Mobile:
            horizontal swipe tabs. Desktop (lg+): sticky left sidebar. Links
            are client-side routes — filtering is instant, no reload. */}
        {sections.length > 0 && (
          <div className="lg:hidden -mx-4 px-4 mb-6 overflow-x-auto" data-testid="sections-tabs-mobile">
            <div className="flex gap-2 w-max pb-1">
              <Link to={`/makers/${m.slug}`}
                    className={`shrink-0 px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.16em] transition ${
                      !activeSection ? "border-brand text-brand" : "border-line text-ink-muted hover:border-brand"}`}
                    data-testid="section-tab-all">
                All ({sectionsData.all_count})
              </Link>
              {sections.map((s) => (
                <Link key={s.id} to={`/makers/${m.slug}/${s.slug}`}
                      className={`shrink-0 px-3 py-1.5 border font-mono text-[10px] uppercase tracking-[0.16em] transition ${
                        activeSection?.slug === s.slug ? "border-brand text-brand" : "border-line text-ink-muted hover:border-brand"}`}
                      data-testid={`section-tab-${s.slug}`}>
                  {s.name} ({s.count})
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className={sections.length > 0 ? "lg:grid lg:grid-cols-[230px_1fr] lg:gap-8" : ""}>
          {sections.length > 0 && (
            <aside className="hidden lg:block self-start sticky top-28" data-testid="sections-sidebar">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-3">
                ◆ Browse sections
              </div>
              <nav className="border border-line divide-y divide-line/60">
                <Link to={`/makers/${m.slug}`}
                      className={`block px-3 py-2 font-mono text-xs transition ${
                        !activeSection ? "text-brand bg-brand/[0.06] border-l-2 border-l-brand" : "text-ink hover:text-brand"}`}
                      data-testid="section-nav-all">
                  All Products <span className="text-ink-muted">({sectionsData.all_count})</span>
                </Link>
                {sections.map((s) => (
                  <Link key={s.id} to={`/makers/${m.slug}/${s.slug}`}
                        className={`block px-3 py-2 font-mono text-xs transition ${
                          activeSection?.slug === s.slug ? "text-brand bg-brand/[0.06] border-l-2 border-l-brand" : "text-ink hover:text-brand"}`}
                        data-testid={`section-nav-${s.slug}`}>
                    {s.name} <span className="text-ink-muted">({s.count})</span>
                  </Link>
                ))}
              </nav>
            </aside>
          )}
          <div>
            {shownProducts.length === 0 ? (
              <div className="border border-dashed border-line p-10 text-center" data-testid="section-empty-state">
                <p className="font-mono text-xs text-ink-muted">
                  Nothing in this section yet —{" "}
                  <Link to={`/makers/${m.slug}`} className="text-brand hover:underline">browse all products</Link>.
                </p>
              </div>
            ) : (
              <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 ${
                sections.length > 0 ? "lg:grid-cols-5" : "lg:grid-cols-6"} gap-4 md:gap-5`}
                   data-testid="storefront-product-grid">
                {shownProducts.map((p, i) => <ProductCard key={p.id} p={p} i={i} />)}
              </div>
            )}
          </div>
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
