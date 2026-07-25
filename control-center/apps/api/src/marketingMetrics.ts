import { calculateMarketingMetrics, marketingConversions, marketingMetricNames, type MarketingMetricInput } from "@control-center/shared";

export type MarketingMetricRow = MarketingMetricInput & { date?: string; currency?: string };

export function aggregateMarketingRows(rows: MarketingMetricRow[]) {
  const totals = Object.fromEntries(marketingMetricNames.map((name) => {
    const values = rows.map((row) => row[name]).filter((value): value is number => value !== undefined);
    return [name, values.length ? values.reduce((sum, value) => sum + value, 0) : null];
  })) as Record<(typeof marketingMetricNames)[number], number | null>;
  const conversions = marketingConversions(totals);
  return {
    totals: { ...totals, conversions },
    derived: calculateMarketingMetrics({ ...totals, conversions }),
  };
}

export function metricChange(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function funnelFromTotals(totals: ReturnType<typeof aggregateMarketingRows>["totals"]) {
  const stages = [
    ["Impressions", totals.impressions], ["Clicks", totals.clicks],
    ["Landing-page views", totals.landingPageViews], ["Leads", totals.leads],
    ["Applications or sign-ups", totals.applications === null && totals.signups === null ? null : (totals.applications || 0) + (totals.signups || 0)],
    ["Purchases", totals.purchases],
  ] as Array<[string, number | null]>;
  return stages.map(([label, value], index) => {
    const previous = index ? stages[index - 1][1] : null;
    return { label, value, rateFromPrevious: index === 0 || value === null || previous === null || previous === 0 ? null : value / previous * 100 };
  });
}

