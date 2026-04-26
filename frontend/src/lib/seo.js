import { useEffect } from "react";

/**
 * Inject (and clean up) <script type="application/ld+json"> + meta tags into <head>.
 * Used on product/maker pages for structured data and OG previews.
 */
export function useStructuredData({ jsonLd, title, description, image, url }) {
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

    if (title) {
      const prevTitle = document.title;
      document.title = title;
      cleanups.push(() => { document.title = prevTitle; });
    }

    setMeta("description", description);
    setMeta("og:title", title, "property");
    setMeta("og:description", description, "property");
    setMeta("og:image", image, "property");
    setMeta("og:url", url, "property");
    setMeta("og:type", "website", "property");
    setMeta("twitter:card", "summary_large_image");

    return () => cleanups.forEach((fn) => fn());
  }, [JSON.stringify(jsonLd), title, description, image, url]);
}
