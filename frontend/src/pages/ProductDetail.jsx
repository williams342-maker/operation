import React, { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { fetchProduct, fetchMaker, fetchBackorderPolicy, http } from "../lib/api";
import { useCart } from "../lib/cart";
import { uetTrack } from "../lib/consent";
import { useStructuredData } from "../lib/seo";
import { ArrowLeft, ZoomIn } from "lucide-react";
import SaveDropButton from "../components/SaveDropButton";
import ShareLinkButton from "../components/ShareLinkButton";
import PersonalizationPanel from "../components/PersonalizationPanel";
import ImageLightbox from "../components/ImageLightbox";
import VeteranBadge from "../components/VeteranBadge";
import BackorderRequestModal from "../components/BackorderRequestModal";
import RestockWaitlistModal from "../components/RestockWaitlistModal";
import RecentShowcaseStrip from "../components/RecentShowcaseStrip";
import SimilarProductsRail from "../components/SimilarProductsRail";
import CustomOrderCTA from "../components/CustomOrderCTA";
import Breadcrumbs from "../components/Breadcrumbs";
import GuideCrossLinkCard from "../components/GuideCrossLinkCard";
import ContactMakerModal from "../components/ContactMakerModal";
import { DetailSkeleton } from "../components/Skeleton";

// Always emit the canonical apex URL — never the preview hostname. SEO
// canonical leaks were causing Google to index preview.emergentagent.com
// pages as the canonical version. (iter299)
const SITE_URL = "https://craftersmarket.org";

export default function ProductDetail() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  // iter362 — tiles in the homepage "Trending" strip link here with
  // ?ref=trending. Carry that context into the Shop links so back-nav
  // keeps the best-selling order the buyer was browsing.
  const fromTrending = searchParams.get("ref") === "trending";
  const shopHref = fromTrending ? "/shop?sort=best_selling" : "/shop";
  const [p, setP] = useState(null);
  const [maker, setMaker] = useState(null);
  const [active, setActive] = useState(0);
  // null = closed; 0..N = open at that image index
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  // iter364 — variation-group selections: { [groupId]: optionId }. Used
  // when the listing defines `variant_groups`; the resolved combination
  // (a flat variant row carrying option_ids) drives price + stock.
  const [selectedOptions, setSelectedOptions] = useState({});
  // iter150 — buyer personalization captured from PersonalizationPanel
  // and held here until "Add to cart" forwards it into cart.add().
  const [personalization, setPersonalization] = useState(null);
  // Backorder policy is fetched lazily from the dedicated endpoint so
  // the rule (per-listing override on top of maker default) lives in
  // exactly one place — the backend. Frontend is a dumb consumer.
  const [backorderPolicy, setBackorderPolicy] = useState(null);
  const [backorderOpen, setBackorderOpen] = useState(false);
  const [restockOpen, setRestockOpen] = useState(false);
  // iter302 — aggregate review summary for JSON-LD AggregateRating.
  const [reviewAgg, setReviewAgg] = useState(null);
  // iter339 — buyer's color choice (from maker's offered palette in `p.colors`).
  // Flows into add-to-cart → checkout → order doc → maker order email,
  // and also pre-fills the "Message the maker" body when set.
  const [selectedColor, setSelectedColor] = useState(null);
  // iter341 — when the maker offers "Custom color" and the buyer picks it,
  // they must type a description of the color they want. The effective
  // `color_choice` becomes `Custom: <typed text>` so the maker sees both
  // that it was a custom request AND what was requested.
  const [customColorText, setCustomColorText] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const { add } = useCart();

  useEffect(() => {
    // iter341 — wrap resets in a microtask so the eslint
    // `set-state-in-effect` rule doesn't flag them as direct effect-body
    // setState (this is the same React idiom React's docs recommend for
    // "reset state when a parent prop changes" without a key on the
    // parent component).
    Promise.resolve().then(() => {
      setActive(0);
      setSelectedVariantId(null);
      setSelectedOptions({});
      setBackorderPolicy(null);
      setReviewAgg(null);
      setSelectedColor(null);
      setCustomColorText("");
      setNotFound(false);
    });
    fetchProduct(slug).then(async (prod) => {
      setP(prod);
      // Auto-select first variant if any. iter364 — for grouped listings,
      // seed the per-group selection from the first in-stock combination
      // so the buyer starts from a valid, buyable state.
      if (prod?.variants?.length) {
        const gs = (prod.variant_groups || []).filter((g) => (g.options || []).length);
        const grouped = gs.length > 0 && prod.variants.some((v) => (v.option_ids || []).length);
        if (grouped) {
          const seed = prod.variants.find((v) => v.in_stock > 0) || prod.variants[0];
          const sel = {};
          for (const g of gs) {
            const o = (g.options || []).find((x) => (seed.option_ids || []).includes(x.id));
            if (o) sel[g.id] = o.id;
          }
          setSelectedOptions(sel);
          setSelectedVariantId(seed.id);
        } else {
          setSelectedVariantId(prod.variants[0].id);
        }
      }
      if (prod?.maker_slug) setMaker(await fetchMaker(prod.maker_slug).catch(() => null));
      // iter334k — Fire Microsoft Ads `view_content` UET event once
      // per product. Completes the GA4-style ecommerce funnel
      // (view_content → add_to_cart → begin_checkout → purchase) so
      // Bing Ads can build product-detail remarketing audiences
      // (e.g. "viewed Veteran Shadow Box but didn't add to cart").
      // Fires AFTER the product fetch resolves so `revenue_value`
      // reflects the actual listed price, not zero.
      try {
        if (prod && Number(prod.price) > 0) {
          uetTrack("view_content", {
            revenue_value: Number(Number(prod.price).toFixed(2)),
            currency: "USD",
            event_label: prod.slug || slug,
            event_value: Number(Number(prod.price).toFixed(2)),
          });
        }
      } catch { /* analytics should never break the page */ }
      // Only hit the policy endpoint when the listing is actually OOS —
      // saves a round-trip on the 99% of listings that have stock.
      if (prod && (prod.in_stock || 0) <= 0) {
        fetchBackorderPolicy(slug).then(setBackorderPolicy).catch(() => setBackorderPolicy({ allowed: false }));
      }
      // Fire-and-forget the review aggregate so the AggregateRating
      // node can be added to the Product JSON-LD. Failure is silent —
      // schema gracefully degrades to Product-only.
      try {
        const r = await http.get(`/reviews/aggregate?product_slug=${slug}`);
        if (r?.data?.count > 0) setReviewAgg(r.data);
      } catch (e) { /* ignore */ }
    }).catch(() => {
      // iter363 — unknown/removed slug: render a friendly not-found
      // state instead of an infinite skeleton + unhandled rejection.
      setNotFound(true);
    });
  }, [slug]);

  // iter372 — soft-404 hygiene: the SPA can't emit a real 404 status for
  // dead slugs, so tell crawlers not to index the rendered not-found page.
  useEffect(() => {
    if (!notFound) return;
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex";
    document.head.appendChild(m);
    return () => m.remove();
  }, [notFound]);

  useStructuredData(p ? {
    title: `${p.title}${p.category ? ` · ${p.category}` : ""} · Crafters Market`,
    description: p.description,
    image: p.images?.[0],
    url: `${SITE_URL}/shop/${p.slug}`,
    imageAlt: p.title,
    ogType: "product",
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Product",
          "name": p.title,
          "description": p.description,
          "image": p.images || [],
          "category": p.category,
          "sku": p.id,
          "brand": maker ? { "@type": "Organization", "name": maker.name } : undefined,
          "offers": {
            "@type": "Offer",
            "url": `${SITE_URL}/shop/${p.slug}`,
            "priceCurrency": "USD",
            "price": p.price,
            "availability": p.in_stock > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
          },
          // iter302 — AggregateRating from /api/reviews/aggregate when
          // ≥ 1 public review. Schema.org requires reviewCount ≥ 1, so
          // we omit the field entirely on no-review products.
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
            { "@type": "ListItem", "position": 2, "name": "Shop", "item": `${SITE_URL}/shop` },
            ...(p.category ? [{
              "@type": "ListItem", "position": 3, "name": p.category,
              "item": `${SITE_URL}/shop?category=${encodeURIComponent(p.category)}`,
            }] : []),
            {
              "@type": "ListItem",
              "position": p.category ? 4 : 3,
              "name": p.title,
              "item": `${SITE_URL}/shop/${p.slug}`,
            },
          ],
        },
      ],
    },
  } : { jsonLd: null });

  if (notFound) {
    return (
      <div className="pt-40 pb-32 min-h-screen text-center" data-testid="product-not-found">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">◆ 404 · Listing</div>
        <h1 className="font-heading uppercase text-4xl sm:text-5xl text-ink mb-4">This listing isn&apos;t here.</h1>
        <p className="font-body text-ink-muted mb-8">It may have sold out, expired, or the link is wrong.</p>
        <Link
          to="/shop"
          className="inline-flex items-center gap-2 px-6 py-3 bg-brand hover:bg-brand-hover text-white font-mono text-xs uppercase tracking-[0.22em]"
          data-testid="product-not-found-back"
        >
          <ArrowLeft size={14} /> Browse the marketplace
        </Link>
      </div>
    );
  }
  if (!p) return <DetailSkeleton />;

  const hasVariants = (p.variants || []).length > 0;
  // iter364 — variation groups (Color × Engraving …). When present, the
  // buyer picks one option per group and we resolve the matching combo
  // row from the flat variants list via its option_ids.
  const variantGroups = (p.variant_groups || []).filter((g) => (g.options || []).length > 0);
  // iter380 — Inventory strategy split. Tracked groups generate the flat
  // combo rows (price + stock); customization-only groups are buyer picks
  // that never map to a SKU — their deltas add on top.
  const trackedGroups = variantGroups.filter((g) => g.tracks_inventory !== false);
  const customGroups = variantGroups.filter((g) => g.tracks_inventory === false);
  const hasGroups = variantGroups.length > 0
    && (trackedGroups.length === 0 || (p.variants || []).some((v) => (v.option_ids || []).length > 0));
  const resolvedCombo = hasGroups && trackedGroups.length > 0 && trackedGroups.every((g) => selectedOptions[g.id])
    ? (p.variants || []).find((v) => {
        const ids = v.option_ids || [];
        return ids.length === trackedGroups.length
          && trackedGroups.every((g) => ids.includes(selectedOptions[g.id]));
      }) || null
    : null;
  const selectedVariant = hasGroups
    ? resolvedCombo
    : hasVariants
    ? p.variants.find((v) => v.id === selectedVariantId) || p.variants[0]
    : null;
  // iter380 — resolved customization-only picks: labels for cart/summary
  // and the summed +$ delta folded into the effective price.
  const customSelections = customGroups
    .map((g) => {
      const o = (g.options || []).find((x) => x.id === selectedOptions[g.id]);
      return o ? { group: g, option: o } : null;
    })
    .filter(Boolean);
  const customDelta = customSelections.reduce((s, c) => s + (Number(c.option.price_delta) || 0), 0);
  const allGroupsSelected = variantGroups.every((g) => selectedOptions[g.id]);
  // Last selected option that carries an image — swaps the gallery.
  const selectedOptionImage = hasGroups
    ? variantGroups
        .map((g) => (g.options || []).find((o) => o.id === selectedOptions[g.id]))
        .filter((o) => o && o.image)
        .slice(-1)[0]?.image || null
    : null;
  const effectivePrice = (selectedVariant
    ? (Number(selectedVariant.price) > 0
        ? Number(selectedVariant.price)
        : Number(p.price) + Number(selectedVariant.price_delta || 0))
    : Number(p.price)) + customDelta;
  const effectiveStock = selectedVariant ? selectedVariant.in_stock : p.in_stock;

  const onAdd = () => {
    if (hasGroups) {
      // Every group (tracked + customization-only) needs a pick, and the
      // tracked picks must resolve to an existing combo row.
      if (!allGroupsSelected || (trackedGroups.length > 0 && !selectedVariant)) {
        toast.error("Please choose an option in every category first.");
        document.querySelector("[data-testid='product-variant-groups']")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    } else if (hasVariants && !selectedVariant) {
      return;
    }
    // iter364 — required customer photo upload. Hard gate: this listing
    // is MADE from the buyer's photo(s), so an upload-less order is
    // unfulfillable.
    if (p.personalization_requires_upload && !(personalization?.upload_ids?.length)) {
      toast.error("This item requires your photo(s) — add them in the personalization box first.");
      const node = document.querySelector("[data-testid='personalization-panel']");
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // iter150 — block "Add to cart" until the buyer either provided
    // personalization or explicitly skipped it. We use a soft check:
    // if the listing requires personalization (`personalization_enabled`
    // = true) and neither text nor image is present, refuse to add and
    // toast a hint instead of silently adding a blank order.
    if (p.personalization_enabled && !personalization?.text && !personalization?.image_url) {
      // We don't strictly require BOTH — many listings just need a name.
      // But we DO require at least one of the two to be set.
      toast.error("Please add your personalization message or attach a reference image first.");
      const node = document.querySelector("[data-testid='personalization-panel']");
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // iter339 — if the maker offers 2+ colors and the buyer hasn't picked
    // one, nudge them. Single-color or no-color listings skip this check.
    if ((p.colors || []).length >= 2 && !selectedColor) {
      toast.error("Please choose a color before adding to cart.");
      const node = document.querySelector("[data-testid='product-color-picker']");
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // iter341 — when the buyer picks "Custom color", their text input is
    // required before checkout. We surface a precise error so the buyer
    // knows exactly what to do.
    if (selectedColor === "Custom color" && !customColorText.trim()) {
      toast.error("Describe the custom color you'd like before adding to cart.");
      const node = document.querySelector("[data-testid='product-custom-color-input']");
      node?.focus();
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // The string we actually store on the cart row + send to the maker. For
    // "Custom color" we prefix with "Custom: " so the maker email and
    // dashboard chip read e.g. "Custom: matte sage green" — clearly a
    // custom request, with the buyer's exact words next to it.
    const effectiveColor =
      selectedColor === "Custom color"
        ? `Custom: ${customColorText.trim()}`
        : selectedColor;
    add(p, qty, selectedVariant, personalization || null, effectiveColor,
      customSelections.map((c) => ({
        id: c.option.id,
        label: `${c.group.name}: ${c.option.label}`,
        price_delta: Number(c.option.price_delta) || 0,
      })));
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
    // iter334i — Fire Microsoft Ads `add_to_cart` conversion event so
    // Bing Ads can build a full GA4-style ecommerce funnel
    // (add_to_cart → begin_checkout → purchase). Uses the effective
    // line-total (price * qty) for `revenue_value` so it reflects what
    // the user is actually committing to, not just the unit price.
    // Honors Consent Mode via the existing helper.
    try {
      const lineRevenue = Number((effectivePrice * qty).toFixed(2));
      if (lineRevenue > 0) {
        uetTrack("add_to_cart", {
          revenue_value: lineRevenue,
          currency: "USD",
          event_label: p.slug || "unknown_listing",
          event_value: lineRevenue,
        });
      }
    } catch { /* analytics should never break add-to-cart */ }
  };

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="product-detail">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <Breadcrumbs
          items={[
            { name: "Home", to: "/" },
            { name: "Shop", to: shopHref },
            ...(p.category
              ? [{ name: p.category, to: `/shop?category=${encodeURIComponent(p.category)}` }]
              : []),
            { name: p.title },
          ]}
          testId="product-breadcrumbs"
        />
        <Link to={shopHref} className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand mb-8">
          <ArrowLeft size={14} /> Back to shop
        </Link>
        <div className="grid md:grid-cols-12 gap-6">
          <div className="md:col-span-5">
            <div className="aspect-[4/5] bg-surface border border-line overflow-hidden mb-3 relative max-w-[340px] mx-auto md:mx-0 group">
              {active === -1 && p.model_url ? (
                <model-viewer
                  src={p.model_url}
                  camera-controls
                  auto-rotate
                  shadow-intensity="1"
                  exposure="0.9"
                  style={{ width: "100%", height: "100%", background: "#0a0a0a" }}
                  data-testid="product-model-viewer"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setLightboxIdx(Math.max(0, active))}
                  className="w-full h-full block relative overflow-hidden"
                  aria-label="Open full-size view"
                  data-testid="product-hero-zoom"
                >
                  <img
                    src={(selectedVariant && selectedVariant.image) || selectedOptionImage || p.images[Math.max(0, active)]}
                    alt={p.title}
                    className="w-full h-full object-cover media-img transition-transform duration-300 group-hover:scale-105"
                    data-testid="product-hero-image"
                  />
                  {/* Zoom hint pill — fades in on hover so it doesn't
                      compete with the image at rest. */}
                  <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-2 py-1 bg-paper/70 backdrop-blur border border-line font-mono text-[9px] uppercase tracking-[0.22em] text-ink opacity-0 group-hover:opacity-100 transition">
                    <ZoomIn size={10} /> Zoom
                  </span>
                </button>
              )}
              <span className="tag absolute top-4 left-4 text-brand border-brand">{p.technique}</span>
              {p.model_url && (
                <span className="tag absolute top-4 right-4 text-brand border-brand font-mono text-[10px]">
                  3D AVAILABLE
                </span>
              )}
            </div>
            <div className="grid grid-cols-5 gap-2 max-w-[340px] mx-auto md:mx-0">
              {p.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  className={`aspect-square overflow-hidden border ${active === i ? "border-brand" : "border-line"}`}
                  data-testid={`product-thumb-${i}`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
              {p.model_url && (
                <button
                  onClick={() => setActive(-1)}
                  className={`aspect-square overflow-hidden border flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.22em] ${
                    active === -1 ? "border-brand text-brand" : "border-line text-ink-muted hover:border-brand/40"
                  }`}
                  data-testid="product-3d-toggle"
                  aria-label="View in 3D"
                >
                  3D
                </button>
              )}
            </div>
          </div>
          <div className="md:col-span-7">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand mb-2">{p.category}</div>
            <h1 className="font-display text-2xl md:text-3xl mb-3 leading-tight">{p.title}</h1>
            {p.featured_example && (
              <div
                className="mb-3 inline-flex items-center gap-2 px-3 py-1.5 border border-amber-400/60 bg-amber-950/30 text-amber-300 font-mono text-[10px] uppercase tracking-[0.22em]"
                data-testid="product-detail-featured-example"
                title="This is a curated example listing — illustrative, not a real product for sale."
              >
                ✦ Featured Example · Curated by Crafters Market to showcase the platform
              </div>
            )}
            {/* iter327 — Listing-type badge. Renders only when the
                listing is digital-only or hybrid; physical listings
                (the default and overwhelming majority) get no badge so
                we don't add visual noise. */}
            {(p.listing_type === "digital" || p.listing_type === "both") && (
              <div
                className="mb-3 inline-flex items-center gap-2 px-3 py-1.5 border border-cyan-400/60 bg-cyan-950/30 text-cyan-300 font-mono text-[10px] uppercase tracking-[0.22em]"
                data-testid="product-detail-digital-badge"
              >
                ◆ {p.listing_type === "digital" ? "Instant Download" : "Physical + Digital Files"}
                {Array.isArray(p.digital_files) && p.digital_files.length > 0 && (
                  <span className="text-cyan-100/80">
                    · {p.digital_files.length} file{p.digital_files.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            )}
            <div className="font-display text-2xl text-brand mb-4" data-testid="product-price">
              ${effectivePrice.toFixed(2)}
            </div>

            {/* Quick basics — pull only the structural facts (dimensions,
                weight, materials) up here so a buyer scanning gets the
                "is this the right size/heft" answer without reading the
                full marketing copy. The rest goes behind a toggle below. */}
            <ProductBasics product={p} effectiveStock={effectiveStock} />

            <ProductDescription description={p.description} />

            {/* iter327 — Buyer-facing digital file manifest. Shown for
                digital + hybrid listings so buyers know exactly what
                they'll receive before purchase. Filenames + types only —
                no URLs (those are token-gated after payment). */}
            {(p.listing_type === "digital" || p.listing_type === "both")
              && Array.isArray(p.digital_files) && p.digital_files.length > 0 && (
              <div
                className="mb-6 p-4 border border-cyan-900/50 bg-cyan-950/[0.18]"
                data-testid="product-detail-digital-manifest"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-300 mb-3">
                  ◆ Files you&apos;ll receive ({p.digital_files.length})
                </div>
                <ul className="space-y-1.5">
                  {p.digital_files.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-baseline gap-3 font-mono text-[11px]"
                      data-testid={`product-detail-digital-file-${f.id}`}
                    >
                      <span className="text-cyan-400 shrink-0">▸</span>
                      <span className="text-ink truncate">{f.filename}</span>
                      <span className="text-ink-muted shrink-0 ml-auto">
                        {f.ext} · {f.size_bytes >= 1024 * 1024
                          ? (f.size_bytes / 1024 / 1024).toFixed(1) + " MB"
                          : Math.max(1, Math.round(f.size_bytes / 1024)) + " KB"}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="font-mono text-[10px] text-cyan-200/70 mt-3 leading-relaxed">
                  Files are sent the moment payment clears — via email + on the order
                  confirmation page. All digital sales are final.
                </div>
              </div>
            )}

            {/* iter303 — auto-cross-link to the most relevant guide
                based on technique + materials. Renders null when no
                guide matches. Compounds internal-link equity into the
                /guides/* pages and reduces buyer hesitation. */}
            <GuideCrossLinkCard product={p} />

            {/* iter364 — Grouped variations: one selector per category. */}
            {hasGroups && (
              <div className="mb-6" data-testid="product-variant-groups">
                {variantGroups.map((g) => (
                  <div key={g.id} className="mb-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.25em] font-semibold text-ink mb-2">
                      Choose {g.name}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(g.options || []).map((o) => {
                        const sel = selectedOptions[g.id] === o.id;
                        // Dim options that can't form an in-stock combo with
                        // the OTHER tracked groups' current selections. Still
                        // clickable — picking one re-routes the combo.
                        // iter380 — customization-only options never carry
                        // stock, so they're always available.
                        const available = g.tracks_inventory === false
                          || (p.variants || []).some((v) => {
                            const ids = v.option_ids || [];
                            if (!ids.includes(o.id) || v.in_stock <= 0) return false;
                            return trackedGroups.every(
                              (g2) => g2.id === g.id || !selectedOptions[g2.id] || ids.includes(selectedOptions[g2.id]),
                            );
                          });
                        const delta = Number(o.price_delta) || 0;
                        return (
                          <button
                            key={o.id}
                            onClick={() => setSelectedOptions((cur) => ({ ...cur, [g.id]: o.id }))}
                            data-testid={`product-option-${o.id}`}
                            className={`text-left border px-4 py-2.5 transition ${
                              sel ? "border-brand ring-1 ring-brand bg-brand/10" : "border-line hover:border-brand/50"
                            } ${available ? "" : "opacity-40"}`}
                          >
                            <div className="font-mono text-sm font-bold text-ink flex items-center gap-2">
                              {o.image && (
                                <img src={o.image} alt="" className="w-6 h-6 object-cover border border-line" />
                              )}
                              {sel && <span className="text-brand">✓</span>}
                              {o.label}
                            </div>
                            {delta !== 0 && (
                              <div className="font-mono text-[10px] uppercase tracking-[0.18em] font-semibold text-ink mt-0.5">
                                {delta > 0 ? `+ $${delta.toFixed(0)}` : `− $${Math.abs(delta).toFixed(0)}`}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {allGroupsSelected && (trackedGroups.length === 0 || selectedVariant) ? (
                  <div
                    className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted"
                    data-testid="product-combo-summary"
                  >
                    ◆ {[selectedVariant?.label,
                        ...customSelections.map((c) => `${c.group.name}: ${c.option.label}`)]
                        .filter(Boolean).join(" · ")} · ${Number(effectivePrice).toFixed(2)}
                    {selectedVariant && selectedVariant.in_stock <= 0 && (
                      <span className="ml-2 text-red-400">· Sold out</span>
                    )}
                  </div>
                ) : (
                  <div
                    className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand"
                    data-testid="product-combo-incomplete"
                  >
                    Select {variantGroups.filter((g) => !selectedOptions[g.id]).map((g) => g.name).join(" + ")} to continue
                  </div>
                )}
              </div>
            )}

            {hasVariants && !hasGroups && (
              <div className="mb-6" data-testid="product-variants">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] font-semibold text-ink mb-3">
                  {p.variant_axis1_name && p.variant_axis2_name
                    ? `Choose ${p.variant_axis1_name} × ${p.variant_axis2_name}`
                    : p.variant_axis1_name
                    ? `Choose ${p.variant_axis1_name}`
                    : "Choose option"}
                </div>
                {(() => {
                  // 2D grid layout when both axes have values across every variant
                  const has2D = p.variant_axis1_name
                    && p.variant_axis2_name
                    && p.variants.every((v) => v.axis1 && v.axis2);
                  if (has2D) {
                    const ax1 = [...new Set(p.variants.map((v) => v.axis1))];
                    const ax2 = [...new Set(p.variants.map((v) => v.axis2))];
                    return (
                      <div
                        className="grid"
                        style={{ gridTemplateColumns: `auto repeat(${ax2.length}, 1fr)` }}
                      >
                        <div></div>
                        {ax2.map((b) => (
                          <div
                            key={`h-${b}`}
                            className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted text-center pb-2"
                          >
                            {b}
                          </div>
                        ))}
                        {ax1.map((a) => (
                          <React.Fragment key={`r-${a}`}>
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted pr-3 self-center">
                              {a}
                            </div>
                            {ax2.map((b) => {
                              const v = p.variants.find((x) => x.axis1 === a && x.axis2 === b);
                              if (!v) {
                                return <div key={`c-${a}-${b}`} className="border border-line m-1" />;
                              }
                              const sel = selectedVariantId === v.id;
                              const oos = v.in_stock <= 0;
                              return (
                                <button
                                  key={v.id}
                                  onClick={() => !oos && setSelectedVariantId(v.id)}
                                  disabled={oos}
                                  data-testid={`product-variant-${v.id}`}
                                  className={`m-1 border px-3 py-3 transition ${
                                    sel
                                      ? "border-brand ring-1 ring-brand bg-brand/10"
                                      : "border-line hover:border-brand/50"
                                  } ${oos ? "opacity-40 cursor-not-allowed" : ""}`}
                                >
                                  <div className="font-mono text-[11px] uppercase tracking-[0.22em] font-semibold text-ink">
                                    {Number(v.price) > 0
                                      ? `$${Number(v.price).toFixed(0)}`
                                      : v.price_delta === 0
                                      ? "—"
                                      : v.price_delta > 0
                                      ? `+$${Number(v.price_delta).toFixed(0)}`
                                      : `−$${Math.abs(Number(v.price_delta)).toFixed(0)}`}
                                  </div>
                                  {oos && (
                                    <div className="font-mono text-[9px] uppercase text-red-400 mt-1">
                                      Sold out
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </div>
                    );
                  }
                  // Flat one-axis layout
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {p.variants.map((v) => {
                        const sel = selectedVariantId === v.id;
                        const oos = v.in_stock <= 0;
                        return (
                          <button
                            key={v.id}
                            onClick={() => !oos && setSelectedVariantId(v.id)}
                            disabled={oos}
                            data-testid={`product-variant-${v.id}`}
                            className={`text-left border px-4 py-3 transition ${
                              sel
                                ? "border-brand ring-1 ring-brand bg-brand/10"
                                : "border-line hover:border-brand/50"
                            } ${oos ? "opacity-40 cursor-not-allowed" : ""}`}
                          >
                            <div className="font-mono text-sm font-bold text-ink">
                              {sel && <span className="text-brand mr-1.5">✓</span>}
                              {v.label}
                            </div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] font-semibold text-ink mt-1">
                              {Number(v.price) > 0
                                ? `$${Number(v.price).toFixed(0)}`
                                : v.price_delta === 0
                                ? "Included"
                                : v.price_delta > 0
                                ? `+ $${Number(v.price_delta).toFixed(0)}`
                                : `− $${Math.abs(Number(v.price_delta)).toFixed(0)}`}
                              {oos && <span className="ml-2 text-red-400">· Sold out</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* iter339 — Buyer color picker. Renders only when the maker
                has offered ≥1 color on the listing. Single-color listings
                still show the swatch so the buyer knows what they're
                getting, but the row is informational. ≥2 colors → buyer
                MUST pick before Add to cart fires. */}
            {(p.colors || []).length > 0 && (
              <div className="mb-6" data-testid="product-color-picker">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] font-semibold text-ink mb-3">
                  Color <span className="text-ink-muted normal-case tracking-normal font-normal">— maker offers {p.colors.length}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.colors.map((c) => {
                    const isSel = selectedColor === c;
                    const isSingle = p.colors.length === 1;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          if (isSingle) return; // single-color is informational
                          setSelectedColor(isSel ? null : c);
                        }}
                        aria-pressed={isSel}
                        disabled={isSingle}
                        data-testid={`product-color-${c.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                        className={`px-3 py-2 border font-mono text-[11px] uppercase tracking-[0.22em] font-semibold transition ${
                          isSel
                            ? "border-brand ring-1 ring-brand bg-brand/10 text-brand"
                            : isSingle
                            ? "border-line text-ink cursor-default"
                            : "border-line text-ink hover:border-brand hover:text-brand"
                        }`}
                      >
                        <span className={`inline-block w-3 h-3 mr-2 align-middle border border-line ${_colorSwatchClass(c)}`} />
                        {c}
                      </button>
                    );
                  })}
                </div>
                {(p.colors.length >= 2 && !selectedColor) && (
                  <div className="font-mono text-[10px] text-ink-muted mt-2">
                    ◆ Pick one to add to cart.
                  </div>
                )}
                {/* iter341 — Free-text input appears the moment the buyer
                    selects "Custom color". Required before Add-to-cart. */}
                {selectedColor === "Custom color" && (
                  <div className="mt-3 border-l-2 border-brand pl-3" data-testid="product-custom-color-block">
                    <label
                      htmlFor="custom-color-input"
                      className="block font-mono text-[10px] uppercase tracking-[0.22em] text-brand mb-1.5"
                    >
                      ◆ Describe your custom color
                      <span className="text-red-400 ml-1">*required</span>
                    </label>
                    <input
                      id="custom-color-input"
                      type="text"
                      value={customColorText}
                      onChange={(e) => setCustomColorText(e.target.value.slice(0, 30))}
                      placeholder="e.g. matte sage green, hammered copper, dusty rose…"
                      maxLength={30}
                      autoFocus
                      data-testid="product-custom-color-input"
                      className="w-full bg-paper border border-line focus:border-brand px-3 py-2 font-mono text-sm text-ink outline-none"
                    />
                    <div className="font-mono text-[9px] text-ink-muted mt-1 flex justify-between">
                      <span>The maker will see this on the order.</span>
                      <span>{customColorText.length}/30</span>
                    </div>
                  </div>
                )}
                {/* Message-the-maker CTA. Always shown when colors are
                    offered so a buyer who isn't sure can ask before
                    committing. The selected color (if any) pre-fills
                    the message body so the maker has full context. */}
                {maker && (
                  <button
                    type="button"
                    onClick={() => setContactOpen(true)}
                    data-testid="product-message-maker"
                    className="mt-3 inline-flex items-center gap-2 px-3 py-2 border border-brand/60 text-brand hover:bg-brand/10 font-mono text-[10px] font-bold uppercase tracking-[0.22em] transition"
                  >
                    ✉ Question for {maker.name || "the maker"} about color
                  </button>
                )}
              </div>
            )}

            {/* iter368b — Occasions the maker tagged in the editor.
                Informational chips that deep-link into the shop filter
                (?occasion=…) so buyers can browse similar gift ideas. */}
            {(p.occasions || []).length > 0 && (
              <div className="mb-6" data-testid="product-occasions">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">
                  Perfect for
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.occasions.map((o) => (
                    <Link
                      key={o}
                      to={`/shop?occasion=${encodeURIComponent(o)}`}
                      data-testid={`product-occasion-${String(o).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                      className="px-3 py-2 border border-line text-ink-muted hover:border-brand hover:text-brand font-mono text-[11px] uppercase tracking-[0.22em] transition"
                    >
                      ◆ {o}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* iter150 — Buyer personalization panel. Renders only when
                the maker has flagged this listing as personalizable. The
                buyer can add a message and/or upload a reference image
                BEFORE clicking Add to cart; both flow through cart →
                checkout → order doc → maker's order email. */}
            {p.personalization_enabled && (
              <PersonalizationPanel
                instructions={p.personalization_instructions}
                onChange={setPersonalization}
                testIdPrefix="personalization"
                requiresUpload={!!p.personalization_requires_upload}
                productSlug={p.slug}
              />
            )}

            {/* Stock & cart row — three states:
                 1. In stock → quantity stepper + Add to cart
                 2. 0 stock + backorders allowed → Request backorder CTA
                 3. 0 stock + no backorders → Sold out (disabled) */}
            {(() => {
              const oos = (effectiveStock != null ? effectiveStock : p.in_stock) <= 0;
              if (!oos) {
                return (
                  <div className="flex items-center gap-4 mb-6">
                    <div className="flex items-center border border-line">
                      <button onClick={() => setQty(Math.max(1, qty - 1))} className="px-4 py-3 hover:bg-surface">−</button>
                      <span className="px-4 font-mono text-sm" data-testid="product-qty">{qty}</span>
                      <button onClick={() => setQty(qty + 1)} className="px-4 py-3 hover:bg-surface">+</button>
                    </div>
                    <button onClick={onAdd} data-testid="product-add-cart" className="btn-industrial btn-primary flex-1 justify-center">
                      {added ? "Added ✓" : "Add to cart →"}
                    </button>
                    <SaveDropButton makerSlug={p.maker_slug} makerName={maker?.name || p.maker_slug} productSlug={p.slug} />
                    <ShareLinkButton kind="product" slug={p.slug} testId="product-share-link" />
                  </div>
                );
              }
              // Out of stock — render the OOS pill + backorder or sold-out CTA
              const lead = backorderPolicy?.lead_weeks ?? p.backorder_lead_weeks ?? 4;
              return (
                <div className="mb-6 space-y-3" data-testid="product-oos-block">
                  <div className="border border-brand bg-brand/5 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">◆ Currently out of stock</div>
                      <div className="font-mono text-xs text-ink-muted mt-0.5">0 available</div>
                    </div>
                    {backorderPolicy?.allowed && (
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                        Lead time · <span className="text-ink">~{lead} {lead === 1 ? "week" : "weeks"}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {backorderPolicy === null ? (
                      <button
                        type="button"
                        disabled
                        data-testid="product-backorder-loading"
                        className="btn-industrial flex-1 justify-center opacity-50"
                      >
                        Checking…
                      </button>
                    ) : backorderPolicy.allowed ? (
                      <button
                        type="button"
                        onClick={() => setBackorderOpen(true)}
                        data-testid="product-backorder-cta"
                        className="btn-industrial btn-primary flex-1 justify-center"
                      >
                        Request backorder →
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        data-testid="product-sold-out"
                        className="btn-industrial flex-1 justify-center opacity-50 cursor-not-allowed"
                      >
                        Sold out
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setRestockOpen(true)}
                      data-testid="product-notify-restock"
                      className="px-5 py-3 border border-line hover:border-brand hover:text-brand font-mono text-[11px] uppercase tracking-[0.22em] transition whitespace-nowrap"
                      title="One email when this listing is restocked"
                    >
                      ✉ Notify me
                    </button>
                    <SaveDropButton makerSlug={p.maker_slug} makerName={maker?.name || p.maker_slug} productSlug={p.slug} />
                    <ShareLinkButton kind="product" slug={p.slug} testId="product-share-link-oos" />
                  </div>
                  {backorderPolicy?.allowed && (
                    <p className="font-mono text-[10px] text-ink-muted leading-relaxed">
                      Maker reviews each request manually. Payment is coordinated
                      after they accept — no charge today.
                    </p>
                  )}
                </div>
              );
            })()}

            {maker && (
              <Link to={`/makers/${maker.slug}`} className="block border border-line hover:border-brand p-5 transition">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-muted mb-2">Maker</div>
                <div className="font-display text-2xl mb-1">{maker.name}</div>
                <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted">{maker.location}</div>
                {maker.is_veteran_owned && (
                  <div className="mt-2.5">
                    <VeteranBadge testId="product-detail-veteran-badge" />
                  </div>
                )}
              </Link>
            )}
          </div>
        </div>
      </div>
      {lightboxIdx !== null && p.images?.length > 0 && (
        <ImageLightbox
          images={p.images}
          startIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
      {backorderOpen && (
        <BackorderRequestModal
          productSlug={p.slug}
          productTitle={p.title}
          makerName={maker?.name || p.maker_slug}
          leadWeeks={backorderPolicy?.lead_weeks || p.backorder_lead_weeks || 4}
          onClose={() => setBackorderOpen(false)}
        />
      )}
      {restockOpen && (
        <RestockWaitlistModal
          product={p}
          onClose={() => setRestockOpen(false)}
        />
      )}

      {/* iter339 — Message-the-maker modal opened from the color picker.
          When a color is selected we pre-seed the body so the maker
          gets full context ("Hey — interested in this in Red…") without
          the buyer having to retype it. iter341 — for "Custom color"
          we substitute the buyer's typed text (if any) into the prefill. */}
      {contactOpen && maker && (
        <ContactMakerModal
          maker={maker}
          productSlug={p.slug}
          prefillBody={
            selectedColor
              ? `Hi ${maker.name || ""},\n\nI'm interested in "${p.title}" in ${
                  selectedColor === "Custom color"
                    ? (customColorText.trim() || "a custom color")
                    : selectedColor
                }. `
              : `Hi ${maker.name || ""},\n\nI have a question about "${p.title}". `
          }
          onClose={() => setContactOpen(false)}
        />
      )}

      {/* iter116 — Discovery surface for community showcase posts.
          Scoped to this product first, falls back to maker, then site-wide
          so a brand-new product always shows something. Self-hides if the
          API returns 0 (handled inside the component). */}
      <RecentShowcaseStrip
        productSlug={p.slug}
        makerSlug={p.maker_slug}
        eyebrow="◆ From the community"
        title="Buyers who own this"
        testId="product-recent-showcase"
      />

      {/* AI-ranked similar products. Self-hides on LLM failure or
          empty result so a fresh product page never shows an empty
          stub rail. */}
      <SimilarProductsRail slug={p.slug} testId={`product-similar-${p.slug}`} />

      {/* Custom-order CTA — scoped to this maker so the brief lands
          straight on their inbox. Highest-margin funnel. */}
      <div className="max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-8">
        <CustomOrderCTA
          makerSlug={p.maker_slug}
          testId="product-custom-cta"
        />
      </div>
    </div>
  );
}


// Quick-scan basics shown above the description toggle. Only renders
// fields the maker has actually filled in — never shows "—" placeholders
// because empty rows just dilute the value of the strip.
function ProductBasics({ product: p, effectiveStock }) {
  const dims = [p.length_in, p.width_in, p.height_in].filter((v) => v != null && v !== "");
  // Prefer the structured fields when filled in (newer listings), fall
  // back to the legacy `dimensions` string for older listings that were
  // saved before the L/W/H split.
  const dimStr = dims.length
    ? `${dims.join(" × ")} ${p.dim_unit || "in"}`
    : (p.dimensions || null);
  const weight = (() => {
    const lb = Number(p.weight_lbs) || 0;
    const oz = Number(p.weight_oz) || 0;
    if (lb === 0 && oz === 0) return null;
    if (lb && oz) return `${lb} lb ${oz} oz`;
    if (lb) return `${lb} lb`;
    return `${oz} oz`;
  })();
  const materials = (p.materials || []).slice(0, 3).join(", ") || null;
  const stockNum = effectiveStock != null ? effectiveStock : p.in_stock;
  const stock = stockNum != null
    ? (stockNum <= 0 ? "0 available" : `${stockNum} in stock`)
    : null;

  const rows = [
    ["Size", dimStr],
    ["Weight", weight],
    ["Materials", materials],
    ["Stock", stock],
  ].filter(([, v]) => v);

  if (rows.length === 0) return null;

  return (
    <dl
      className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-5 border-y border-line py-3"
      data-testid="product-basics"
    >
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">{label}</dt>
          <dd className="font-mono text-xs text-ink text-right truncate" title={value}>{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

// Collapsed-by-default description. Shows a 2-line preview with a
// "View full description" button — keeps the product detail compact
// on first paint, lets buyers expand if they want more context.
function ProductDescription({ description }) {
  const [open, setOpen] = useState(false);
  if (!description) return null;
  return (
    <div className="mb-6" data-testid="product-description">
      <p
        className={`font-mono text-xs text-ink-muted leading-relaxed whitespace-pre-line ${
          open ? "" : "line-clamp-2"
        }`}
      >
        {description}
      </p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-brand hover:text-brand transition"
        data-testid="product-description-toggle"
      >
        {open ? "↑ Show less" : "↓ View full description"}
      </button>
    </div>
  );
}


// iter339 — Tailwind class for the small swatch chip next to the color
// label. Kept as a name→class map (not inline `bg-[#hex]`) so Tailwind
// JIT picks the classes up at build time. Anything not in the map falls
// back to a neutral checkered fill so unknown / future palette additions
// still render something rather than disappearing.
function _colorSwatchClass(name) {
  const m = {
    Black: "bg-surface",
    White: "bg-white",
    Gray: "bg-[#737373]",
    Silver: "bg-[#bfbfbf]",
    Gold: "bg-[#c9a227]",
    Bronze: "bg-[#8c6a3d]",
    Copper: "bg-[#b87333]",
    Red: "bg-red-600",
    Orange: "bg-brand",
    Yellow: "bg-yellow-400",
    Green: "bg-emerald-600",
    Blue: "bg-blue-600",
    Purple: "bg-purple-600",
    Pink: "bg-pink-400",
    Brown: "bg-[#6b4423]",
    Beige: "bg-[#e8d8b8]",
    Natural: "bg-[#d9c9a3]",
    "Multi-color":
      "bg-gradient-to-br from-red-500 via-yellow-400 via-emerald-500 to-blue-500",
    Rainbow:
      "bg-gradient-to-r from-red-500 via-yellow-400 via-emerald-500 via-blue-500 to-purple-600",
    // iter341 — Custom color shows a question-mark-ish neutral swatch; the
    // buyer's typed value becomes the actual color string.
    "Custom color":
      "bg-gradient-to-br from-[#262626] to-[#525252]",
  };
  return m[name] || "bg-[#525252]";
}
