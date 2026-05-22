/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState } from "react";
import { Package, Hammer, Truck, Sparkles } from "lucide-react";
import { fetchSiteVelocity } from "../lib/api";

/**
 * "Velocity Proof" strip — answers the buyer's #1 unconscious question
 * on a young marketplace: *"is this place alive?"*. Four concrete,
 * up-to-the-hour numbers framed as marketplace activity:
 *
 *   📦 orders this week         · proves people are buying
 *   🛠 makers active this week  · proves makers are working
 *   🚚 avg ship days            · proves shipping is real (and fast)
 *   ✨ custom orders this month · proves the custom-order moat works
 *
 * Each tile gracefully degrades when the underlying number is zero or
 * unavailable — quiet weeks should never make the site look abandoned.
 * The strip self-hides entirely when ALL four numbers are unavailable
 * (genuinely empty environment, e.g. brand new install).
 */
export default function VelocityProofStrip({ testId = "velocity-proof" }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchSiteVelocity()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData({}); });
    return () => { cancelled = true; };
  }, []);

  // Skeleton row during first paint — same height as the loaded version
  // so the homepage doesn't jump.
  if (!data) {
    return (
      <section
        className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-8"
        data-testid={`${testId}-loading`}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="border border-[#1f1f1f] bg-[#0d0d0d] p-4 md:p-5 h-[90px] animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  const tiles = [
    {
      key: "orders",
      icon: <Package size={14} />,
      value: data.orders_this_week,
      // Only show the tile when there's at least one paid order this week
      visible: (data.orders_this_week || 0) > 0,
      label: `order${data.orders_this_week === 1 ? "" : "s"} this week`,
      sub: "Real buyers · real shipments",
    },
    {
      key: "makers",
      icon: <Hammer size={14} />,
      value: data.makers_active_this_week,
      visible: (data.makers_active_this_week || 0) > 0,
      label: `maker${data.makers_active_this_week === 1 ? "" : "s"} active this week`,
      sub: data.total_makers
        ? `of ${data.total_makers} vetted American makers`
        : "Vetted American makers",
    },
    {
      key: "ship",
      icon: <Truck size={14} />,
      value: data.avg_ship_days,
      visible: typeof data.avg_ship_days === "number" && data.avg_ship_days >= 0,
      label: data.avg_ship_days === 1 ? "day avg ship time" : "days avg ship time",
      sub: "Rolling 30-day median",
    },
    {
      key: "custom",
      icon: <Sparkles size={14} />,
      value: data.custom_orders_this_month,
      visible: (data.custom_orders_this_month || 0) > 0,
      label: `custom order${data.custom_orders_this_month === 1 ? "" : "s"} this month`,
      sub: "Built-to-spec by the makers themselves",
    },
  ];

  const visibleTiles = tiles.filter((t) => t.visible);
  // Self-hide entirely when the marketplace is genuinely empty — better
  // a missing strip than a "0 orders, 0 makers" strip on launch day.
  if (visibleTiles.length === 0) return null;

  return (
    <section
      className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-8 md:py-10"
      data-testid={testId}
      aria-label="Marketplace activity"
    >
      <div
        className={`grid gap-3 md:gap-4 ${
          visibleTiles.length === 1
            ? "grid-cols-1 max-w-md"
            : visibleTiles.length === 2
            ? "grid-cols-2 max-w-2xl"
            : visibleTiles.length === 3
            ? "grid-cols-2 md:grid-cols-3"
            : "grid-cols-2 md:grid-cols-4"
        }`}
      >
        {visibleTiles.map((t) => (
          <div
            key={t.key}
            className="relative border border-[#1f1f1f] bg-[#0d0d0d] p-4 md:p-5 hover:border-[#ff4500]/40 transition group"
            data-testid={`${testId}-${t.key}`}
          >
            {/* Live-pulse dot — subtle "real time" cue */}
            <span className="absolute top-3 right-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-[#ff4500] animate-pulse" aria-hidden="true" />
              <span className="font-mono text-[8px] uppercase tracking-[0.22em] text-[#525252]">live</span>
            </span>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-[#ff4500] group-hover:scale-110 transition-transform">{t.icon}</span>
              <span
                className="font-display text-3xl md:text-4xl text-[#e5e5e5] leading-none"
                data-testid={`${testId}-${t.key}-value`}
              >
                {t.value}
              </span>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] leading-snug">
              {t.label}
            </div>
            {t.sub && (
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#525252] mt-1.5">
                {t.sub}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
