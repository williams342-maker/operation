/**
 * iter413f — Social share buttons (Twitter/X, Facebook) + unified
 * SocialShareRow that bundles Pinterest + Twitter + Facebook.
 *
 * Follows the same lightweight pattern as PinterestShareButton — no
 * vendor SDKs, just centered window.open() against the public share
 * intent URLs. GA4 `share` event for channel-attribution reporting.
 */
import React from "react";
import PinterestShareButton from "./PinterestShareButton";

function track(method, url, source) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  try {
    window.gtag("event", "share", {
      method,
      content_type: source || "page",
      item_id: url,
    });
  } catch { /* gtag is best-effort */ }
}

function openCentered(href, name) {
  const w = 600, h = 540;
  const left = window.screen.availWidth / 2 - w / 2;
  const top = window.screen.availHeight / 2 - h / 2;
  window.open(
    href,
    name,
    `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,resizable=yes`,
  );
}

const BTN_BASE = "font-mono uppercase inline-flex items-center gap-1.5 border border-line hover:border-brand text-ink hover:text-brand transition-colors";
const SIZE_MAP = { sm: "text-[10px] tracking-[0.18em] px-2 py-1",
                   md: "text-xs tracking-[0.22em] px-3 py-1.5" };


export function TwitterShareButton({ url, text, size = "md", source, className = "", testId = "twitter-share-button" }) {
  if (!url) return null;
  // Use the legacy `twitter.com` intent URL — still routed correctly to
  // X.com after the rebrand, and works whether the user has the X app
  // or the web client open.
  const href =
    "https://twitter.com/intent/tweet" +
    `?url=${encodeURIComponent(url)}` +
    (text ? `&text=${encodeURIComponent(text)}` : "");
  const onClick = (e) => {
    e.preventDefault();
    track("Twitter", url, source);
    openCentered(href, "tweet-it");
  };
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      data-testid={testId}
      aria-label="Share this on X"
      className={`${BTN_BASE} ${SIZE_MAP[size]} ${className}`}
    >
      {/* X logo — single-color SVG so it picks up currentColor */}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      Tweet
    </a>
  );
}


export function FacebookShareButton({ url, size = "md", source, className = "", testId = "facebook-share-button" }) {
  if (!url) return null;
  const href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  const onClick = (e) => {
    e.preventDefault();
    track("Facebook", url, source);
    openCentered(href, "share-fb");
  };
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      data-testid={testId}
      aria-label="Share this on Facebook"
      className={`${BTN_BASE} ${SIZE_MAP[size]} ${className}`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M24 12.073c0-6.627-5.373-12-12-12S0 5.446 0 12.073c0 5.989 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
      Share
    </a>
  );
}


/**
 * Bundle of Pinterest + Twitter + Facebook share buttons. Use this
 * anywhere we want the full trio (PDP, SEO landing pages, checkout
 * success). Pinterest first — it's the conversion-driving channel
 * for handmade goods.
 */
export function SocialShareRow({
  url,
  media,
  description,
  twitterText,
  size = "md",
  source,
  className = "",
  testIdPrefix = "share",
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} data-testid={`${testIdPrefix}-row`}>
      <PinterestShareButton
        url={url}
        media={media}
        description={description}
        size={size}
        source={source}
        testId={`${testIdPrefix}-pinterest`}
      />
      <TwitterShareButton
        url={url}
        text={twitterText || description}
        size={size}
        source={source}
        testId={`${testIdPrefix}-twitter`}
      />
      <FacebookShareButton
        url={url}
        size={size}
        source={source}
        testId={`${testIdPrefix}-facebook`}
      />
    </div>
  );
}
