import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

const TILES = [
  { label: "Wall Art", q: "Wall Art", img: "https://images.unsplash.com/photo-1705661902771-28a65b16ea98?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwzfHxtb2Rlcm4lMjBtZXRhbCUyMHdhbGwlMjBhcnQlMjBzaWdufGVufDB8fHx8MTc3NzE1NDk4NHww&ixlib=rb-4.1.0&q=85" },
  { label: "Custom Signs", q: "Custom Signs", img: "https://images.unsplash.com/photo-1776142519609-a4858781a01a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1MDV8MHwxfHNlYXJjaHw0fHxjdXN0b20lMjB3b29kJTIwY2FydmVkJTIwd2FsbCUyMHNpZ258ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85" },
  { label: "Outdoor Art", q: "Outdoor Art", img: "https://images.pexels.com/photos/17180807/pexels-photo-17180807.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940" },
  { label: "Address #s", q: "Address Numbers", img: "https://images.unsplash.com/photo-1689960253768-72a12bc8320f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHw0fHxjbmMlMjBwbGFzbWElMjBjdXR0aW5nJTIwbWV0YWwlMjB3b3JrZXJ8ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85" },
  { label: "Wedding Gifts", q: "Wedding Monogram", img: "https://images.unsplash.com/photo-1776142519609-a4858781a01a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1MDV8MHwxfHNlYXJjaHw0fHxjdXN0b20lMjB3b29kJTIwY2FydmVkJTIwd2FsbCUyMHNpZ258ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85" },
  { label: "Business", q: "Business Sign", img: "https://images.pexels.com/photos/17180807/pexels-photo-17180807.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940" },
  { label: "Plasma", q: "Plasma", img: "https://images.unsplash.com/photo-1689960253768-72a12bc8320f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHw0fHxjbmMlMjBwbGFzbWElMjBjdXR0aW5nJTIwbWV0YWwlMjB3b3JrZXJ8ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85" },
  { label: "3D Printing", q: "3D Printed Piece", img: "https://images.unsplash.com/photo-1631704402923-2b5e1f8b94d7?crop=entropy&cs=srgb&fm=jpg&w=600&q=85" },
  { label: "Router", q: "Router", img: "https://images.unsplash.com/photo-1705661902771-28a65b16ea98?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwzfHxtb2Rlcm4lMjBtZXRhbCUyMHdhbGwlMjBhcnQlMjBzaWdufGVufDB8fHx8MTc3NzE1NDk4NHww&ixlib=rb-4.1.0&q=85" },
];

export default function CategoryStrip() {
  return (
    <section className="w-full py-10 md:py-12 bg-[#0a0a0a] border-b border-[#262626]" data-testid="category-strip">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-3">◆ Browse</div>
            <h2 className="font-display text-3xl md:text-5xl">Shop by Category</h2>
          </div>
          <Link to="/shop" className="industrial-link font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] hidden md:inline">View all →</Link>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-9 gap-4 md:gap-5">
          {TILES.map((t, i) => (
            <motion.div key={t.label}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.5 }}
            >
              <Link
                to={`/shop?q=${encodeURIComponent(t.q)}`}
                className="group flex flex-col items-center gap-3"
                data-testid={`cat-tile-${t.label.toLowerCase().replace(/\s|#/g, "-")}`}
              >
                <div className="relative w-full aspect-square rounded-full overflow-hidden border-2 border-[#262626] group-hover:border-[#ff4500] transition">
                  <img src={t.img} alt={t.label} className="absolute inset-0 w-full h-full object-cover media-img group-hover:scale-110 transition duration-700" />
                </div>
                <div className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.18em] text-[#e5e5e5] group-hover:text-[#ff4500] transition text-center">
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
