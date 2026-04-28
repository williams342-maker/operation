import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchProduct, fetchMaker } from "../lib/api";
import { useCart } from "../lib/cart";
import { useStructuredData } from "../lib/seo";
import { ArrowLeft, ZoomIn } from "lucide-react";
import SaveDropButton from "../components/SaveDropButton";
import ImageLightbox from "../components/ImageLightbox";
import VeteranBadge from "../components/VeteranBadge";

export default function ProductDetail() {
  const { slug } = useParams();
  const [p, setP] = useState(null);
  const [maker, setMaker] = useState(null);
  const [active, setActive] = useState(0);
  // null = closed; 0..N = open at that image index
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const { add } = useCart();

  useEffect(() => {
    setActive(0);
    setSelectedVariantId(null);
    fetchProduct(slug).then(async (prod) => {
      setP(prod);
      // Auto-select first variant if any
      if (prod?.variants?.length) setSelectedVariantId(prod.variants[0].id);
      if (prod?.maker_slug) setMaker(await fetchMaker(prod.maker_slug).catch(() => null));
    });
  }, [slug]);

  useStructuredData(p ? {
    title: `${p.title} · Crafters Market`,
    description: p.description,
    image: p.images?.[0],
    url: `${window.location.origin}/shop/${p.slug}`,
    imageAlt: p.title,
    ogType: "product",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": p.title,
      "description": p.description,
      "image": p.images || [],
      "category": p.category,
      "sku": p.id,
      "brand": maker ? { "@type": "Organization", "name": maker.name } : undefined,
      "offers": {
        "@type": "Offer",
        "url": `${window.location.origin}/shop/${p.slug}`,
        "priceCurrency": "USD",
        "price": p.price,
        "availability": p.in_stock > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      },
    },
  } : { jsonLd: null });

  if (!p) return <div className="pt-40 text-center font-mono text-sm text-[#a3a3a3]">Loading…</div>;

  const hasVariants = (p.variants || []).length > 0;
  const selectedVariant = hasVariants
    ? p.variants.find((v) => v.id === selectedVariantId) || p.variants[0]
    : null;
  const effectivePrice = selectedVariant
    ? Number(p.price) + Number(selectedVariant.price_delta || 0)
    : p.price;
  const effectiveStock = selectedVariant ? selectedVariant.in_stock : p.in_stock;

  const onAdd = () => {
    if (hasVariants && !selectedVariant) return;
    add(p, qty, selectedVariant);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="product-detail">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <Link to="/shop" className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] mb-8">
          <ArrowLeft size={14} /> Back to shop
        </Link>
        <div className="grid md:grid-cols-12 gap-6">
          <div className="md:col-span-5">
            <div className="aspect-[4/5] bg-[#121212] border border-[#262626] overflow-hidden mb-3 relative max-w-[340px] mx-auto md:mx-0 group">
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
                    src={(selectedVariant && selectedVariant.image) || p.images[Math.max(0, active)]}
                    alt={p.title}
                    className="w-full h-full object-cover media-img transition-transform duration-300 group-hover:scale-105"
                    data-testid="product-hero-image"
                  />
                  {/* Zoom hint pill — fades in on hover so it doesn't
                      compete with the image at rest. */}
                  <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-2 py-1 bg-black/70 backdrop-blur border border-[#262626] font-mono text-[9px] uppercase tracking-[0.22em] text-[#e5e5e5] opacity-0 group-hover:opacity-100 transition">
                    <ZoomIn size={10} /> Zoom
                  </span>
                </button>
              )}
              <span className="tag absolute top-4 left-4 text-[#ff4500] border-[#ff4500]">{p.technique}</span>
              {p.model_url && (
                <span className="tag absolute top-4 right-4 text-[#ff4500] border-[#ff4500] font-mono text-[10px]">
                  3D AVAILABLE
                </span>
              )}
            </div>
            <div className="grid grid-cols-5 gap-2 max-w-[340px] mx-auto md:mx-0">
              {p.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  className={`aspect-square overflow-hidden border ${active === i ? "border-[#ff4500]" : "border-[#262626]"}`}
                  data-testid={`product-thumb-${i}`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
              {p.model_url && (
                <button
                  onClick={() => setActive(-1)}
                  className={`aspect-square overflow-hidden border flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.22em] ${
                    active === -1 ? "border-[#ff4500] text-[#ff4500]" : "border-[#262626] text-[#a3a3a3] hover:border-[#ff4500]/40"
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
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">{p.category}</div>
            <h1 className="font-display text-2xl md:text-3xl mb-3 leading-tight">{p.title}</h1>
            <div className="font-display text-2xl text-[#ff4500] mb-4" data-testid="product-price">
              ${effectivePrice.toFixed(2)}
            </div>

            {/* Quick basics — pull only the structural facts (dimensions,
                weight, materials) up here so a buyer scanning gets the
                "is this the right size/heft" answer without reading the
                full marketing copy. The rest goes behind a toggle below. */}
            <ProductBasics product={p} effectiveStock={effectiveStock} />

            <ProductDescription description={p.description} />

            {hasVariants && (
              <div className="mb-6" data-testid="product-variants">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3] mb-3">
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
                            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] text-center pb-2"
                          >
                            {b}
                          </div>
                        ))}
                        {ax1.map((a) => (
                          <React.Fragment key={`r-${a}`}>
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] pr-3 self-center">
                              {a}
                            </div>
                            {ax2.map((b) => {
                              const v = p.variants.find((x) => x.axis1 === a && x.axis2 === b);
                              if (!v) {
                                return <div key={`c-${a}-${b}`} className="border border-[#1a1a1a] m-1" />;
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
                                      ? "border-[#ff4500] bg-[#ff4500]/10"
                                      : "border-[#262626] hover:border-[#ff4500]/50"
                                  } ${oos ? "opacity-40 cursor-not-allowed" : ""}`}
                                >
                                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
                                    {v.price_delta === 0
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
                                ? "border-[#ff4500] bg-[#ff4500]/10"
                                : "border-[#262626] hover:border-[#ff4500]/50"
                            } ${oos ? "opacity-40 cursor-not-allowed" : ""}`}
                          >
                            <div className="font-mono text-xs text-[#e5e5e5]">{v.label}</div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-1">
                              {v.price_delta === 0
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

            <div className="flex items-center gap-4 mb-6">
              <div className="flex items-center border border-[#262626]">
                <button onClick={() => setQty(Math.max(1, qty - 1))} className="px-4 py-3 hover:bg-[#1a1a1a]">−</button>
                <span className="px-4 font-mono text-sm" data-testid="product-qty">{qty}</span>
                <button onClick={() => setQty(qty + 1)} className="px-4 py-3 hover:bg-[#1a1a1a]">+</button>
              </div>
              <button onClick={onAdd} data-testid="product-add-cart" className="btn-industrial btn-primary flex-1 justify-center">
                {added ? "Added ✓" : "Add to cart →"}
              </button>
              <SaveDropButton
                makerSlug={p.maker_slug}
                makerName={maker?.name || p.maker_slug}
                productSlug={p.slug}
              />
            </div>

            {maker && (
              <Link to={`/makers/${maker.slug}`} className="block border border-[#262626] hover:border-[#ff4500] p-5 transition">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3] mb-2">Maker</div>
                <div className="font-display text-2xl mb-1">{maker.name}</div>
                <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">{maker.location}</div>
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
  const stock = stockNum != null ? `${stockNum} in stock` : null;

  const rows = [
    ["Size", dimStr],
    ["Weight", weight],
    ["Materials", materials],
    ["Stock", stock],
  ].filter(([, v]) => v);

  if (rows.length === 0) return null;

  return (
    <dl
      className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-5 border-y border-[#1f1f1f] py-3"
      data-testid="product-basics"
    >
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">{label}</dt>
          <dd className="font-mono text-xs text-[#e5e5e5] text-right truncate" title={value}>{value}</dd>
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
        className={`font-mono text-xs text-[#a3a3a3] leading-relaxed whitespace-pre-line ${
          open ? "" : "line-clamp-2"
        }`}
      >
        {description}
      </p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] hover:text-[#ff5f1f] transition"
        data-testid="product-description-toggle"
      >
        {open ? "↑ Show less" : "↓ View full description"}
      </button>
    </div>
  );
}
