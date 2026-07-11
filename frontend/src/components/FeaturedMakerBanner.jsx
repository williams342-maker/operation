/**
 * iter455 — Maker dashboard congratulations banner + promotion kit.
 * Renders only while the signed-in maker is the live Featured Maker.
 */
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trophy, Download, Copy } from "lucide-react";
import { http, authHeaders } from "../lib/api";

export default function FeaturedMakerBanner() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    http.get("/maker/featured/status", { headers: authHeaders() })
      .then((r) => setSt(r.data)).catch(() => {});
  }, []);

  if (!st?.featured) return null;
  const kit = st.kit || {};
  const caps = kit.captions || {};
  const copyKit = () => {
    const txt = [caps.captions?.instagram, (caps.hashtags || []).join(" "),
      `https://craftersmarket.org`].filter(Boolean).join("\n\n");
    navigator.clipboard?.writeText(txt);
    toast.success("Caption + hashtags copied — share away!");
  };

  return (
    <div className="border border-brand/50 bg-brand/[0.06] p-5 mb-8" data-testid="featured-maker-banner">
      <div className="flex items-center gap-2 mb-2">
        <Trophy size={18} className="text-brand" />
        <h3 className="font-display text-xl text-ink">
          Congratulations — you're this week's Featured Maker!
        </h3>
      </div>
      <p className="font-mono text-[11px] text-ink-muted mb-3">
        Your store is being promoted across Crafters Market through {st.ends_at?.slice(0, 10)}.
        Share your promotion kit with your own audience to amplify it.
      </p>
      <div className="flex flex-wrap gap-4 font-mono text-[10px] text-ink mb-4" data-testid="featured-live-stats">
        <span>Views today: <b className="text-brand">{st.stats?.store_views_today ?? 0}</b></span>
        <span>Views while featured: <b className="text-brand">{st.stats?.store_views_total ?? 0}</b></span>
        <span>Product views: <b className="text-brand">{st.stats?.product_views ?? 0}</b></span>
        <span>Cart adds: <b className="text-brand">{st.stats?.add_to_cart ?? 0}</b></span>
      </div>
      <div className="flex flex-wrap gap-2">
        {kit.assets?.square_url && (
          <a href={kit.assets.square_url} download target="_blank" rel="noreferrer"
             className="border border-brand text-brand hover:bg-brand hover:text-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition inline-flex items-center gap-1.5"
             data-testid="featured-kit-square">
            <Download size={11} /> Square image
          </a>
        )}
        {kit.assets?.landscape_url && (
          <a href={kit.assets.landscape_url} download target="_blank" rel="noreferrer"
             className="border border-brand text-brand hover:bg-brand hover:text-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition inline-flex items-center gap-1.5"
             data-testid="featured-kit-landscape">
            <Download size={11} /> Landscape image
          </a>
        )}
        <button onClick={copyKit}
                className="border border-line text-ink hover:text-brand px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition inline-flex items-center gap-1.5"
                data-testid="featured-kit-copy">
          <Copy size={11} /> Copy caption + hashtags
        </button>
      </div>
    </div>
  );
}
