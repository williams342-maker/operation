import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Quote } from "lucide-react";
import { fetchReviews } from "../../lib/api";

const seed = [
  {
    text: "The custom sign I ordered for our business exceeded every expectation. The metal work is absolutely stunning.",
    name: "Sarah M.",
    loc: "Austin, TX",
    rating: 5,
  },
  {
    text: "Ordered a wedding monogram and it's the most beautiful piece in our home. Incredible craftsmanship.",
    name: "James & Lia R.",
    loc: "Denver, CO",
    rating: 5,
  },
  {
    text: "Fast shipping, perfect quality. The CNC precision really shows — every cut is clean and intentional.",
    name: "David K.",
    loc: "Nashville, TN",
    rating: 5,
  },
];

export default function Reviews() {
  const [reviews, setReviews] = useState(seed);
  useEffect(() => {
    fetchReviews().then((d) => d?.length && setReviews(d.slice(0, 3))).catch(() => {});
  }, []);
  return (
    <section className="relative w-full py-24 md:py-32 bg-paper">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="grid md:grid-cols-12 gap-10 mb-14">
          <div className="md:col-span-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
              ◆ 005 / Reviews
            </div>
            <h2 className="font-display text-[48px] md:text-[80px] leading-[0.9]">
              From The
              <br />
              <span className="text-outline">Customers</span>
            </h2>
          </div>
          <div className="md:col-span-4 md:col-start-9 self-end font-mono text-sm text-ink-muted max-w-sm">
            <div className="text-4xl text-brand font-display">4.97 / 5</div>
            <div className="mt-2">Average rating · 312 verified reviews · 98% repeat buyers.</div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-0 border-y border-line">
          {reviews.map((r, i) => (
            <motion.figure
              key={r.name}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.7, delay: i * 0.12 }}
              className={`relative p-8 md:p-12 ${
                i !== reviews.length - 1 ? "md:border-r border-line" : ""
              } border-b md:border-b-0 hover:bg-paper transition-colors duration-500`}
              data-testid={`review-${i}`}
            >
              <Quote size={32} className="text-brand mb-6" />
              <blockquote className="font-display text-2xl md:text-3xl leading-tight mb-10">
                {r.text}
              </blockquote>
              <figcaption className="flex items-center justify-between pt-6 border-t border-line">
                <div>
                  <div className="font-mono text-xs uppercase tracking-[0.2em] text-ink">
                    {r.name}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-muted mt-1">
                    {r.loc}
                  </div>
                </div>
                <div className="font-mono text-[10px] tracking-[0.25em] text-brand">
                  {"★".repeat(r.rating)}
                </div>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
}
