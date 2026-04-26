import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchProduct, fetchMaker } from "../lib/api";
import { useCart } from "../lib/cart";
import { useStructuredData } from "../lib/seo";
import { ArrowLeft } from "lucide-react";

export default function ProductDetail() {
  const { slug } = useParams();
  const [p, setP] = useState(null);
  const [maker, setMaker] = useState(null);
  const [active, setActive] = useState(0);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const { add } = useCart();

  useEffect(() => {
    setActive(0);
    fetchProduct(slug).then(async (prod) => {
      setP(prod);
      if (prod?.maker_slug) setMaker(await fetchMaker(prod.maker_slug).catch(() => null));
    });
  }, [slug]);

  useStructuredData(p ? {
    title: `${p.title} · Crafters Market`,
    description: p.description,
    image: p.images?.[0],
    url: `${window.location.origin}/shop/${p.slug}`,
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

  const onAdd = () => { add(p, qty); setAdded(true); setTimeout(() => setAdded(false), 2000); };

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="product-detail">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <Link to="/shop" className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] mb-8">
          <ArrowLeft size={14} /> Back to shop
        </Link>
        <div className="grid md:grid-cols-12 gap-8">
          <div className="md:col-span-7">
            <div className="aspect-[4/5] bg-[#121212] border border-[#262626] overflow-hidden mb-3 relative">
              <img src={p.images[active]} alt={p.title} className="w-full h-full object-cover media-img" />
              <span className="tag absolute top-4 left-4 text-[#ff4500] border-[#ff4500]">{p.technique}</span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {p.images.map((img, i) => (
                <button key={i} onClick={() => setActive(i)}
                  className={`aspect-square overflow-hidden border ${active === i ? "border-[#ff4500]" : "border-[#262626]"}`}>
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">{p.category}</div>
            <h1 className="font-display text-5xl md:text-6xl mb-4">{p.title}</h1>
            <div className="font-display text-4xl text-[#ff4500] mb-6">${p.price.toFixed(2)}</div>
            <p className="font-mono text-sm text-[#a3a3a3] leading-relaxed mb-8">{p.description}</p>

            <ul className="border-y border-[#262626] divide-y divide-[#262626] mb-8">
              {p.dimensions && <li className="flex justify-between py-3 font-mono text-xs uppercase tracking-[0.2em]"><span className="text-[#a3a3a3]">Size</span><span>{p.dimensions}</span></li>}
              <li className="flex justify-between py-3 font-mono text-xs uppercase tracking-[0.2em]"><span className="text-[#a3a3a3]">Materials</span><span className="text-right">{p.materials.join(", ")}</span></li>
              <li className="flex justify-between py-3 font-mono text-xs uppercase tracking-[0.2em]"><span className="text-[#a3a3a3]">In stock</span><span>{p.in_stock}</span></li>
            </ul>

            <div className="flex items-center gap-4 mb-6">
              <div className="flex items-center border border-[#262626]">
                <button onClick={() => setQty(Math.max(1, qty - 1))} className="px-4 py-3 hover:bg-[#1a1a1a]">−</button>
                <span className="px-4 font-mono text-sm" data-testid="product-qty">{qty}</span>
                <button onClick={() => setQty(qty + 1)} className="px-4 py-3 hover:bg-[#1a1a1a]">+</button>
              </div>
              <button onClick={onAdd} data-testid="product-add-cart" className="btn-industrial btn-primary flex-1 justify-center">
                {added ? "Added ✓" : "Add to cart →"}
              </button>
            </div>

            {maker && (
              <Link to={`/makers/${maker.slug}`} className="block border border-[#262626] hover:border-[#ff4500] p-5 transition">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3] mb-2">Maker</div>
                <div className="font-display text-2xl mb-1">{maker.name}</div>
                <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3]">{maker.location}</div>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
