/**
 * Maker Studio · Public Kit Gallery · /kits
 *
 * Phase 7 — discovery hub for every public design kit on the platform.
 * Anonymous-friendly so it can act as an Etsy-style browse surface +
 * SEO landing page for "free SVG/DXF design kits".
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, Package, Loader2, Search } from "lucide-react";
import { http } from "../lib/api";
import { useStructuredData } from "../lib/seo";

export default function KitsGallery() {
  const [kits, setKits] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    http.get("/studio/kits/public?limit=80")
      .then((r) => setKits(r.data?.kits || []))
      .catch(() => setKits([]));
  }, []);

  useStructuredData({
    title: "Design Kits · Free SVG + DXF bundles · Crafters Market",
    description:
      "Browse curated CNC-ready design packs from the Crafters Market community. Free SVG + DXF — download bundles in one click.",
    url: "https://craftersmarket.org/kits",
  });

  const filtered = (kits || []).filter((k) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return (
      (k.title || "").toLowerCase().includes(needle) ||
      (k.description || "").toLowerCase().includes(needle)
    );
  });

  return (
    <div className="min-h-screen bg-paper text-ink pt-32 pb-24">
      <div className="max-w-6xl mx-auto px-4 md:px-8">
        {/* Header */}
        <div className="mb-12 max-w-3xl">
          <div className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.32em] text-[#00ffff] mb-3">
            ◆ Maker Studio · Design Kit Gallery
          </div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[0.95] mb-4" data-testid="kits-gallery-title">
            Curated design packs.<br />
            <span className="text-brand">Free SVG + DXF.</span>
          </h1>
          <p className="font-mono text-sm text-ink-muted leading-relaxed mb-6 max-w-2xl">
            Every kit is a tight bundle of CNC-ready designs — laser, plasma, router. Open
            individual files, remix in the Studio, or grab the whole pack as a single ZIP.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              to="/studio"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand text-[#0a0a0a] hover:bg-brand-hover font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
              data-testid="kits-gallery-make-cta"
            >
              <Sparkles size={14} /> Build a kit
            </Link>
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search kits..."
                className="w-full pl-9 pr-3 py-2.5 bg-paper border border-line focus:border-[#00ffff] outline-none font-mono text-xs text-ink placeholder:text-ink-muted"
                data-testid="kits-gallery-search"
              />
            </div>
          </div>
        </div>

        {/* Grid */}
        {kits === null ? (
          <div className="py-24 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-brand" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="border border-line bg-paper p-12 text-center" data-testid="kits-gallery-empty">
            <Package size={28} className="mx-auto mb-4 text-ink-muted" />
            <div className="font-display text-2xl mb-2">
              {kits.length === 0 ? "No public kits yet" : "No kits match your search"}
            </div>
            <p className="font-mono text-xs text-ink-muted mb-6">
              {kits.length === 0
                ? "Be the first — publish a kit from the Studio and it lands here."
                : "Try a different keyword or browse all kits."}
            </p>
            <Link
              to="/studio"
              className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.22em] text-[#00ffff] hover:text-brand"
            >
              Open the Studio →
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5" data-testid="kits-gallery-grid">
            {filtered.map((k, i) => (
              <KitCard key={k.id} kit={k} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KitCard({ kit, index }) {
  const cover = kit.cover_url || "";
  const isSvgData = cover.startsWith("data:image/svg");
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 12) * 0.04 }}
      className="group border border-line hover:border-brand transition bg-paper"
      data-testid={`kit-card-${kit.slug}`}
    >
      <Link to={`/kits/${kit.slug}`} className="block">
        <div className="aspect-[3/2] bg-white overflow-hidden flex items-center justify-center [&_svg]:max-w-full [&_svg]:max-h-full">
          {cover ? (
            isSvgData ? (
              <div
                className="w-full h-full p-4 flex items-center justify-center"
                dangerouslySetInnerHTML={{ __html: atob(cover.split(",")[1] || "") }}
              />
            ) : (
              <img src={cover} alt={kit.title} className="w-full h-full object-contain p-4" loading="lazy" />
            )
          ) : (
            <Package size={32} className="text-ink-muted" />
          )}
        </div>
        <div className="p-4 space-y-2">
          <div className="font-display text-lg leading-tight text-ink group-hover:text-brand transition line-clamp-1">
            {kit.title}
          </div>
          {kit.description && (
            <p className="font-mono text-[11px] text-ink-muted line-clamp-2 leading-relaxed">
              {kit.description}
            </p>
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-ink-muted">
              {kit.file_count} {kit.file_count === 1 ? "file" : "files"}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#00ffff] group-hover:text-brand">
              Open →
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
