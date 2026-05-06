import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { fetchProducts } from "../../lib/api";

export default function ProductRail({ title, eyebrow, category, technique, featured, viewAllHref = "/shop", testId }) {
  const [items, setItems] = useState([]);
  const ref = useRef(null);

  useEffect(() => {
    const params = {};
    if (category) params.category = category;
    if (technique) params.technique = technique;
    if (featured) params.featured = true;
    fetchProducts(params).then((d) => setItems(d.slice(0, 8))).catch(() => {});
  }, [category, technique, featured]);

  const scroll = (dir) => {
    const el = ref.current; if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  if (!items.length) return null;
  return (
    <section className="w-full py-14 md:py-16 bg-[#0a0a0a] border-b border-[#262626]" data-testid={testId || "product-rail"}>
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="flex items-end justify-between mb-8 gap-4">
          <div>
            {eyebrow && <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-2">{eyebrow}</div>}
            <h2 className="font-display text-3xl md:text-5xl lg:text-6xl">{title}</h2>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => scroll(-1)} aria-label="Scroll left"
              className="hidden md:inline-flex w-10 h-10 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] items-center justify-center transition">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => scroll(1)} aria-label="Scroll right"
              className="hidden md:inline-flex w-10 h-10 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] items-center justify-center transition">
              <ChevronRight size={18} />
            </button>
            <Link to={viewAllHref} className="industrial-link font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] whitespace-nowrap">
              See all →
            </Link>
          </div>
        </div>

        <div ref={ref} className="flex gap-5 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
          {items.map((p, i) => (
            <motion.article
              key={p.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.1 }}
              transition={{ delay: (i % 4) * 0.05, duration: 0.5 }}
              className="snap-start flex-shrink-0 w-[260px] md:w-[300px] bg-[#121212] border border-[#262626] hover:border-[#ff4500] transition-colors duration-500"
              data-testid={`rail-product-${p.slug}`}
            >
              <Link to={`/shop/${p.slug}`} className="block">
                <div className="relative aspect-[4/5] overflow-hidden">
                  <img src={p.images?.[0]} alt={p.title} className="absolute inset-0 w-full h-full object-cover media-img hover:scale-105 transition duration-700" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <span className="tag absolute top-3 left-3 text-[#ff4500] border-[#ff4500]">{p.technique}</span>
                  <div className="absolute bottom-3 right-3 w-9 h-9 border border-white/40 hover:bg-[#ff4500] hover:border-[#ff4500] transition flex items-center justify-center">
                    <ArrowUpRight size={16} className="text-white" />
                  </div>
                </div>
                <div className="p-4">
                  <div className="font-display text-xl mb-1 line-clamp-1">{p.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-3 line-clamp-1">
                    {p.dimensions || p.category}
                  </div>
                  <div className="flex items-end justify-between">
                    <div className="font-display text-2xl text-[#ff4500]">${p.price.toFixed(0)}</div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">+ ship</div>
                  </div>
                </div>
              </Link>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
