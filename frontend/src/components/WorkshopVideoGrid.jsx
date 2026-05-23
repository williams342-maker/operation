/**
 * Public-facing workshop video grid (iter186) — renders on MakerDetail.
 *
 * Hides itself when the maker hasn't added any videos. Each card is a
 * lazy-loaded thumbnail; click swaps it for the actual iframe embed so
 * we don't ship 6 iframes on initial page load (each iframe pulls
 * YouTube's player JS = noticeable LCP regression). Lazy-embed pattern
 * is what YouTube itself recommends for marketplace embeds.
 */
import React, { useState } from "react";
import { Play, Video as VideoIcon } from "lucide-react";

export default function WorkshopVideoGrid({ videos = [] }) {
  if (!videos || videos.length === 0) return null;

  return (
    <section
      className="mb-16"
      data-testid="maker-detail-workshop-videos"
      aria-labelledby="maker-workshop-videos-heading"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-6">
        <h2
          id="maker-workshop-videos-heading"
          className="font-display text-3xl md:text-5xl text-[#e5e5e5]"
        >
          From the workshop floor
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">
          {videos.length} video{videos.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
        {videos.map((v) => (
          <VideoCard key={v.id || v.video_id} video={v} />
        ))}
      </div>
    </section>
  );
}


function VideoCard({ video }) {
  const [playing, setPlaying] = useState(false);
  const provider = video.provider || "youtube";
  const thumb =
    video.thumbnail ||
    (provider === "youtube" && video.video_id
      ? `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`
      : null);

  // Build embed URL with autoplay on click so the video starts immediately
  // after the user opts in (one click, not two).
  const embedSrc = (() => {
    const base = video.embed_url ||
      (provider === "youtube"
        ? `https://www.youtube.com/embed/${video.video_id}`
        : `https://player.vimeo.com/video/${video.video_id}`);
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}autoplay=1&rel=0`;
  })();

  return (
    <article
      className="border border-[#262626] hover:border-[#ff4500]/50 transition group"
      data-testid={`workshop-video-card-${video.id || video.video_id}`}
    >
      <div className="aspect-video bg-[#0a0a0a] relative">
        {playing ? (
          <iframe
            src={embedSrc}
            title={video.title || "Workshop video"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="w-full h-full"
            loading="lazy"
            data-testid={`workshop-video-iframe-${video.id || video.video_id}`}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="w-full h-full relative group/btn"
            aria-label={`Play ${video.title || "video"}`}
            data-testid={`workshop-video-play-${video.id || video.video_id}`}
          >
            {thumb ? (
              <img
                src={thumb}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover group-hover/btn:scale-[1.02] transition duration-500"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#525252]">
                <VideoIcon size={40} />
              </div>
            )}
            <div className="absolute inset-0 bg-black/30 group-hover/btn:bg-black/20 transition flex items-center justify-center">
              <div className="w-16 h-16 bg-[#ff4500] flex items-center justify-center group-hover/btn:scale-110 transition shadow-2xl shadow-[#ff4500]/40">
                <Play size={28} className="text-white ml-1" fill="currentColor" />
              </div>
            </div>
          </button>
        )}
      </div>
      {video.title && (
        <div className="p-3 md:p-4">
          <p className="font-mono text-xs md:text-sm text-[#e5e5e5] leading-snug line-clamp-2">
            {video.title}
          </p>
          <p className="font-mono text-[10px] text-[#525252] mt-1.5 uppercase tracking-[0.22em]">
            via {provider}
          </p>
        </div>
      )}
    </article>
  );
}
