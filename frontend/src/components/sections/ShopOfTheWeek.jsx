import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, Sparkles, Clock } from "lucide-react";
import { fetchShopOfTheWeek } from "../../lib/api";
import useCountdown from "../../hooks/useCountdown";

// Crafters Plus spotlight — rotates the highest-GMV active subscriber onto
// the homepage with their custom banner + 3 best-selling products. Hides
// itself entirely if no Plus shops exist yet.
export default function ShopOfTheWeek() {
  const [data, setData] = useState(null);
  const [ready, setReady] = useState(false);
  const { label: countdownLabel, expired } = useCountdown({ weekly: true });

  useEffect(() => {
    fetchShopOfTheWeek()
      .then((r) => setData(r))
      .catch(() => setData(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready || !data?.maker) return null;
  const m = data.maker;
  const banner = m.banner_image_url || m.cover;
  const products = data.products || [];

  return (
    <section
      className="relative w-full py-20 md:py-28 bg-paper border-b border-line overflow-hidden"
      data-testid="shop-of-the-week"
    >
      {/* Ambient backdrop pulled from banner — sets the mood without overpowering the cards. */}
      {banner && (
        <div className="absolute inset-0 pointer-events-none">
          <img src={banner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.12]" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a] via-[#0a0a0a]/60 to-[#0a0a0a]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,69,0,0.18),transparent_55%)]" />
        </div>
      )}

      <div className="relative w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="flex items-center gap-2 mb-3"
        >
          <Sparkles size={14} className="text-brand" />
          <div className="font-mono text-[11px] uppercase tracking-[0.32em] text-brand">
            ◆ Shop of the Week · Crafters Plus
          </div>
          {!expired && countdownLabel && (
            <div
              className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 border border-brand/40 bg-[#1a0a05] font-mono text-[10px] uppercase tracking-[0.22em] text-brand"
              data-testid="sotw-countdown"
            >
              <Clock size={11} className="opacity-80" />
              Spotlight ends in
              <span className="text-ink font-semibold tabular-nums" data-testid="sotw-countdown-value">
                {countdownLabel}
              </span>
            </div>
          )}
        </motion.div>

        <div className="grid lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          {/* Hero card — banner + maker meta + jump-to-shop CTA. */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="lg:col-span-7 relative"
          >
            <Link
              to={`/makers/${m.slug}`}
              data-testid="sotw-maker-card"
              className="group block relative aspect-[16/10] lg:aspect-[16/11] overflow-hidden border border-line hover:border-brand transition"
            >
              <img
                src={banner}
                alt={m.name}
                className="absolute inset-0 w-full h-full object-cover transition duration-[1500ms] group-hover:scale-[1.04]"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/85 via-black/45 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />

              <div className="absolute top-5 right-5 flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.28em] px-2.5 py-1 bg-brand text-ink border border-brand">
                  ★ Plus
                </span>
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-surface border border-brand flex items-center justify-center font-mono text-[11px] text-brand">
                    {m.initials}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted">
                    {m.location}
                  </div>
                </div>
                <h2 className="font-display text-4xl md:text-6xl lg:text-7xl leading-[0.92] text-ink mb-3 group-hover:text-brand transition">
                  {m.name}
                </h2>
                {m.bio && (
                  <p className="font-mono text-xs md:text-sm text-ink max-w-xl leading-relaxed line-clamp-2 md:line-clamp-3">
                    {m.bio}
                  </p>
                )}
                <div className="mt-5 flex items-center gap-4 flex-wrap">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand inline-flex items-center gap-2">
                    Visit shop <ArrowUpRight size={12} />
                  </span>
                  {(m.techniques || []).slice(0, 3).map((t) => (
                    <span key={t} className="tag !text-[9px] !py-0.5">{t}</span>
                  ))}
                  {data.weekly_gmv > 0 && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted">
                      · ${Math.round(data.weekly_gmv).toLocaleString()} sold this month
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </motion.div>

          {/* Right rail — top 3 products */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="lg:col-span-5 flex flex-col gap-4"
          >
            <div className="flex items-end justify-between mb-1">
              <h3 className="font-display text-2xl md:text-3xl">Best Sellers</h3>
              <Link
                to={`/shop?maker=${m.slug}`}
                data-testid="sotw-shop-all"
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand"
              >
                Shop all →
              </Link>
            </div>

            {products.length === 0 && (
              <div className="font-mono text-xs text-ink-muted py-8">
                Fresh listings dropping soon.
              </div>
            )}

            {products.map((p, i) => (
              <Link
                key={p.id || p.slug}
                to={`/shop/${p.slug}`}
                data-testid={`sotw-product-${p.slug}`}
                className="group flex items-stretch gap-4 bg-surface border border-line hover:border-brand transition overflow-hidden"
              >
                <div className="w-28 h-28 md:w-32 md:h-32 shrink-0 overflow-hidden border-r border-line">
                  <img
                    src={p.images?.[0]}
                    alt={p.title}
                    className="w-full h-full object-cover transition duration-700 group-hover:scale-110"
                  />
                </div>
                <div className="flex-1 flex flex-col justify-between py-3 pr-4">
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-ink-muted mb-1">
                      #{String(i + 1).padStart(2, "0")} · {p.category}
                    </div>
                    <div className="font-display text-lg md:text-xl leading-tight group-hover:text-brand transition line-clamp-2">
                      {p.title}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="font-display text-2xl text-brand">${p.price}</div>
                    <ArrowUpRight size={16} className="text-ink-muted group-hover:text-brand transition" />
                  </div>
                </div>
              </Link>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
