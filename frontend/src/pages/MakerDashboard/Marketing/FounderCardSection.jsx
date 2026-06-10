import React, { useEffect, useState } from "react";
import { Twitter, Download, Copy, Facebook, Linkedin } from "lucide-react";
import { toast } from "sonner";
import Section from "./Section";
import { fetchMakerMe } from "../../../lib/api";

/**
 * FounderCardSection
 * ------------------
 * Founder-only marketing tile. Shows the maker their generated social
 * card (via /api/founders/card/:slug) and provides one-click sharing
 * to X, Facebook, LinkedIn, plus a PNG/JPEG download.
 *
 * The card image is served by the backend and cached per
 * (slug, founder_number) in Mongo — first view triggers a Gemini
 * Nano Banana generation, subsequent views are instant.
 *
 * Returns `null` when the maker isn't a Founder so the section
 * silently disappears for everyone else.
 */
const API = process.env.REACT_APP_BACKEND_URL;

function buildShareText(maker, origin) {
  const num = String(maker.founder_number || 0).padStart(3, "0");
  const inaugural = maker.founder_status === "inaugural";
  const shop = maker.shop_name || maker.name || "my shop";
  const url = `${origin}/founders`;
  const tag = inaugural ? "Inaugural Founding Maker" : "Founding Maker";
  // 280-char safe — leaves headroom for the URL Twitter auto-shortens.
  const text =
    `Just joined @CraftersMarket as ${tag} #${num} ◆ ` +
    `${shop} — keeping more of every sale thanks to a 3% commission ` +
    `instead of Etsy's 6.5%+. ${url}`;
  return { text, url };
}

export default function FounderCardSection() {
  const [maker, setMaker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    fetchMakerMe()
      .then(setMaker)
      .catch(() => setMaker(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!maker || maker.tier !== "founder") return null;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const cardUrl = `${API}/api/founders/card/${maker.slug}`;
  const { text, url } = buildShareText(maker, origin);
  const num = String(maker.founder_number || 0).padStart(3, "0");

  const tweetHref =
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  const fbHref =
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` +
    `&quote=${encodeURIComponent(text)}`;
  const liHref =
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;

  const copyText = () => {
    navigator.clipboard?.writeText(text);
    toast.success("Share text copied — paste it anywhere.");
  };

  const downloadCard = async () => {
    try {
      const resp = await fetch(cardUrl, { cache: "no-store" });
      if (!resp.ok) throw new Error("card unavailable");
      const blob = await resp.blob();
      const ext = blob.type === "image/png" ? "png"
                : blob.type === "image/jpeg" ? "jpg"
                : "img";
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `founder-${num}-${maker.slug}.${ext}`;
      a.click();
      URL.revokeObjectURL(href);
      toast.success("Card downloaded — attach it to your post.");
    } catch {
      toast.error("Card not ready yet. Try again in a moment.");
    }
  };

  return (
    <Section title="Founder card · share your number" testId="founder-card-share">
      <p className="font-mono text-xs text-ink-muted mb-5 max-w-2xl leading-relaxed">
        You're <span className="text-brand">Founder #{num}</span>. Brag about it.
        One-click post to X, Facebook, or LinkedIn — or download the card and attach
        it to anything. Every share drives recruiting traffic back to <code className="text-brand">/founders</code>.
      </p>

      <div className="grid md:grid-cols-[280px_1fr] gap-6 items-start">
        {/* Card preview */}
        <div className="border border-line bg-paper p-3" data-testid="founder-card-preview">
          {imgError ? (
            <div className="aspect-square flex flex-col items-center justify-center text-center px-4">
              <div className="font-display text-3xl text-brand">#{num}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mt-2">
                Card generating — refresh in ~10s
              </div>
            </div>
          ) : (
            <img
              src={cardUrl}
              alt={`Founder #${num} card`}
              className="w-full aspect-square object-cover"
              onError={() => setImgError(true)}
              loading="lazy"
            />
          )}
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <a
            href={tweetHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between border border-brand text-brand hover:bg-brand hover:text-ink transition px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid="founder-card-tweet"
          >
            <span className="flex items-center gap-2">
              <Twitter size={14} /> Post to X / Twitter
            </span>
            <span className="text-[10px] opacity-70">opens composer</span>
          </a>

          <a
            href={fbHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between border border-line hover:border-brand hover:text-brand transition px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid="founder-card-facebook"
          >
            <span className="flex items-center gap-2">
              <Facebook size={14} /> Share on Facebook
            </span>
            <span className="text-[10px] opacity-70">opens dialog</span>
          </a>

          <a
            href={liHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between border border-line hover:border-brand hover:text-brand transition px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em]"
            data-testid="founder-card-linkedin"
          >
            <span className="flex items-center gap-2">
              <Linkedin size={14} /> Share on LinkedIn
            </span>
            <span className="text-[10px] opacity-70">opens dialog</span>
          </a>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={downloadCard}
              className="flex items-center justify-center gap-2 border border-line hover:border-brand hover:text-brand transition px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em]"
              data-testid="founder-card-download"
            >
              <Download size={14} /> Download card
            </button>
            <button
              onClick={copyText}
              className="flex items-center justify-center gap-2 border border-line hover:border-brand hover:text-brand transition px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em]"
              data-testid="founder-card-copy-text"
            >
              <Copy size={14} /> Copy text
            </button>
          </div>

          <p className="font-mono text-[10px] text-ink-muted leading-relaxed pt-2">
            ◇ Tip: X strips images from web-intent posts — hit "Download card" first,
            then paste it into the composer after it opens.
          </p>
        </div>
      </div>
    </Section>
  );
}
