import React, { useEffect, useState } from "react";
import { Copy, ExternalLink, Facebook, Image as PinterestIcon, Globe, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fetchFeedsHealth } from "../../../lib/api";

/**
 * Settings → Off-site channels panel.
 *
 * Replaces the legacy "Facebook Shops" placeholder. Surfaces the three
 * product-feed URLs (Meta, Pinterest, Google Merchant) plus a live row
 * count of how many of THIS shop's published, in-stock listings will
 * appear in the next sync. Each row has a one-click copy + a
 * deep-link to the relevant Commerce Manager.
 *
 * Why CSV feeds instead of a live API connection?
 *   - Meta deprecated US Shops checkout in April 2024. Catalog feeds
 *     still power tagged products + dynamic ads, and they're the only
 *     thing actually working for US merchants in 2026.
 *   - Pinterest + Google Merchant accept the exact same schema, so
 *     three channels = one feed engine + three URL aliases. Keeps the
 *     code surface tiny.
 */
export default function ChannelsPanel({ maker }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchFeedsHealth().then(setData).catch(() => setData({ error: true }));
  }, []);

  const reload = () =>
    fetchFeedsHealth().then(setData).catch(() => setData({ error: true }));

  if (!data) {
    return <p className="font-mono text-xs text-ink-muted py-6">Loading channel health…</p>;
  }
  if (data.error) {
    return <p className="font-mono text-xs text-red-400 py-6">Could not load channel health.</p>;
  }

  return (
    <div className="space-y-6" data-testid="settings-channels">
      {/* Hero / explainer */}
      <div className="border border-line bg-paper p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 border border-brand bg-brand/10 flex items-center justify-center shrink-0">
            <Globe size={18} className="text-brand" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-2xl md:text-3xl mb-1">Off-site product channels</h2>
            <p className="font-mono text-xs text-ink-muted leading-relaxed max-w-2xl">
              Sync your full marketplace catalog to Facebook, Instagram, Pinterest,
              and Google Merchant Center. Paste the feed URL once into each platform's
              catalog manager — we regenerate the file on every fetch with your latest
              published, in-stock listings.
              <span className="block mt-2 text-ink-muted">
                ⚠️ Meta discontinued US Shops checkout in April 2024. Buyers click through
                to your Crafters Market storefront to finish the sale, but the catalog
                still powers tagged Reels, Story stickers, and dynamic ads.
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Live row count */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="border border-line bg-paper p-5" data-testid="channels-rowcount">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
            Listings in next sync
          </div>
          <div className="font-display text-3xl md:text-4xl text-brand leading-none">
            {data.row_count}
          </div>
          <div className="font-mono text-[10px] text-ink-muted mt-2">
            published · in-stock · marketplace-wide
          </div>
        </div>
        <div className="border border-line bg-paper p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-2">
            Feed regeneration
          </div>
          <div className="font-display text-2xl text-emerald-700 leading-none">Live</div>
          <div className="font-mono text-[10px] text-ink-muted mt-2">
            fetched on demand · 1-hour CDN cache
          </div>
          <button
            onClick={reload}
            className="mt-3 px-2.5 py-1 border border-line hover:border-brand hover:text-brand font-mono text-[10px] uppercase tracking-[0.22em] transition inline-flex items-center gap-1.5"
            data-testid="channels-refresh"
          >
            <RefreshCw size={11} /> Refresh stats
          </button>
        </div>
      </div>

      {/* Per-channel rows */}
      <div className="space-y-3">
        {data.feeds.map((f) => (
          <FeedRow key={f.channel} feed={f} />
        ))}
      </div>

      {/* Footer note */}
      <div className="border border-dashed border-line p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-brand mb-2">
          ◆ Feed format
        </div>
        <p className="font-mono text-xs text-ink-muted leading-relaxed">
          Each feed uses Google Merchant Center column names — same schema accepted
          by Meta Commerce and Pinterest Catalogs, so one upload powers all three.
          Custom labels (`custom_label_0` = technique, `custom_label_1` = maker slug)
          let you build campaign segments by plasma vs. laser, or by individual shop.
          {maker?.slug ? <> Filter to your shop in any platform with <code className="font-mono text-brand">custom_label_1 = {maker.slug}</code>.</> : null}
        </p>
      </div>
    </div>
  );
}

function FeedRow({ feed }) {
  const Icon = ICON_MAP[feed.channel] || Globe;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feed.url);
      toast.success(`${feed.label} feed URL copied`);
    } catch {
      toast.error("Couldn't copy — try long-pressing the URL.");
    }
  };
  return (
    <div
      className="border border-line bg-paper p-4 hover:border-brand/60 transition-colors"
      data-testid={`channel-row-${feed.channel}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 border border-line flex items-center justify-center shrink-0">
          <Icon size={16} className="text-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="font-display text-lg">{feed.label}</h3>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <code
              className="flex-1 font-mono text-[10px] text-ink-muted bg-paper px-2 py-1.5 border border-line truncate"
              data-testid={`channel-url-${feed.channel}`}
            >
              {feed.url}
            </code>
            <button
              onClick={copy}
              className="px-2.5 py-1.5 border border-line hover:border-brand hover:text-brand inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] transition shrink-0"
              data-testid={`channel-copy-${feed.channel}`}
              title="Copy feed URL"
            >
              <Copy size={11} /> Copy
            </button>
            <a
              href={feed.manager_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 border border-line hover:border-brand hover:text-brand inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] transition shrink-0"
              data-testid={`channel-manager-${feed.channel}`}
              title="Open the platform's Catalog/Commerce Manager"
            >
              Open <ExternalLink size={11} />
            </a>
          </div>
          <p className="font-mono text-[11px] text-ink-muted mt-2 leading-relaxed">{feed.instructions}</p>
        </div>
      </div>
    </div>
  );
}

const ICON_MAP = {
  meta: Facebook,
  pinterest: PinterestIcon,
  google: Globe,
};
