import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchPosts, fetchPost } from "../lib/api";

export function JournalPage() {
  const [posts, setPosts] = useState([]);
  useEffect(() => { fetchPosts().then(setPosts); }, []);
  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="journal-page">
      <div className="w-full max-w-[1400px] mx-auto px-4 md:px-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">◆ Journal</div>
        <h1 className="font-display text-[56px] md:text-[120px] leading-[0.88] mb-16">Notes From <span className="text-outline">The Workshop</span></h1>
        <div className="grid md:grid-cols-3 gap-6">
          {posts.map((p) => (
            <Link key={p.id} to={`/journal/${p.slug}`} data-testid={`post-${p.slug}`}
              className="group bg-[#121212] border border-[#262626] hover:border-[#ff4500] transition overflow-hidden">
              <div className="aspect-[4/3] overflow-hidden">
                <img src={p.cover} alt={p.title} className="w-full h-full object-cover media-img group-hover:scale-105 transition duration-700" />
              </div>
              <div className="p-6">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3] mb-3">{p.author} · {p.read_min} min read</div>
                <h3 className="font-display text-2xl mb-3 group-hover:text-[#ff4500] transition">{p.title}</h3>
                <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">{p.excerpt}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export function JournalDetail() {
  const { slug } = useParams();
  const [p, setP] = useState(null);
  useEffect(() => { fetchPost(slug).then(setP); }, [slug]);
  if (!p) return <div className="pt-40 text-center font-mono text-sm text-[#a3a3a3]">Loading…</div>;
  return (
    <article className="pt-32 pb-24 grain min-h-screen" data-testid="journal-detail">
      <div className="w-full max-w-[900px] mx-auto px-4 md:px-8">
        <Link to="/journal" className="industrial-link font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] mb-6 inline-block">← All entries</Link>
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3] mb-4">{p.author} · {p.read_min} min read</div>
        <h1 className="font-display text-5xl md:text-7xl mb-8 leading-[0.92]">{p.title}</h1>
        <div className="aspect-[16/9] mb-10 overflow-hidden border border-[#262626]">
          <img src={p.cover} alt={p.title} className="w-full h-full object-cover" />
        </div>
        <p className="font-mono text-base text-[#e5e5e5] leading-relaxed">{p.body}</p>
      </div>
    </article>
  );
}
