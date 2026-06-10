import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { fetchMakers } from "../../lib/api";

export default function FeaturedShops() {
  const [makers, setMakers] = useState([]);
  useEffect(() => { fetchMakers().then((m) => setMakers((m || []).slice(0, 4))).catch(() => {}); }, []);
  if (!makers.length) return null;

  return (
    <section className="w-full py-16 md:py-20 bg-paper border-b border-line" data-testid="featured-shops">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="flex items-end justify-between mb-10 gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-2">◆ Featured Shops</div>
            <h2 className="font-display text-3xl md:text-5xl lg:text-6xl">Workshops to Watch</h2>
          </div>
          <Link to="/makers" className="industrial-link font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand whitespace-nowrap">All shops →</Link>
        </div>
        <div className="grid sm:grid-cols-2 gap-6">
          {makers.map((m, i) => (
            <motion.div key={m.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.6 }}
            >
              <Link to={`/makers/${m.slug}`} data-testid={`shop-${m.slug}`}
                className="group block bg-surface border border-line hover:border-brand transition overflow-hidden">
                <div className="grid grid-cols-12 gap-0">
                  <div className="col-span-5 aspect-square overflow-hidden border-r border-line">
                    <img src={m.cover} alt={m.name} loading="lazy" decoding="async" className="w-full h-full object-cover media-img group-hover:scale-105 transition duration-700" />
                  </div>
                  <div className="col-span-7 p-5 md:p-6 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 bg-surface border border-brand flex items-center justify-center font-mono text-[10px] text-brand">
                          {m.initials}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">{m.location}</div>
                      </div>
                      <div className="font-display text-2xl md:text-3xl mb-2 group-hover:text-brand transition">{m.name}</div>
                      <p className="font-mono text-[11px] text-ink-muted leading-relaxed line-clamp-3">{m.bio}</p>
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-line">
                      <div className="flex gap-1">
                        {m.techniques.map((t) => <span key={t} className="tag !text-[10px] !py-0.5">{t}</span>)}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">★ {m.rating}</div>
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
