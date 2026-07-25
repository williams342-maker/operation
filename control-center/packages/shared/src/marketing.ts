export const marketingMetricNames = [
  "impressions", "reach", "clicks", "landingPageViews", "spend", "leads",
  "applications", "signups", "purchases", "revenue", "videoViews", "videoCompletions"
] as const;

export type MarketingMetricName = typeof marketingMetricNames[number];
export type MarketingMetricInput = Partial<Record<MarketingMetricName, number>>;

export function safeDivide(numerator?: number | null, denominator?: number | null): number | null {
  if (numerator === undefined || numerator === null || denominator === undefined || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

export function percentage(numerator?: number | null, denominator?: number | null): number | null {
  const value = safeDivide(numerator, denominator);
  return value === null ? null : value * 100;
}

export function calculateMarketingMetrics(input: {
  impressions?: number | null;
  clicks?: number | null;
  landingPageViews?: number | null;
  leads?: number | null;
  conversions?: number | null;
  purchases?: number | null;
  spend?: number | null;
  revenue?: number | null;
}) {
  return {
    ctr: percentage(input.clicks, input.impressions),
    landingPageViewRate: percentage(input.landingPageViews, input.clicks),
    leadConversionRate: percentage(input.leads, input.landingPageViews),
    conversionRate: percentage(input.conversions, input.landingPageViews),
    purchaseConversionRate: percentage(input.purchases, input.landingPageViews),
    cpc: safeDivide(input.spend, input.clicks),
    costPerLead: safeDivide(input.spend, input.leads),
    costPerConversion: safeDivide(input.spend, input.conversions),
    costPerPurchase: safeDivide(input.spend, input.purchases),
    roas: safeDivide(input.revenue, input.spend),
    averageOrderValue: safeDivide(input.revenue, input.purchases),
  };
}

export function marketingConversions(input: { applications?: number | null; signups?: number | null; purchases?: number | null }) {
  const values = [input.applications, input.signups, input.purchases].filter((value): value is number => value !== null && value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

