import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMakers } from "../lib/api";

export default function MakersPage() {
  const [makers, setMakers] = useState([]);
  useEffect(() => { fetchMakers().then(setMakers); }, []);

  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="makers-page">
      <div className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ APPROVED MAKERS</div>
        <h1 className="font-display text-[64px] md:text-[120px] leading-[0.88] mb-16">
          The <span className="text-outline-orange">Workshop</span><br />Roster
        </h1>
        <div className="grid md:grid-cols-2 gap-8">
          {makers.map((m) => (
            <Link key={m.id} to={`/makers/${m.slug}`} data-testid={`maker-card-${m.slug}`}
              className="group bg-[#121212] border border-[#262626] hover:border-[#ff4500] transition overflow-hidden">
              <div className="aspect-[4/3] overflow-hidden relative">
                <img src={m.cover} alt={m.name} className="w-full h-full object-cover media-img group-hover:scale-105 transition duration-700" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                  <div>
                    <div className="font-display text-3xl text-white">{m.name}</div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] mt-1">{m.location}</div>
                  </div>
                  <div className="tag text-[#ff4500] border-[#ff4500]">{m.listings_count} listings</div>
                </div>
              </div>
              <div className="p-6 border-t border-[#262626]">
                <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed mb-4">{m.bio}</p>
                <div className="flex gap-2">{m.techniques.map((t) => <span key={t} className="tag">{t}</span>)}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
