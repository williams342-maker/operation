import React from "react";

/**
 * Author label for community surfaces (forum threads/replies + showcase
 * posts). When the author is the platform's own "Crafters Market Workshop
 * Team" account — used for the curated seed posts that keep the community
 * tab from feeling empty — render an amber ✦-prefixed pill so visitors
 * can tell at a glance it's first-party content, not a real maker/buyer.
 *
 * All other authors render unchanged.
 */
const WORKSHOP_TEAM = "Crafters Market Workshop Team";

export default function AuthorLabel({ name, email, className = "" }) {
  const display = name || email;
  if (display === WORKSHOP_TEAM) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-amber-300/90 ${className}`}
        data-testid="author-workshop-team"
        title="Curated by Crafters Market — first-party content while the community grows"
      >
        ✦ Crafters Market Workshop Team
      </span>
    );
  }
  return <span className={className}>{display}</span>;
}
