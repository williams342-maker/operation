/**
 * SitePromo — renders the active admin-managed promo banner for a placement.
 *
 * Usage:
 *   <SitePromo placement="home_hero" />
 *   <SitePromo placement="shop_top" />
 *
 * Behaviour:
 *   - On mount, fetches /api/site-promos?placement=X. If null, renders nothing.
 *   - Honors the promo's `dismissible` flag — when true, shows a × close button
 *     and remembers the dismissal in localStorage per promo id.
 *   - Internal CTA links use <Link>; external (starts with http) use <a target=_blank>.
 *
 * iter346 — Phase 2 of admin ads roadmap. See backend/routers/site_promos.py
 * for the data model.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { fetchActiveSitePromo } from "../lib/api";

const TONE_STYLES = {
  default:     "border-brand bg-gradient-to-r from-[#ff4500]/15 to-transparent text-ink",
  celebration: "border-amber-400 bg-gradient-to-r from-amber-400/15 to-transparent text-ink",
  warning:     "border-red-500 bg-gradient-to-r from-red-500/15 to-transparent text-red-50",
};

const TONE_ACCENT = {
  default:     "text-brand",
  celebration: "text-brand",
  warning:     "text-red-600",
};

const dismissKey = (id) => `cm_promo_dismissed_${id}`;

export default function SitePromo({ placement }) {
  const [promo, setPromo] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchActiveSitePromo(placement);
        if (cancelled) return;
        const p = r?.promo || null;
        if (p) {
          try {
            if (localStorage.getItem(dismissKey(p.promo_id)) === "1") {
              setDismissed(true);
            }
          } catch { /* localStorage disabled */ }
        }
        setPromo(p);
      } catch {
        // Silent: a dead promo endpoint shouldn't break the page.
      }
    })();
    return () => { cancelled = true; };
  }, [placement]);

  const onDismiss = () => {
    if (!promo) return;
    try { localStorage.setItem(dismissKey(promo.promo_id), "1"); } catch { /* localStorage disabled */ }
    setDismissed(true);
  };

  if (!promo || dismissed) return null;

  const tone = TONE_STYLES[promo.tone] || TONE_STYLES.default;
  const accent = TONE_ACCENT[promo.tone] || TONE_ACCENT.default;

  return (
    <div
      className={`border ${tone} px-4 py-3 md:px-6 md:py-4`}
      data-testid={`site-promo-${placement}`}
      data-promo-id={promo.promo_id}
    >
      <div className="max-w-7xl mx-auto flex items-center gap-4 flex-wrap">
        {promo.image_url && (
          <img
            src={promo.image_url}
            alt=""
            className="w-12 h-12 object-cover shrink-0 hidden sm:block"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className={`font-display text-lg md:text-xl leading-tight ${accent}`}>
            {promo.title}
          </div>
          {promo.body && (
            <div className="font-mono text-xs md:text-sm text-ink mt-1 leading-relaxed">
              {promo.body}
            </div>
          )}
        </div>
        {promo.cta_label && promo.cta_url && (
          <PromoCta url={promo.cta_url} label={promo.cta_label} placement={placement} />
        )}
        {promo.dismissible && (
          <button
            onClick={onDismiss}
            className="p-1.5 text-ink-muted hover:text-ink transition shrink-0"
            data-testid={`site-promo-dismiss-${placement}`}
            aria-label="Dismiss promo"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

// Hoisted out of the parent component to satisfy react/no-unstable-nested-components.
function PromoCta({ url, label, placement }) {
  const isExternal = /^https?:\/\//i.test(url);
  const cls =
    "inline-flex items-center px-4 py-2 bg-paper hover:bg-surface border border-current font-mono text-[11px] uppercase tracking-[0.22em] transition shrink-0";
  if (isExternal) {
    return (
      <a
        href={url} target="_blank" rel="noopener noreferrer"
        className={cls} data-testid={`site-promo-cta-${placement}`}
      >
        {label} →
      </a>
    );
  }
  return (
    <Link to={url} className={cls} data-testid={`site-promo-cta-${placement}`}>
      {label} →
    </Link>
  );
}
