import React from "react";

/**
 * Industrial shimmer skeleton — matches the dark/orange brand.
 * Use as a placeholder for any loading state. Avoid the dreaded
 * "Loading…" text; show the *shape* of what's coming instead.
 */
export function Skeleton({ className = "", height = "h-6", width = "w-full" }) {
  return (
    <div
      className={`relative overflow-hidden bg-[#1a1a1a] ${height} ${width} ${className}`}
      data-testid="skeleton"
    >
      <div
        className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_linear_infinite]"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,69,0,0.08) 50%, transparent 100%)",
        }}
      />
    </div>
  );
}

/** A product/maker card placeholder — image + 2 lines + price. */
export function CardSkeleton({ count = 8 }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton height="aspect-[4/5]" width="w-full" />
          <Skeleton height="h-3" width="w-2/3" />
          <Skeleton height="h-3" width="w-1/3" />
        </div>
      ))}
    </div>
  );
}

/** Detail-page placeholder — hero + 2 columns. */
export function DetailSkeleton() {
  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="detail-skeleton">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 grid md:grid-cols-2 gap-12">
        <Skeleton height="aspect-[4/5]" width="w-full" />
        <div className="space-y-5">
          <Skeleton height="h-3" width="w-1/3" />
          <Skeleton height="h-12" width="w-3/4" />
          <Skeleton height="h-4" width="w-full" />
          <Skeleton height="h-4" width="w-5/6" />
          <Skeleton height="h-4" width="w-2/3" />
          <div className="pt-6 space-y-3">
            <Skeleton height="h-3" width="w-1/4" />
            <Skeleton height="h-12" width="w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Table-row skeleton for admin tabs. */
export function RowsSkeleton({ count = 6 }) {
  return (
    <div className="space-y-3" data-testid="rows-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border border-[#262626] p-4">
          <Skeleton height="h-10" width="w-10" />
          <div className="flex-1 space-y-2">
            <Skeleton height="h-3" width="w-1/3" />
            <Skeleton height="h-3" width="w-1/2" />
          </div>
          <Skeleton height="h-3" width="w-20" />
        </div>
      ))}
    </div>
  );
}

/** A row of stat cards (admin dashboard, maker dashboard). */
export function StatsSkeleton({ count = 4 }) {
  return (
    <div
      className={`grid grid-cols-2 md:grid-cols-${count} gap-2 md:gap-6`}
      data-testid="stats-skeleton"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border border-[#262626] p-4 space-y-3">
          <Skeleton height="h-3" width="w-1/2" />
          <Skeleton height="h-8" width="w-3/4" />
        </div>
      ))}
    </div>
  );
}
