import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import VeteranBadge from "./VeteranBadge";
import useCountdown from "../hooks/useCountdown";

// Inline live "★ Featured · ends in Xh Ym" badge — only visible while
// `promoted_until` is in the future. Rendered as a sibling so the parent
// card stays a clean motion container.
function PromotedBadge({ until, slug }) {
  const { label, expired } = useCountdown({ target: until });
  if (expired) return null;
  return (
    <span
      className="tag absolute bottom-4 left-4 text-emerald-300 border-emerald-400 bg-black/70 inline-flex items-center gap-1.5"
      data-testid={`product-card-promoted-${slug}`}
    >
      <span>★ Featured</span>
      <span className="opacity-60">·</span>
      <span className="tabular-nums" data-testid={`product-card-promoted-countdown-${slug}`}>
        {label}
      </span>
    </span>
  );
}

export default function ProductCard({ p, i = 0 }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ delay: (i % 4) * 0.06, duration: 0.7 }}
      className="group relative bg-[#121212] border border-[#262626] hover:border-[#ff4500] transition-colors duration-500 overflow-hidden"
      data-testid={`product-card-${p.slug}`}
    >
      <Link to={`/shop/${p.slug}`} className="block">
        <div className="relative aspect-[4/5] overflow-hidden">
          <motion.img
            src={p.images?.[0]} alt={p.title}
            loading={i < 4 ? "eager" : "lazy"}
            decoding="async"
            fetchpriority={i === 0 ? "high" : "auto"}
            className="absolute inset-0 w-full h-full object-cover media-img"
            whileHover={{ scale: 1.06 }}
            transition={{ duration: 0.9 }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <span className="tag absolute top-4 left-4 text-[#ff4500] border-[#ff4500]">{p.technique}</span>
          <span className="tag absolute top-4 right-4">{p.category}</span>
          {p.maker_is_veteran && (
            <VeteranBadge
              size="compact"
              className="absolute top-12 right-4"
              testId={`product-card-veteran-${p.slug}`}
            />
          )}
          {p.maker_is_plus && (
            <span
              className="tag absolute top-12 left-4 text-[#ff4500] border-[#ff4500] bg-black/70 inline-flex items-center gap-1 text-[9px]"
              data-testid={`product-card-plus-${p.slug}`}
              title="Crafters Plus maker"
            >
              ◆ PLUS
            </span>
          )}
          {p.promoted_until && new Date(p.promoted_until) > new Date() && (
            <PromotedBadge until={p.promoted_until} slug={p.slug} />
          )}
          <div className="absolute bottom-4 right-4 flex items-end justify-end gap-3">
            <div className="font-display text-3xl text-white drop-shadow-md">${p.price}</div>
            <div className="w-10 h-10 border border-white/40 group-hover:bg-[#ff4500] group-hover:border-[#ff4500] transition flex items-center justify-center">
              <ArrowUpRight size={18} className="text-white" />
            </div>
          </div>
        </div>
        <div className="p-6 border-t border-[#262626]">
          <h3 className="font-display text-2xl mb-2">{p.title}</h3>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a3a3a3]">
            {p.dimensions || "Made to order"}
          </p>
        </div>
      </Link>
    </motion.article>
  );
}
