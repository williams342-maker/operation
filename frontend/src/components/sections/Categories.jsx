import React from "react";
import { motion } from "framer-motion";

const categories = [
  {
    no: "01",
    title: "Wall Art",
    sub: "& Home Decor",
    blurb: "Precision-cut masterpieces for every space.",
    pieces: 24,
    img: "https://images.unsplash.com/photo-1705661902771-28a65b16ea98?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwzfHxtb2Rlcm4lMjBtZXRhbCUyMHdhbGwlMjBhcnQlMjBzaWdufGVufDB8fHx8MTc3NzE1NDk4NHww&ixlib=rb-4.1.0&q=85",
  },
  {
    no: "02",
    title: "Custom Signs",
    sub: "Made to Order",
    blurb: "Personalized pieces for homes & businesses.",
    pieces: 18,
    img: "https://images.unsplash.com/photo-1776142519609-a4858781a01a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1MDV8MHwxfHNlYXJjaHw0fHxjdXN0b20lMjB3b29kJTIwY2FydmVkJTIwd2FsbCUyMHNpZ258ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85",
  },
  {
    no: "03",
    title: "Outdoor Art",
    sub: "Built to Last",
    blurb: "Weather-resistant metal for life outdoors.",
    pieces: 12,
    img: "https://images.pexels.com/photos/17180807/pexels-photo-17180807.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
  },
];

export default function Categories() {
  return (
    <section id="categories" className="relative w-full py-24 md:py-32 bg-[#0a0a0a]">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-14 md:mb-20">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
              ◆ 002 / Categories
            </div>
            <h2 className="font-display text-[56px] md:text-[100px] lg:text-[140px]">
              Browse <span className="text-outline-orange">By</span> Category
            </h2>
          </div>
          <p className="font-mono text-sm text-[#a3a3a3] max-w-sm">
            Three pillars. Hundreds of one-of-a-kind objects. Pick your craft.
          </p>
        </div>

        <ul className="border-t border-[#262626]" data-testid="categories-list">
          {categories.map((c, i) => (
            <motion.li
              key={c.no}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.7, delay: i * 0.1 }}
              className="group relative border-b border-[#262626] hover:bg-[#0f0f0f] transition-colors duration-500"
              data-testid={`category-${c.no}`}
            >
              <a href="#shop" className="grid grid-cols-12 gap-4 md:gap-8 py-10 md:py-14 items-center px-2 md:px-6">
                <div className="col-span-2 md:col-span-1 font-mono text-sm md:text-lg text-[#a3a3a3] group-hover:text-[#ff4500] transition">
                  {c.no}
                </div>
                <div className="col-span-10 md:col-span-5">
                  <div className="font-display text-4xl md:text-7xl lg:text-8xl group-hover:translate-x-3 transition-transform duration-500">
                    {c.title}
                  </div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#a3a3a3] mt-2 md:mt-4">
                    {c.sub}
                  </div>
                </div>
                <div className="hidden md:block md:col-span-3 font-mono text-sm text-[#a3a3a3]">
                  {c.blurb}
                </div>
                <div className="hidden md:flex md:col-span-2 items-center justify-end font-mono text-xs uppercase tracking-[0.25em] text-[#a3a3a3]">
                  {c.pieces} pieces
                </div>
                <div className="col-span-12 md:col-span-1 flex md:justify-end">
                  <span className="font-mono text-xs uppercase tracking-[0.2em] text-[#e5e5e5] group-hover:text-[#ff4500] transition">
                    Explore →
                  </span>
                </div>

                {/* Hover preview image */}
                <motion.div
                  className="pointer-events-none absolute right-6 md:right-14 top-1/2 -translate-y-1/2 w-40 h-52 md:w-64 md:h-80 overflow-hidden border border-[#ff4500]"
                  initial={{ opacity: 0, scale: 0.9, rotate: -3 }}
                  whileInView={{ opacity: 0 }}
                  whileHover={{ opacity: 1, scale: 1, rotate: 2 }}
                  transition={{ duration: 0.4 }}
                  style={{ display: "none" }}
                />
              </a>

              {/* Always-visible thumbnail (desktop) */}
              <div className="pointer-events-none absolute right-4 md:right-12 top-1/2 -translate-y-1/2 hidden lg:block w-44 h-56 overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                <img src={c.img} alt={c.title} className="w-full h-full object-cover media-img" />
                <div className="absolute inset-0 ring-1 ring-[#ff4500]/60" />
              </div>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}
