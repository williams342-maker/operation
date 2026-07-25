import test from "node:test";
import assert from "node:assert/strict";
import { calculateMarketingMetrics, marketingConversions, percentage, safeDivide } from "../src/marketing.js";

test("marketing metrics calculate ratios without fabricating unavailable values", () => {
  assert.equal(safeDivide(100, 20), 5);
  assert.equal(percentage(25, 100), 25);
  assert.equal(safeDivide(undefined, 20), null);
  assert.equal(safeDivide(10, 0), null);
  assert.equal(marketingConversions({}), null);
  assert.equal(marketingConversions({ applications: 0, signups: 0, purchases: 0 }), 0);
  assert.deepEqual(calculateMarketingMetrics({ impressions: 1000, clicks: 50, landingPageViews: 40, leads: 8, conversions: 5, purchases: 2, spend: 100, revenue: 500 }), {
    ctr: 5, landingPageViewRate: 80, leadConversionRate: 20, conversionRate: 12.5,
    purchaseConversionRate: 5, cpc: 2, costPerLead: 12.5, costPerConversion: 20,
    costPerPurchase: 50, roas: 5, averageOrderValue: 250,
  });
});

