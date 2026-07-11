/**
 * iter457 — The Workshop Floor Overview: default landing tab of the
 * community hub. Dynamic modules (trending discussions, featured projects,
 * latest videos/journal, popular files, trending tags, stats) + Featured
 * Maker module + "coming soon" roadmap strip. New modules slot into the
 * grid without structural changes.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, Trophy, Film, BookOpen, FolderOpen, Tag, Users } from "lucide-react";
import { http } from "../../lib/api";
import { getFeaturedMaker, daysRemaining } from "../../lib/featuredMaker";

const Eyebrow = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-brand mb-3">
    <Icon size={12} /> {children}
  </div>
);

export default function WorkshopFloorOverview({ onOpenForum, onOpenThread, onSwitchTab }) {
  const [data, setData] = useState(null);
  const [featured, setFeatured] = useState(null);
  useEffect(() => {
    http.get("/community/overview").then((r) => setData(r.data)).catch(() => setData({}));
    getFeaturedMaker().then(setFeatured);
  }, []);

  if (!data) {
    return <p className="font-mono text-xs text-ink-muted" data-testid="overview-loading">Loading the floor…</p>;
  }
  const s = data.stats || {};

  return (
    <div className="space-y-10" data-testid="workshop-floor-overview">
      {/* Featured Maker module */}
      {featured?.maker && (
        <Link to={`/makers/${featured.maker.slug}`}
              className="block border border-brand/40 bg-brand/[0.05] p-4 hover:border-brand transition"
              data-testid="overview-featured-maker">
          <div className="flex flex-wrap items-center gap-3">
            <Trophy size={16} className="text-brand" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-brand">
              This week&apos;s Featured Maker
            </span>
            <span className="font-display text-xl text-ink">{featured.maker.name}</span>
            <span className="ml-auto font-mono text-[10px] text-ink-muted">
              {daysRemaining(featured.ends_at)} days left · Visit the store →
            </span>
          </div>
        </Link>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-line border border-line" data-testid="overview-stats">
        {[["Members", s.members], ["Discussions", s.threads], ["Replies", s.replies],
          ["Projects", s.projects], ["Design files", s.design_files]].map(([label, val]) => (
          <div key={label} className="bg-paper px-4 py-3">
            <div className="font-display text-2xl text-ink">{(val ?? 0).toLocaleString()}</div>
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-muted">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-10">
        {/* Trending discussions */}
        <div data-testid="overview-trending-discussions">
          <Eyebrow icon={MessageSquare}>Trending discussions</Eyebrow>
          {(data.trending_discussions || []).length === 0 ? (
            <p className="font-mono text-xs text-ink-muted">No discussions yet — start one.</p>
          ) : (
            <ul className="divide-y divide-line border border-line">
              {data.trending_discussions.map((t) => (
                <li key={t.id}>
                  <button onClick={() => onOpenThread(t.id)}
                          className="w-full text-left px-4 py-3 hover:bg-surface transition"
                          data-testid={`overview-thread-${t.id}`}>
                    <div className="font-display text-base text-ink line-clamp-1">{t.title}</div>
                    <div className="font-mono text-[10px] text-ink-muted mt-0.5">
                      {t.reply_count} replies · {t.category}{(t.tags || []).length > 0 && ` · #${t.tags[0]}`}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => onOpenForum({})} className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-brand hover:underline" data-testid="overview-all-discussions">
            View all discussions →
          </button>
        </div>

        {/* Featured projects */}
        <div data-testid="overview-featured-projects">
          <Eyebrow icon={Trophy}>Featured projects</Eyebrow>
          <div className="grid grid-cols-2 gap-2">
            {(data.featured_projects || []).map((p) => (
              <button key={p.id} onClick={() => onSwitchTab("showcase")}
                      className="border border-line hover:border-brand transition text-left"
                      data-testid={`overview-project-${p.id}`}>
                {p.image_url
                  ? <img src={p.image_url} alt={p.title} className="w-full h-28 object-cover" loading="lazy" />
                  : <div className="w-full h-28 bg-surface" />}
                <div className="p-2">
                  <div className="font-mono text-[11px] text-ink line-clamp-1">{p.title}</div>
                  <div className="font-mono text-[9px] text-ink-muted">{p.user_name} · ♥ {p.likes || 0}</div>
                </div>
              </button>
            ))}
          </div>
          <button onClick={() => onSwitchTab("showcase")} className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-brand hover:underline" data-testid="overview-all-projects">
            View showcase →
          </button>
        </div>

        {/* Latest workshop videos */}
        <div data-testid="overview-latest-videos">
          <Eyebrow icon={Film}>Latest workshop videos</Eyebrow>
          <div className="grid grid-cols-2 gap-2">
            {(data.latest_videos || []).map((v) => (
              <Link key={v.id} to="/clips" className="border border-line hover:border-brand transition"
                    data-testid={`overview-video-${v.id}`}>
                {v.poster_url
                  ? <img src={v.poster_url} alt={v.title} className="w-full h-24 object-cover" loading="lazy" />
                  : <div className="w-full h-24 bg-surface" />}
                <div className="p-2 font-mono text-[11px] text-ink line-clamp-1">{v.title}</div>
              </Link>
            ))}
            {(data.latest_videos || []).length === 0 && (
              <p className="font-mono text-xs text-ink-muted col-span-2">Videos land here soon.</p>
            )}
          </div>
          <Link to="/clips" className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand hover:underline">
            All workshop videos →
          </Link>
        </div>

        {/* Journal + popular files */}
        <div className="space-y-8">
          <div data-testid="overview-latest-journal">
            <Eyebrow icon={BookOpen}>New from the Maker Journal</Eyebrow>
            <ul className="space-y-2">
              {(data.latest_journal || []).map((j) => (
                <li key={j.id}>
                  <Link to={`/journal/${j.slug}`} className="block border border-line hover:border-brand px-4 py-2.5 transition">
                    <div className="font-display text-base text-ink line-clamp-1">{j.title}</div>
                    <div className="font-mono text-[9px] text-ink-muted">{j.author} · {j.read_min} min read</div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div data-testid="overview-popular-files">
            <Eyebrow icon={FolderOpen}>Popular design files</Eyebrow>
            <ul className="divide-y divide-line border border-line">
              {(data.popular_files || []).map((f) => (
                <li key={f.id}>
                  <button onClick={() => onSwitchTab("files")}
                          className="w-full text-left px-4 py-2 hover:bg-surface transition flex items-center gap-3">
                    <span className="font-mono text-[9px] uppercase text-brand border border-brand/40 px-1.5 py-0.5">{f.file_type}</span>
                    <span className="font-mono text-[11px] text-ink line-clamp-1 flex-1">{f.title}</span>
                    <span className="font-mono text-[9px] text-ink-muted">{f.downloads || 0} ⬇</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Trending tags */}
      {(data.trending_tags || []).length > 0 && (
        <div data-testid="overview-trending-tags">
          <Eyebrow icon={Tag}>Trending tags</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {data.trending_tags.map((t) => (
              <button key={t.tag} onClick={() => onOpenForum({ tag: t.tag })}
                      className="border border-line hover:border-brand text-ink-muted hover:text-brand px-3 py-1 font-mono text-[10px] tracking-[0.12em] transition"
                      data-testid={`overview-tag-${t.tag}`}>
                #{t.tag} <span className="text-ink-muted/60">{t.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Roadmap strip — vision without dead-end nav links */}
      <div className="border border-dashed border-line p-5" data-testid="overview-coming-soon">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-ink-muted mb-3">
          <Users size={12} /> Coming to The Workshop Floor
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-ink-muted">
          {(data.coming_soon || []).map((c) => <span key={c.label}>◇ {c.label}</span>)}
        </div>
      </div>
    </div>
  );
}
