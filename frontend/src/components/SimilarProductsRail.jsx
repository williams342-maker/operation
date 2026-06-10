/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { aiSimilarProducts } from "../lib/api";

/**
 * "More like this" rail — AI-ranked similar products on the bottom of
 * the product detail page. Falls silent (renders nothing) if the LLM
 * is unavailable or there's nothing similar — better than an empty
 * "Recommendations" stub on every page.
 */
export default function SimilarProductsRail({ slug, testId = "similar-products-rail" }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    aiSimilarProducts(slug)
      .then((r) => {
        if (cancelled) return;
        setItems(Array.isArray(r.similar) ? r.similar : []);
      })
      .catch(() => !cancelled && setItems([]));
    return () => { cancelled = true; };
  }, [slug]);

  if (!items || items.length === 0) return null;

  return (
    <section className="w-full py-12 md:py-16 border-t border-line" data-testid={testId}>
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="flex items-end justify-between mb-8 gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-2 inline-flex items-center gap-2">
              <Sparkles size={12} className="text-brand" />
              ◆ More like this · AI-ranked
            </div>
            <h2 className="font-display text-3xl md:text-4xl">
              You might also love
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {items.map((p, i) => (
            <motion.article
              key={p.slug}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.1 }}
              transition={{ delay: i * 0.06, duration: 0.4 }}
              className="bg-surface border border-line hover:border-brand transition-colors duration-500 flex flex-col"
              data-testid={`${testId}-card-${p.slug}`}
            >
              <Link to={`/shop/${p.slug}`} className="block group">
                <div className="relative aspect-square overflow-hidden">
                  <img
                    src={p.images?.[0]}
                    alt={p.title}
                    className="absolute inset-0 w-full h-full object-cover media-img group-hover:scale-105 transition duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  {p.featured_example && (
                    <span className="tag absolute top-2 left-2 text-amber-300 border-amber-400/70 bg-black/70 text-[9px]">
                      ✦ EXAMPLE
                    </span>
                  )}
                  <span className="tag absolute top-2 right-2 text-brand border-brand bg-black/70 text-[9px]">
                    {p.technique}
                  </span>
                </div>
                <div className="p-3">
                  <div className="font-display text-base leading-tight line-clamp-2 min-h-[2.5rem] mb-1">{p.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-3">
                    ${p.price?.toFixed(0)}
                  </div>
                  {p.match_reason && (
                    <div
                      className="border-l-2 border-brand pl-2 text-[11px] text-ink-muted leading-snug italic mb-2"
                      data-testid={`${testId}-reason-${p.slug}`}
                    >
                      {p.match_reason}
                    </div>
                  )}
                  <div className="flex items-center justify-end pt-2 border-t border-line">
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                      View <ArrowUpRight size={11} />
                    </span>
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
