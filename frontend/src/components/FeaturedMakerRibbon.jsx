/** iter456 — Featured Maker ribbon. Renders only while `makerSlug` is the live feature. */
import React, { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { getFeaturedMaker } from "../lib/featuredMaker";

export default function FeaturedMakerRibbon({ makerSlug, testId = "featured-maker-ribbon", className = "" }) {
  const [featured, setFeatured] = useState(false);
  useEffect(() => {
    let alive = true;
    getFeaturedMaker().then((f) => alive && setFeatured(f?.maker?.slug === makerSlug));
    return () => { alive = false; };
  }, [makerSlug]);
  if (!featured) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 border border-amber-400/70 bg-amber-400/10 text-amber-300 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] ${className}`}
      data-testid={testId}
      title="This week's Featured Maker on Crafters Market"
    >
      <Trophy size={10} /> Featured Maker
    </span>
  );
}
