/**
 * iter455 — Homepage Featured Maker spotlight. Renders only while a
 * feature is live; shows banner asset, bio, product rail + countdown.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { getFeaturedMaker, daysRemaining } from "../../lib/featuredMaker";

export const FeaturedMakerSpotlight = () => {
  const [f, setF] = useState(null);
  useEffect(() => { getFeaturedMaker().then(setF); }, []);
  if (!f?.maker) return null;
  const days = daysRemaining(f.ends_at);

  return (
    <section className="max-w-6xl mx-auto px-4 py-14" data-testid="featured-maker-spotlight">
      <div className="border border-brand/40 bg-paper relative overflow-hidden">
        <div className="grid md:grid-cols-[1.2fr_1fr]">
          {f.banner_url && (
            <img src={f.banner_url} alt={`Featured maker — ${f.maker.name}`}
                 className="w-full h-full object-cover max-h-72 md:max-h-none" loading="lazy" />
          )}
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={14} className="text-brand" />
              <span className="font-mono text-[9px] uppercase tracking-[0.28em] text-brand">
                Featured Maker · {days} day{days === 1 ? "" : "s"} remaining
              </span>
            </div>
            <h2 className="font-display text-3xl md:text-4xl text-ink mb-2">{f.maker.name}</h2>
            {f.headline && <p className="font-mono text-xs text-ink-muted mb-4">{f.headline}</p>}
            {(f.products || []).length > 0 && (
              <div className="flex gap-2 mb-5">
                {f.products.map((p) => (
                  <Link key={p.slug} to={`/shop/${p.slug}`} title={p.title}>
                    <img src={(p.images || [])[0]} alt={p.title}
                         className="w-14 h-14 object-cover border border-line hover:border-brand transition" loading="lazy" />
                  </Link>
                ))}
              </div>
            )}
            <Link to={`/makers/${f.maker.slug}`}
                  className="btn-industrial btn-primary inline-flex"
                  data-testid="featured-spotlight-visit-btn">
              Visit {f.maker.name} →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};
