import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/**
 * Catch-all 404 page (iter372).
 *
 * The SPA can't return a real HTTP 404 status, so unknown routes used to
 * render a blank 200 page — which Google flags as a soft-404. We inject
 * `<meta name="robots" content="noindex">` (Google renders JS, sees it,
 * and drops the URL from the index) and give humans clear ways back.
 */
export default function NotFoundPage() {
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex";
    document.head.appendChild(m);
    return () => m.remove();
  }, []);

  return (
    <div className="pt-40 pb-32 min-h-screen text-center grain" data-testid="not-found-page">
      <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-4">◆ 404 · Page</div>
      <h1 className="font-heading uppercase text-4xl sm:text-5xl text-ink mb-4">This page isn&apos;t here.</h1>
      <p className="font-body text-ink-muted mb-8 max-w-md mx-auto">
        The link may be old, mistyped, or the page has moved. The marketplace is one click away.
      </p>
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <Link
          to="/shop"
          className="inline-flex items-center gap-2 px-6 py-3 bg-brand hover:bg-brand-hover text-white font-mono text-xs uppercase tracking-[0.22em]"
          data-testid="not-found-shop-link"
        >
          <ArrowLeft size={14} /> Browse the marketplace
        </Link>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-6 py-3 border border-line hover:border-brand hover:text-brand font-mono text-xs uppercase tracking-[0.22em]"
          data-testid="not-found-home-link"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
