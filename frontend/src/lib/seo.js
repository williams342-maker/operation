import { useEffect } from "react";

/**
 * Inject (and clean up) `<head>` tags for SEO + social sharing.
 * Used on product/maker/shop/journal pages for:
 *   • title (document.title)
 *   • description meta
 *   • canonical link
 *   • Open Graph (Facebook / LinkedIn / Discord / iMessage)
 *   • Twitter card
 *   • JSON-LD structured data (Product / Organization / Article / etc.)
 *
 * Pages can pass `ogType` to override the default ("website"). Common values:
 *   "product"  → ProductDetail
 *   "profile"  → MakerDetail
 *   "article"  → JournalDetail
 */
export function useStructuredData({
  jsonLd,
  title,
  description,
  image,
  url,
  ogType = "website",
  twitterCard = "summary_large_image",
  imageAlt = "",
  siteName = "Crafters Market",
}) {
  useEffect(() => {
    const cleanups = [];

    if (jsonLd) {
      const s = document.createElement("script");
      s.type = "application/ld+json";
      s.text = JSON.stringify(jsonLd);
      s.dataset.cmStructured = "1";
      document.head.appendChild(s);
      cleanups.push(() => s.remove());
    }

    const setMeta = (name, content, key = "name") => {
      if (!content) return;
      const sel = `meta[${key}="${name}"][data-cm-structured]`;
      let el = document.head.querySelector(sel);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(key, name);
        el.dataset.cmStructured = "1";
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
      cleanups.push(() => el.remove());
    };

    const setLink = (rel, href) => {
      if (!href) return;
      const sel = `link[rel="${rel}"][data-cm-structured]`;
      let el = document.head.querySelector(sel);
      if (!el) {
        el = document.createElement("link");
        el.setAttribute("rel", rel);
        el.dataset.cmStructured = "1";
        document.head.appendChild(el);
      }
      el.setAttribute("href", href);
      cleanups.push(() => el.remove());
    };

    if (title) {
      const prevTitle = document.title;
      document.title = title;
      cleanups.push(() => { document.title = prevTitle; });
    }

    setMeta("description", description);
    // Open Graph
    setMeta("og:title", title, "property");
    setMeta("og:description", description, "property");
    setMeta("og:image", image, "property");
    setMeta("og:image:alt", imageAlt || title, "property");
    setMeta("og:url", url, "property");
    setMeta("og:type", ogType, "property");
    setMeta("og:site_name", siteName, "property");
    // Twitter — explicit duplicates so cards render correctly without OG fallback
    setMeta("twitter:card", twitterCard);
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    setMeta("twitter:image", image);
    setMeta("twitter:image:alt", imageAlt || title);
    // Canonical
    setLink("canonical", url);

    return () => cleanups.forEach((fn) => fn());
  }, [JSON.stringify(jsonLd), title, description, image, url, ogType, twitterCard, imageAlt, siteName]);
}
