import React, { useEffect, useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { http } from "../lib/api";
import { useStructuredData } from "../lib/seo";
import Breadcrumbs from "../components/Breadcrumbs";
import VeteranBadge from "../components/VeteranBadge";
import { CardSkeleton } from "../components/Skeleton";

const SITE_URL = "https://craftersmarket.org";

/**
 * StatePage (iter301 / Phase 4 Bundle A)
 * --------------------------------------
 * Per-state maker landing page targeting buyer-intent queries like
 * "custom metal signs Texas" / "CNC laser makers in Tennessee".
 *
 * Backed by `GET /api/state-pages` (state_pages.py) which only emits
 * states with ≥ 1 maker — empty doorway pages get penalized by Google.
 *
 * Ships JSON-LD `@graph`:
 *   • CollectionPage   — the page itself
 *   • BreadcrumbList   — Home › Makers › <state>
 *   • ItemList         — every maker on the page
 *   • Place (AreaServed) — geo signal: this page covers a US state
 *
 * URL: `/makers/state/:code` — both lowercase 2-letter code (`tx`)
 *      and full-name slug (`texas`) are accepted; we normalize via
 *      the backend response.
 */
export default function StatePage() {
  const { code: codeParam } = useParams();
  const [state, setState] = useState(null);
  const [allStates, setAllStates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true);
    http.get("/state-pages")
      .then((res) => {
        const list = res?.data?.states || [];
        setAllStates(list);
        const target = (codeParam || "").toLowerCase().trim();
        // Accept either 2-letter code or the full name slugified
        // ("new-york", "new-mexico").
        const match = list.find(
          (s) =>
            s.slug === target ||
            s.name.toLowerCase().replace(/\s+/g, "-") === target,
        );
        if (match) setState(match);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [codeParam]);

  // ALWAYS call useStructuredData so the hook order stays stable across
  // every render path. When `state` is null we just clear the override.
  useStructuredData(state ? {
    title: `CNC, Plasma & Laser Makers in ${state.name} · Crafters Market`,
    description: `Browse ${state.maker_count} vetted independent CNC, plasma, and laser makers in ${state.name}. Made-to-order metal signs, wood pieces, and custom commissions shipping nationwide from American workshops.`,
    url: `${SITE_URL}/makers/state/${state.slug}`,
    image: `${SITE_URL}/downloads/cnc-garage-builders.png`,
    imageAlt: `Makers in ${state.name}`,
    ogType: "website",
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "CollectionPage",
          "@id": `${SITE_URL}/makers/state/${state.slug}#page`,
          name: `Makers in ${state.name} · Crafters Market`,
          description: `${state.maker_count} vetted independent CNC, plasma, and laser makers based in ${state.name}.`,
          url: `${SITE_URL}/makers/state/${state.slug}`,
          isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website` },
          about: {
            "@type": "Place",
            name: state.name,
            address: {
              "@type": "PostalAddress",
              addressRegion: state.code,
              addressCountry: "US",
            },
          },
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
            { "@type": "ListItem", position: 2, name: "Makers", item: `${SITE_URL}/makers` },
            { "@type": "ListItem", position: 3, name: state.name, item: `${SITE_URL}/makers/state/${state.slug}` },
          ],
        },
        {
          "@type": "ItemList",
          numberOfItems: state.makers.length,
          itemListElement: state.makers.slice(0, 20).map((m, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: `${SITE_URL}/makers/${m.slug}`,
            name: m.name,
          })),
        },
      ],
    },
  } : { jsonLd: null });

  if (notFound) return <Navigate to="/makers" replace />;
  if (loading || !state) {
    return (
      <div className="pt-32 pb-24 grain min-h-screen" data-testid="state-page-loading">
        <div className="w-full max-w-[1400px] mx-auto px-4 md:px-8">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        </div>
      </div>
    );
  }

  // Sibling states ranked by maker count — surfaces in the cross-link grid.
  const siblings = allStates
    .filter((s) => s.code !== state.code)
    .slice(0, 9);

  return (
    <div className="pt-24 pb-24 grain min-h-screen" data-testid={`state-page-${state.slug}`}>
      <div className="w-full max-w-[1400px] mx-auto px-4 md:px-8">
        <Breadcrumbs
          items={[
            { name: "Home", to: "/" },
            { name: "Makers", to: "/makers" },
            { name: state.name },
          ]}
          testId="state-breadcrumbs"
        />
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
          ◆ Makers in {state.name} · {state.maker_count} vetted shops
        </div>
        <h1
          className="font-display text-[44px] sm:text-[64px] md:text-[88px] lg:text-[112px] leading-[0.92] mb-8"
          data-testid={`state-h1-${state.slug}`}
        >
          CNC, Plasma &amp; Laser Makers in {state.name}.
        </h1>

        <p className="font-mono text-base text-[#e5e5e5] max-w-3xl leading-relaxed mb-6">
          {state.maker_count} vetted independent CNC, plasma, and laser makers are based
          in {state.name} and ship handmade metal signs, custom wood pieces, and
          made-to-order commissions across the United States. Every shop below has been
          hand-verified — real workshop, real machines, real past work.
        </p>
        <p className="font-mono text-sm text-[#a3a3a3] max-w-3xl leading-relaxed mb-8">
          Supporting a local {state.name} maker keeps precision-craft skills alive in
          the towns the big retailers ignore, and gets you a piece with a story you can
          actually trace. Most of the makers below offer in-state pickup or local
          delivery on bulky pieces; ask in the message thread before booking if logistics
          matter for your order.
        </p>

        <div className="flex flex-wrap gap-3 mb-16">
          <Link to="/custom-order" className="btn-industrial btn-primary" data-testid={`state-cta-${state.slug}`}>
            Commission a custom piece →
          </Link>
          <Link to="/makers" className="btn-industrial btn-secondary">
            Browse all makers →
          </Link>
          <Link to="/shop" className="btn-industrial btn-secondary">
            Shop the catalog →
          </Link>
        </div>

        {/* Maker grid */}
        <div className="border-t border-[#262626] pt-12">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
            ◆ Approved makers
          </div>
          <h2 className="font-display text-3xl md:text-5xl uppercase mb-8">
            Shops based in {state.name}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {state.makers.map((m) => (
              <Link
                key={m.slug}
                to={`/makers/${m.slug}`}
                className="group border border-[#262626] hover:border-[#ff4500] transition overflow-hidden bg-[#0a0a0a]"
                data-testid={`state-${state.slug}-maker-${m.slug}`}
              >
                {(m.banner_image_url || m.cover || m.portrait) ? (
                  <img
                    src={m.banner_image_url || m.cover || m.portrait}
                    alt={`${m.name} workshop in ${state.name}`}
                    className="aspect-[4/3] w-full object-cover group-hover:scale-105 transition duration-700"
                    loading="lazy"
                  />
                ) : (
                  <div className="aspect-[4/3] w-full bg-[#121212] grid place-items-center font-display text-5xl text-[#525252]">
                    {(m.name || "?").slice(0, 1)}
                  </div>
                )}
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="font-display text-xl group-hover:text-[#ff4500] transition leading-tight">
                      {m.name}
                    </div>
                    {m.is_veteran_owned && <VeteranBadge size="xs" />}
                  </div>
                  {m.location && (
                    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#737373] mb-2">
                      ◆ {m.location}
                    </div>
                  )}
                  {(m.tagline || m.headline) && (
                    <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed line-clamp-2">
                      {m.tagline || m.headline}
                    </p>
                  )}
                  {Array.isArray(m.techniques) && m.techniques.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {m.techniques.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#525252] border border-[#262626] px-2 py-0.5"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Cross-link to other states with makers */}
        {siblings.length > 0 && (
          <div className="border-t border-[#262626] mt-20 pt-12" data-testid="state-siblings">
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">
              ◆ Makers in other states
            </div>
            <h2 className="font-display text-3xl md:text-5xl uppercase mb-8">
              Keep exploring
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {siblings.map((s) => (
                <Link
                  key={s.code}
                  to={`/makers/state/${s.slug}`}
                  className="group border border-[#262626] hover:border-[#ff4500] p-4 transition block"
                  data-testid={`state-sibling-${s.slug}`}
                >
                  <div className="font-display text-lg group-hover:text-[#ff4500] transition">
                    {s.name}
                  </div>
                  <div className="font-mono text-[10px] text-[#737373] mt-1">
                    {s.maker_count} {s.maker_count === 1 ? "maker" : "makers"}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
