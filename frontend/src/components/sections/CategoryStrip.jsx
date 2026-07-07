import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

// Each tile pairs a category label with a real photographic hero image.
// We deliberately pick distinct subjects per category — earlier copies
// of this list re-used the same metalwork photo across multiple tiles
// which made the row feel repetitive. Sticking to authentic shots (no
// stylized badges or 3D-rendered cartoons) keeps the marketplace feeling
// like a directory of working makers, not a clip-art catalog.
// iter388 — user request: removed the Wall Art (ampersand), Address #s
// (house) and Business (bar interior) tiles — their photos read poorly
// at thumbnail size and cluttered the strip.
const TILES = [
  { label: "Custom Signs",  q: "Custom Signs",     img: "https://images.unsplash.com/photo-1776142519609-a4858781a01a?crop=entropy&cs=srgb&fm=jpg&w=600&q=85" },
  { label: "Outdoor Art",   q: "Outdoor Art",      img: "https://images.pexels.com/photos/17180807/pexels-photo-17180807.jpeg?auto=compress&cs=tinysrgb&w=640" },
  { label: "Wedding Gifts", q: "Wedding Monogram", img: "https://images.unsplash.com/photo-1519741497674-611481863552?crop=entropy&cs=srgb&fm=jpg&w=600&q=85" },
  { label: "Plasma",        q: "Plasma",           img: "https://images.unsplash.com/photo-1689960253768-72a12bc8320f?crop=entropy&cs=srgb&fm=jpg&w=600&q=85" },
  { label: "3D Printing",   q: "3D Printed Piece", img: "https://images.unsplash.com/photo-1567361808960-dec9cb578182?crop=entropy&cs=srgb&fm=jpg&w=600&q=85" },
  { label: "Router",        q: "Router",           img: "https://images.unsplash.com/photo-1620207418302-439b387441b0?crop=entropy&cs=srgb&fm=jpg&w=600&q=85" },
  // iter386 — user request: broaden the strip beyond signs/CNC with more
  // craft types. iter392 — these categories now have stocked listings, so
  // tiles deep-link to the exact `?category=` filter (matches seed/product
  // `category` values verbatim) instead of a fuzzy keyword search. Images
  // swapped to the same verified photos used by the listings themselves.
  { label: "Woodworking",   cat: "Woodworking",       img: "https://static.prod-images.emergentagent.com/jobs/ad0439ad-da94-4caf-a818-28a88417ad46/images/6ad6ba41aba7ad691fc8d84b56346674335a977771b20e6e89e9647bc087e682.png" },
  { label: "Pottery",       cat: "Pottery & Ceramics", img: "https://images.unsplash.com/photo-1468322638156-074863f9362e?crop=entropy&cs=srgb&fm=jpg&w=600&q=85" },
  { label: "Leather Goods", cat: "Leather Goods",     img: "https://images.unsplash.com/photo-1517254797898-04edd251bfb3?crop=entropy&cs=srgb&fm=jpg&w=600&q=85" },
  { label: "Fiber & Textiles", cat: "Fiber & Textiles", img: "https://static.prod-images.emergentagent.com/jobs/ad0439ad-da94-4caf-a818-28a88417ad46/images/726f314711119649e49e73f1d347dcdc5ae477dac02a3edcf47526939defc817.png" },
  { label: "Jewelry",       q: "Jewelry",          img: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?crop=entropy&cs=srgb&fm=jpg&w=600&q=85" },
  // iter430 — Home Fragrance & Wellness (first fragrance maker onboarded).
  { label: "Home Fragrance", cat: "Home Fragrance & Wellness", img: "https://images.unsplash.com/photo-1603006905003-be475563bc59?crop=entropy&cs=srgb&fm=jpg&w=600&q=85" },
];

export default function CategoryStrip() {
  return (
    <section className="w-full py-10 md:py-12 bg-paper border-b border-line" data-testid="category-strip">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">◆ Browse</div>
            <h2 className="font-display text-3xl md:text-5xl">Shop by Category</h2>
          </div>
          <Link to="/shop" className="industrial-link font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted hover:text-brand hidden md:inline">View all →</Link>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 xl:grid-cols-12 gap-4 md:gap-5">
          {TILES.map((t, i) => (
            <motion.div key={t.label}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.5 }}
            >
              <Link
                to={t.cat ? `/shop?category=${encodeURIComponent(t.cat)}` : `/shop?q=${encodeURIComponent(t.q)}`}
                className="group flex flex-col items-center gap-3"
                data-testid={`cat-tile-${t.label.toLowerCase().replace(/\s|#/g, "-")}`}
              >
                <div className="relative w-full aspect-square rounded-full overflow-hidden border-2 border-line group-hover:border-brand transition">
                  <img src={t.img} alt={t.label} className="absolute inset-0 w-full h-full object-cover media-img group-hover:scale-110 transition duration-700" />
                </div>
                <div className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-ink group-hover:text-brand transition text-center">
                  {t.label}
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
