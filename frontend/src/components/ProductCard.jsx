import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

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
            className="absolute inset-0 w-full h-full object-cover media-img"
            whileHover={{ scale: 1.06 }}
            transition={{ duration: 0.9 }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <span className="tag absolute top-4 left-4 text-[#ff4500] border-[#ff4500]">{p.technique}</span>
          <span className="tag absolute top-4 right-4">{p.category}</span>
          {p.promoted_until && new Date(p.promoted_until) > new Date() && (
            <span
              className="tag absolute bottom-4 left-4 text-emerald-300 border-emerald-400 bg-black/70"
              data-testid={`product-card-promoted-${p.slug}`}
            >
              ★ Featured
            </span>
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
