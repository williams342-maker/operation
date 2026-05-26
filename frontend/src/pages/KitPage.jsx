/**
 * Maker Studio · Public Kit Page · /kits/:slug
 *
 * iter240 — Shareable kit landing page. Public, indexable, no auth required.
 * Pulls the kit via `/api/studio/kits/by-slug/{slug}` and renders a
 * cinematic gallery with rich OG meta so social shares unfurl beautifully.
 *
 * Anonymous visitors get a "Sign in to download" CTA per file. Authenticated
 * visitors can download or remix individual designs (Studio Phase 3 surface).
 */
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Download, Sparkles, Share2, Loader2 } from "lucide-react";
import { http } from "../lib/api";
import { useStructuredData } from "../lib/seo";
import { toast } from "sonner";

export default function KitPage() {
  const { slug } = useParams();
  const [kit, setKit] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setKit(null);
    setError(null);
    http.get(`/studio/kits/by-slug/${slug}`)
      .then((r) => setKit(r.data))
      .catch((e) => setError(e?.response?.status === 404 ? "not_found" : "error"));
  }, [slug]);

  useStructuredData({
    title: kit ? `${kit.title} — design kit by ${kit.owner_name || "Maker"} · Crafters Market` : "Design Kit · Crafters Market",
    description: kit ? `${kit.description || `A curated pack of ${kit.files?.length || 0} CNC-ready designs`} · Free SVG + DXF download.` : "Curated design pack — free SVG + DXF",
    url: `https://craftersmarket.org/kits/${slug}`,
    image: kit?.files?.[0]?.thumbnail_url || undefined,
  });

  if (error === "not_found") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] pt-32 pb-24 flex items-center">
        <div className="max-w-md mx-auto px-4 text-center" data-testid="kit-not-found">
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#525252] mb-3">◆ 404</div>
          <h1 className="font-display text-3xl mb-3">Kit not found</h1>
          <p className="font-mono text-sm text-[#a3a3a3] mb-6">
            This kit either doesn't exist or is unlisted.
          </p>
          <Link to="/studio" className="font-mono text-xs uppercase tracking-[0.22em] text-[#00ffff] hover:text-[#ff4500]">
            Browse the Studio →
          </Link>
        </div>
      </div>
    );
  }

  if (!kit) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-[#a3a3a3] pt-32 pb-24 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[#ff4500]" />
      </div>
    );
  }

  const shareUrl = `${window.location.origin}/kits/${slug}`;
  const bundleUrl = `${process.env.REACT_APP_BACKEND_URL}/api/studio/kits/by-slug/${slug}/bundle.zip`;
  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Kit URL copied — share away");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] pt-32 pb-24">
      <div className="max-w-6xl mx-auto px-4 md:px-8">
        {/* Header */}
        <div className="mb-12 max-w-3xl">
          <div className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.32em] text-[#00ffff] mb-3">
            ◆ Design Kit · {kit.files?.length || 0} files
          </div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[0.95] mb-4" data-testid="kit-title">
            {kit.title}
          </h1>
          {kit.description && (
            <p className="font-mono text-sm text-[#a3a3a3] leading-relaxed mb-6">
              {kit.description}
            </p>
          )}
          <div className="flex items-center gap-5 flex-wrap font-mono text-[10px] uppercase tracking-[0.22em]">
            <span className="text-[#525252]">
              Curated by <span className="text-[#e5e5e5]">{kit.owner_name}</span>
            </span>
            <button
              type="button"
              onClick={copyShare}
              className="inline-flex items-center gap-1.5 text-[#a3a3a3] hover:text-[#ff4500] transition"
              data-testid="kit-share-btn"
            >
              <Share2 size={11} /> Copy share URL
            </button>
            <Link
              to="/studio"
              className="inline-flex items-center gap-1.5 text-[#00ffff] hover:text-[#ff4500] transition"
              data-testid="kit-studio-cta"
            >
              <Sparkles size={11} /> Make your own
            </Link>
          </div>

          {kit.files && kit.files.length > 0 && (
            <div className="mt-6">
              <a
                href={bundleUrl}
                className="inline-flex items-center gap-2 px-5 py-3 bg-[#ff4500] text-[#0a0a0a] hover:bg-[#ff6a2a] font-mono text-[11px] uppercase tracking-[0.22em] font-bold transition"
                data-testid="kit-bundle-download"
                download
              >
                <Download size={14} /> Download bundle (ZIP · {kit.files.length} {kit.files.length === 1 ? "file" : "files"})
              </a>
              <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252] mt-2">
                ◆ SVG + DXF + README · ready for laser, plasma, router
              </div>
            </div>
          )}
        </div>

        {/* Files grid */}
        {kit.files && kit.files.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="kit-files-grid">
            {kit.files.map((f, i) => (
              <KitFileCard key={f.id} file={f} index={i} />
            ))}
          </div>
        ) : (
          <div className="border border-[#262626] bg-[#0a0a0a] p-12 text-center font-mono text-sm text-[#525252]">
            This kit is empty — its creator hasn't added designs yet.
          </div>
        )}
      </div>
    </div>
  );
}

function KitFileCard({ file, index }) {
  const isAI = file.source === "maker_studio_ai" || file.ai_generated;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className="border border-[#262626] hover:border-[#ff4500] transition group bg-[#0a0a0a]"
      data-testid={`kit-file-${file.id}`}
    >
      <div className="aspect-[2/1] bg-white overflow-hidden flex items-center justify-center [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:h-auto">
        {file.thumbnail_url ? (
          file.thumbnail_url.startsWith("data:image/svg") ? (
            <div
              className="w-full h-full p-3 flex items-center justify-center"
              dangerouslySetInnerHTML={{ __html: atob(file.thumbnail_url.split(",")[1] || "") }}
            />
          ) : (
            <img src={file.thumbnail_url} alt={file.title}
                 className="w-full h-full object-contain p-3"
                 loading="lazy" />
          )
        ) : null}
      </div>
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          {isAI && (
            <span className="font-mono text-[8px] uppercase tracking-[0.22em] bg-[#00ffff] text-[#0a0a0a] px-1.5 py-0.5 font-bold">
              ◆ AI
            </span>
          )}
          <div className="font-mono text-[11px] text-[#e5e5e5] line-clamp-1 flex-1">
            {file.title}
          </div>
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#525252]">
          by {file.maker_name || file.maker_slug || "Studio Member"}
        </div>
        <div className="flex items-center gap-2 pt-1">
          {isAI && (
            <Link
              to={`/studio?remix=${file.id}`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#00ffff]/60 text-[#00ffff] hover:bg-[#00ffff]/10 font-mono text-[9px] uppercase tracking-[0.22em]"
              data-testid={`kit-remix-${file.id}`}
            >
              <Sparkles size={11} /> Remix
            </Link>
          )}
          <Link
            to={`/community?tab=files&open=${file.id}`}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#262626] hover:border-[#ff4500] font-mono text-[9px] uppercase tracking-[0.22em] text-[#a3a3a3] hover:text-[#fff]"
            data-testid={`kit-open-${file.id}`}
          >
            <Download size={11} /> Open
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
