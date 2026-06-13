/**
 * iter413e — Pinterest "Save to Pinterest" share button.
 *
 * Pinterest is the #1 discovery channel for handmade goods (jewelry,
 * pottery, leather, woodworking). The iter411d Article Rich Pins
 * unlock works ONLY when users actually pin our pages — this button
 * makes that one click.
 *
 * Pinterest pin-create URL spec:
 *   https://pinterest.com/pin/create/button/
 *     ?url=        page URL (where the pin links back to)
 *     &media=      image URL (what shows on Pinterest)
 *     &description=copy for the pin caption
 *
 * Renders as a small pill in brand language. Opens the share dialog
 * in a centered popup (matches Pinterest's own button widget behavior
 * without requiring their JS SDK).
 */
import React from "react";

export default function PinterestShareButton({
  url,
  media,
  description,
  size = "md",      // "sm" | "md"
  className = "",
  source,           // optional analytics label — e.g. "pdp" / "seo-landing"
  testId = "pinterest-share-button",
}) {
  if (!url || !media) return null;
  const pinUrl =
    "https://pinterest.com/pin/create/button/" +
    `?url=${encodeURIComponent(url)}` +
    `&media=${encodeURIComponent(media)}` +
    (description ? `&description=${encodeURIComponent(description)}` : "");

  const onClick = (e) => {
    e.preventDefault();
    // GA4 event for share-channel reporting (matches existing pattern
    // used by variantPricing.js + consent.js).
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      try {
        window.gtag("event", "share", {
          method: "Pinterest",
          content_type: source || "page",
          item_id: url,
        });
      } catch { /* gtag is best-effort */ }
    }
    // Centered popup, matches Pinterest's official widget.
    const w = 750, h = 580;
    const left = window.screen.availWidth / 2 - w / 2;
    const top = window.screen.availHeight / 2 - h / 2;
    window.open(
      pinUrl,
      "pin-it",
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,resizable=yes`,
    );
  };

  const sz = size === "sm"
    ? "text-[10px] tracking-[0.18em] px-2 py-1"
    : "text-xs tracking-[0.22em] px-3 py-1.5";

  return (
    <a
      href={pinUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      data-testid={testId}
      aria-label="Save this to Pinterest"
      className={`font-mono uppercase ${sz} inline-flex items-center gap-1.5 border border-line hover:border-brand text-ink hover:text-brand transition-colors ${className}`}
    >
      {/* Pinterest "P" mark — single-color SVG so it picks up currentColor */}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.4 0 0 5.4 0 12c0 5.1 3.1 9.4 7.6 11.2-.1-.9-.2-2.4 0-3.5l1.5-6.4s-.4-.8-.4-1.9c0-1.8 1-3.1 2.3-3.1 1.1 0 1.6.8 1.6 1.8 0 1.1-.7 2.7-1 4.2-.3 1.3.6 2.3 1.9 2.3 2.3 0 4-2.4 4-5.9 0-3.1-2.2-5.3-5.4-5.3-3.7 0-5.8 2.7-5.8 5.6 0 1.1.4 2.3.9 2.9.1.1.1.2.1.3l-.4 1.4c-.1.2-.2.3-.4.2-1.4-.7-2.3-2.7-2.3-4.4 0-3.6 2.6-6.9 7.5-6.9 3.9 0 7 2.8 7 6.5 0 3.9-2.5 7.1-5.9 7.1-1.2 0-2.3-.6-2.6-1.3l-.7 2.7c-.3 1-.9 2.3-1.4 3.1 1.1.3 2.2.5 3.4.5 6.6 0 12-5.4 12-12S18.6 0 12 0z" />
      </svg>
      Pin it
    </a>
  );
}
