/**
 * ShareLinkButton — drop-in pill next to "Add to cart" / "Save drop" that
 * copies a *share-friendly* URL (`/api/og/<kind>/<slug>`) to the clipboard.
 *
 * Why not just copy `window.location.href`?
 * The public canonical URL (e.g. `/shop/<slug>`) is an SPA route. Social
 * unfurlers that bypass our Cloudflare Worker (Slack mobile, iMessage,
 * many Discord servers) see the SPA shell HTML and unfurl with the
 * generic homepage og:image. The OG endpoint returns full server-rendered
 * prerender HTML (real og:title + og:image + JSON-LD) AND meta-refreshes
 * humans to the canonical SPA page in 0s — so it's transparent to the
 * person clicking.
 *
 * Used on:
 *   • Maker dashboard product cards (small "⎘ Share link" pill — see
 *     ProductEditCard.jsx)
 *   • Public product detail page (visible to ALL visitors, including
 *     non-logged-in buyers — converts Pinterest / Discord / DM shares
 *     into rich unfurls without any extra step)
 *
 * Lives at `/components/ShareLinkButton.jsx` so the maker-side card and
 * the buyer-side page share one source of truth for the copy-to-clipboard
 * behaviour and the URL shape.
 */
import React from "react";
import { toast } from "sonner";
import { Link2 } from "lucide-react";

export default function ShareLinkButton({ kind = "product", slug, label = "Share", testId }) {
  const onClick = async () => {
    const origin = window.location.origin;
    // /api/og/product/<slug>, /api/og/maker/<slug>, /api/og/journal/<slug>
    const url = `${origin}/api/og/${kind}/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied — paste anywhere for a rich preview.");
    } catch {
      // Older browsers / locked-down devices fall back to a system prompt
      // so the maker can still grab the URL manually.
      window.prompt("Copy this share-friendly URL:", url);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title="Copy a share-friendly link. When you paste it in Slack / iMessage / Facebook / Discord, it unfurls with a rich card."
      className="px-4 py-3 border border-[#262626] hover:border-[#ff4500] text-[#a3a3a3] hover:text-[#ff4500] transition-colors flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em]"
      data-testid={testId || `share-link-${kind}-${slug}`}
    >
      <Link2 size={14} />
      <span>{label}</span>
    </button>
  );
}
