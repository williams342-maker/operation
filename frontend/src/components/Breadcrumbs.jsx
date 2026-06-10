import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/**
 * Visible breadcrumb navigation (iter299).
 *
 * Renders the trail above the page hero on PDP, MakerDetail, ShopPage,
 * MakersPage. Pair with `BreadcrumbList` JSON-LD (added separately via
 * `useStructuredData`) so Google can render the trail under the SERP
 * result AND human visitors get an obvious back-up-the-hierarchy link.
 *
 * Items: array of `{ name: string, to?: string }`. When `to` is omitted
 * the item renders as the current-page label (last in the list).
 *
 * Example:
 *   <Breadcrumbs items={[
 *     { name: "Home", to: "/" },
 *     { name: "Shop", to: "/shop" },
 *     { name: product.category, to: `/shop?category=${product.category}` },
 *     { name: product.title },
 *   ]} />
 */
export default function Breadcrumbs({ items, testId = "breadcrumbs" }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-muted mb-6 overflow-hidden"
      data-testid={testId}
    >
      <ol className="flex items-center flex-wrap gap-x-1.5 gap-y-1">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.name}-${idx}`} className="flex items-center gap-1.5 min-w-0">
              {item.to && !isLast ? (
                <Link
                  to={item.to}
                  className="text-ink-muted hover:text-brand transition truncate"
                  data-testid={`${testId}-link-${idx}`}
                >
                  {item.name}
                </Link>
              ) : (
                <span
                  className="text-brand truncate max-w-[280px]"
                  aria-current={isLast ? "page" : undefined}
                  data-testid={`${testId}-current`}
                >
                  {item.name}
                </span>
              )}
              {!isLast && (
                <ChevronRight
                  size={10}
                  className="text-ink-muted shrink-0"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
