import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchTrendingForumThreads } from "../lib/api";

// "Trending in the forum" homepage strip.
// Funnels new shoppers toward open conversations so the seeded
// starter threads start collecting real replies. Self-hides when the
// API returns 0 threads so we never render a hollow header on a
// brand-new install before seeds are loaded.

const CATEGORY_LABEL = {
  general: "General",
  "machine-help": "Machine Help",
  techniques: "Techniques",
  finishing: "Finishing",
  resources: "Resources",
  "show-tell": "Show & Tell",
};

export default function TrendingForumStrip({
  days = 30,
  limit = 3,
  testId = "trending-forum-strip",
}) {
  const [threads, setThreads] = useState(null); // null = loading

  useEffect(() => {
    fetchTrendingForumThreads(days, limit)
      .then((d) => setThreads(d?.threads || []))
      .catch(() => setThreads([]));
  }, [days, limit]);

  if (threads === null || threads.length === 0) return null;

  return (
    <section
      className="border-t border-[#262626] bg-[#0a0a0a] py-16 sm:py-20"
      data-testid={testId}
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-end justify-between mb-10 flex-wrap gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500]">
              ◆ From the forum
            </div>
            <h2 className="font-display text-3xl sm:text-5xl text-[#e5e5e5] mt-3 leading-[0.9]">
              Open questions worth your two cents.
            </h2>
          </div>
          <Link
            to="/community?tab=forum"
            data-testid="trending-forum-view-all"
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#ff4500] transition"
          >
            All threads →
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {threads.map((t) => (
            <Link
              key={t.id}
              to={`/community?tab=forum&thread=${t.id}`}
              data-testid={`trending-forum-thread-${t.id}`}
              className="group border border-[#262626] hover:border-[#ff4500] p-5 transition flex flex-col"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-3">
                ◆ {CATEGORY_LABEL[t.category] || t.category}
              </div>
              <div className="font-display text-lg text-[#e5e5e5] leading-tight mb-4 line-clamp-3 group-hover:text-[#ff4500] transition">
                {t.title}
              </div>
              <div className="mt-auto flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-[#525252]">
                <span>{t.user_name || "Anon"}</span>
                <span>
                  {t.reply_count > 0
                    ? `${t.reply_count} ${t.reply_count === 1 ? "reply" : "replies"}`
                    : "Be the first to reply"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
