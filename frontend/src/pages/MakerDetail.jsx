import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchMaker, fetchProducts } from "../lib/api";
import { useStructuredData } from "../lib/seo";
import ProductCard from "../components/ProductCard";
import MakerReviews from "../components/MakerReviews";
import FollowButton from "../components/FollowButton";

export default function MakerDetail() {
  const { slug } = useParams();
  const [m, setM] = useState(null);
  const [products, setProducts] = useState([]);

  useEffect(() => {
    fetchMaker(slug).then(setM);
    fetchProducts({ maker: slug }).then(setProducts);
  }, [slug]);

  useStructuredData(m ? {
    title: `${m.name} · Crafters Market`,
    description: m.bio,
    image: m.cover || m.portrait,
    url: `${window.location.origin}/makers/${m.slug}`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": m.name,
      "description": m.bio,
      "image": m.portrait,
      "url": `${window.location.origin}/makers/${m.slug}`,
      "address": { "@type": "PostalAddress", "addressLocality": m.location },
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": m.rating,
        "reviewCount": Math.max(m.listings_count, 1),
      },
    },
  } : { jsonLd: null });

  if (!m) return <div className="pt-40 text-center font-mono text-sm text-[#a3a3a3]">Loading…</div>;

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="maker-detail">
      <div className="relative h-[60vh] overflow-hidden border-b border-[#262626] mb-16 -mx-4 md:-mx-8 xl:-mx-12">
        <img
          src={m.banner_image_url || m.cover}
          alt={m.name}
          className="absolute inset-0 w-full h-full object-cover"
          data-testid="maker-detail-hero-image"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-black/60 to-transparent" />
        <div className="absolute bottom-10 left-4 md:left-8 xl:left-12 right-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3 flex items-center gap-3">
            <span>◆ Approved Maker</span>
            {m.subscription_status === "active" && (
              <span
                className="text-emerald-400 border border-emerald-400/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em]"
                data-testid="maker-plus-badge"
              >
                ★ Plus
              </span>
            )}
          </div>
          <h1 className="font-display text-[64px] md:text-[120px] leading-[0.88]">{m.name}</h1>
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-[#a3a3a3] mt-2">{m.location} · {m.listings_count} listings · ★ {m.rating}</div>
          <div className="mt-5">
            <FollowButton makerSlug={m.slug} makerName={m.name} />
          </div>
        </div>
      </div>
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="grid md:grid-cols-12 gap-8 mb-16">
          <p className="md:col-span-7 font-mono text-base text-[#e5e5e5] leading-relaxed">{m.bio}</p>
          <div className="md:col-span-4 md:col-start-9 flex flex-wrap gap-2 self-start">
            {m.techniques.map((t) => <span key={t} className="tag text-[#ff4500] border-[#ff4500]">{t}</span>)}
          </div>
        </div>
        <h2 className="font-display text-4xl md:text-6xl mb-8">From the workshop</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((p, i) => <ProductCard key={p.id} p={p} i={i} />)}
        </div>
        <MakerReviews makerSlug={m.slug} makerName={m.name} />
        <Link to="/makers" className="inline-block mt-12 industrial-link font-mono text-xs uppercase tracking-[0.22em]">← All makers</Link>
      </div>
    </div>
  );
}
