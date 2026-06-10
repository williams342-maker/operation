import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchProducts } from "../../lib/api";

const fallback = [
  {
    title: "Mountain Range Silhouette",
    cat: "Wall Art",
    price: "$149",
    technique: "PLASMA",
    maker: "Iron & Oak Studio",
    location: "Nashville, TN",
    desc: '36" wide mountain scene cut from 14ga mild steel. Raw steel finish with clear coat.',
    img: "https://images.unsplash.com/photo-1705661902771-28a65b16ea98?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwzfHxtb2Rlcm4lMjBtZXRhbCUyMHdhbGwlMjBhcnQlMjBzaWdufGVufDB8fHx8MTc3NzE1NDk4NHww&ixlib=rb-4.1.0&q=85",
    span: "lg:col-span-7 lg:row-span-2",
    tall: true,
  },
  {
    title: "Rustic Family Name Sign",
    cat: "Custom Signs",
    price: "$79",
    technique: "ROUTER",
    maker: "Iron & Oak Studio",
    location: "Nashville, TN",
    desc: 'Custom family name sign in 3/4" oak. Up to 12 characters. Stained walnut finish.',
    img: "https://images.unsplash.com/photo-1776142519609-a4858781a01a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1MDV8MHwxfHNlYXJjaHw0fHxjdXN0b20lMjB3b29kJTIwY2FydmVkJTIwd2FsbCUyMHNpZ258ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85",
    span: "lg:col-span-5",
  },
  {
    title: "Custom Business Sign",
    cat: "Custom Signs",
    price: "$325",
    technique: "CUSTOM",
    maker: "MetalArt Pro Shop",
    location: "Austin, TX",
    desc: 'Your business name and logo cut from 1/4" steel. Up to 36" wide. Multiple finishes.',
    img: "https://images.pexels.com/photos/17180807/pexels-photo-17180807.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
    span: "lg:col-span-5",
  },
  {
    title: "Industrial Address Numbers",
    cat: "Signs",
    price: "$59",
    technique: "LASER",
    maker: "MetalArt Pro Shop",
    location: "Austin, TX",
    desc: "Laser-cut steel address numbers, 6\" tall. Powder coated matte black. Set of 4.",
    img: "https://images.unsplash.com/photo-1689960253768-72a12bc8320f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHw0fHxjbmMlMjBwbGFzbWElMjBjdXR0aW5nJTIwbWV0YWwlMjB3b3JrZXJ8ZW58MHx8fHwxNzc3MTU0OTc2fDA&ixlib=rb-4.1.0&q=85",
    span: "lg:col-span-7",
  },
];

function ProductCard({ p, i }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 60 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ delay: (i % 3) * 0.1, duration: 0.8, ease: [0.22, 0.61, 0.36, 1] }}
      className={`group relative bg-surface border border-line hover:border-brand transition-colors duration-500 overflow-hidden ${p.span}`}
      data-testid={`product-${(p.slug || p.title).toLowerCase().replace(/\s/g, "-")}`}
    >
      <Link to={p.slug ? `/shop/${p.slug}` : "/shop"} className={`block relative overflow-hidden ${p.tall ? "aspect-[4/5]" : "aspect-[4/3]"}`}>
        <motion.img
          src={p.img}
          alt={p.title}
          className="absolute inset-0 w-full h-full object-cover media-img"
          whileHover={{ scale: 1.06 }}
          transition={{ duration: 0.9, ease: [0.22, 0.61, 0.36, 1] }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <span className="tag absolute top-4 left-4 text-brand border-brand">
          {p.technique}
        </span>
        <span className="tag absolute top-4 right-4">{p.cat}</span>
        <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
          <div className="font-display text-3xl md:text-4xl text-ink pr-2">{p.price}</div>
          <div className="w-10 h-10 border border-white/40 group-hover:bg-brand group-hover:border-brand transition flex items-center justify-center">
            <ArrowUpRight size={18} className="text-ink" />
          </div>
        </div>
      </Link>
      <div className="p-6 md:p-8 border-t border-line">
        <h3 className="font-display text-2xl md:text-3xl mb-3">{p.title}</h3>
        <p className="font-mono text-xs text-ink-muted leading-relaxed mb-5">{p.desc}</p>
        <div className="flex items-center gap-3 pt-4 border-t border-line">
          <div className="w-9 h-9 bg-surface border border-line flex items-center justify-center font-mono text-[10px] text-brand">
            {p.maker
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)}
          </div>
          <div className="flex-1">
            <div className="font-mono text-xs uppercase tracking-wide text-ink">{p.maker}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted mt-0.5">
              {p.location}
            </div>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

const SPANS = ["lg:col-span-7 lg:row-span-2", "lg:col-span-5", "lg:col-span-5", "lg:col-span-7"];

export default function MakerShowcase() {
  const [products, setProducts] = useState([]);
  useEffect(() => {
    fetchProducts({ featured: true }).then((data) => {
      const items = (data && data.length ? data : fallback).slice(0, 4).map((p, i) => ({
        ...p,
        title: p.title,
        cat: p.category, price: `$${p.price}`,
        technique: p.technique,
        maker: p.maker || p.maker_slug || "",
        location: p.location || "",
        desc: p.description || p.desc || "",
        img: p.images?.[0] || p.img,
        span: p.span || SPANS[i] || "lg:col-span-6",
        tall: i === 0,
      }));
      setProducts(items);
    }).catch(() => setProducts(fallback));
  }, []);

  return (
    <section id="showcase" className="relative w-full py-24 md:py-32 bg-paper border-y border-line">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        {/* Section header */}
        <div className="grid md:grid-cols-12 gap-8 mb-16 md:mb-24">
          <div className="md:col-span-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">
              ◆ 001 / Showcase
            </div>
            <div className="font-mono text-xs uppercase tracking-[0.25em] text-ink-muted">
              From our makers
            </div>
          </div>
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="md:col-span-9 font-display text-[56px] md:text-[120px] lg:text-[160px]"
          >
            Maker
            <br />
            <span className="text-outline">Showcase</span>
          </motion.h2>
          <p className="md:col-span-6 md:col-start-7 font-mono text-sm text-ink-muted max-w-xl">
            Handcrafted work from our approved artisan makers — each piece built to order with
            precision tools and unreasonable care.
          </p>
        </div>

        {/* Asymmetric product grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 auto-rows-auto">
          {products.map((p, i) => (
            <ProductCard p={p} i={i} key={p.title} />
          ))}
        </div>

        {/* Footer CTAs */}
        <div className="mt-16 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pt-10 border-t border-line">
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-ink-muted">
            54+ pieces · Updated weekly
          </div>
          <div className="flex flex-wrap gap-4">
            <Link to="/shop" className="btn-industrial border-[#e5e5e5] text-ink" data-testid="showcase-browse-all">
              Browse all listings →
            </Link>
            <Link to="/custom-order" className="btn-industrial btn-primary" data-testid="showcase-custom-order">
              Custom order
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
