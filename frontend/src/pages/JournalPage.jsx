import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchPosts, fetchPost, recordPostView } from "../lib/api";
import { useStructuredData } from "../lib/seo";
import JournalBody from "../components/JournalBody";
import ShareLinkButton from "../components/ShareLinkButton";

export function JournalPage() {
  const [posts, setPosts] = useState([]);
  useEffect(() => { fetchPosts().then(setPosts); }, []);

  useStructuredData({
    title: "Journal · Workshop Notes & CNC Stories · Crafters Market",
    description: "Behind-the-scenes notes from independent makers — process, technique, and the craft of building one-off CNC art and custom signs.",
    url: "https://craftersmarket.org/journal",
    image: "https://craftersmarket.org/downloads/cnc-garage-builders.png",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Blog",
      name: "Crafters Market Journal",
      url: "https://craftersmarket.org/journal",
      publisher: { "@id": "https://craftersmarket.org/#org" },
    },
  });

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
  useEffect(() => {
    fetchPost(slug).then(setP);
    // Best-effort view increment — capped to once per browser session
    // per slug so reloads don't inflate the trending count. Silently
    // no-ops if the API call fails.
    const k = `cm_blog_view:${slug}`;
    if (!sessionStorage.getItem(k)) {
      sessionStorage.setItem(k, "1");
      recordPostView(slug);
    }
  }, [slug]);

  useStructuredData({
    title: p ? `${p.title} · Crafters Market Journal` : undefined,
    description: p?.excerpt || p?.body?.slice(0, 160),
    image: p?.cover,
    url: p ? `https://craftersmarket.org/journal/${p.slug}` : undefined,
    jsonLd: p ? {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: p.title,
      image: p.cover,
      datePublished: p.created_at,
      author: { "@type": "Person", name: p.author || "Crafters Market" },
      publisher: { "@id": "https://craftersmarket.org/#org" },
      mainEntityOfPage: `https://craftersmarket.org/journal/${p.slug}`,
      articleBody: p.body,
    } : undefined,
  });

  if (!p) return <div className="pt-40 text-center font-mono text-sm text-[#a3a3a3]">Loading…</div>;
  return (
    <article className="pt-32 pb-24 grain min-h-screen" data-testid="journal-detail">
      <div className="w-full max-w-[900px] mx-auto px-4 md:px-8">
        <Link to="/journal" className="industrial-link font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] mb-6 inline-block">← All entries</Link>
        <div className="flex justify-between items-start gap-4 flex-wrap mb-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#a3a3a3]">{p.author} · {p.read_min} min read</div>
          <ShareLinkButton kind="journal" slug={p.slug} testId="journal-share-link" />
        </div>
        <h1 className="font-display text-5xl md:text-7xl mb-8 leading-[0.92]">{p.title}</h1>
        <div className="aspect-[16/9] mb-10 overflow-hidden border border-[#262626]">
          <img src={p.cover} alt={p.title} className="w-full h-full object-cover" />
        </div>
        <JournalBody body={p.body} />
      </div>
    </article>
  );
}
