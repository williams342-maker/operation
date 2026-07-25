import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { parseMarketingCsv } from "../src/marketingCsv.js";
import { aggregateMarketingRows, funnelFromTotals, metricChange } from "../src/marketingMetrics.js";
import { scopedFilter } from "../src/db.js";

const validCsv = `date,provider,channel,campaign,impressions,clicks,landing_page_views,spend,leads,applications,signups,purchases,revenue,currency
2026-07-01,meta,Facebook / Instagram,Summer Launch,1000,100,80,200,10,2,3,4,800,USD
2026-07-02,google_ads,Google Ads,Search Launch,500,50,40,100,5,1,1,2,400,USD`;

test("manual marketing CSV validates, normalizes, and produces a stable preview digest", () => {
  const first = parseMarketingCsv(validCsv); const second = parseMarketingCsv(validCsv);
  assert.equal(first.errors.length, 0); assert.equal(first.rows.length, 2); assert.equal(first.digest, second.digest);
  assert.equal(first.rows[0].landingPageViews, 80); assert.equal(first.rows[0].currency, "USD");
});

test("manual marketing CSV rejects duplicates, negative metrics, invalid dates, and empty metrics", () => {
  const duplicate = parseMarketingCsv(`date,campaign,clicks\n2026-07-01,One,1\n2026-07-01,One,2`);
  assert.ok(duplicate.errors.some((error) => error.includes("duplicate")));
  assert.ok(parseMarketingCsv(`date,campaign,clicks\n2026-02-30,One,1`).errors.some((error) => error.includes("date")));
  assert.ok(parseMarketingCsv(`date,campaign,spend\n2026-07-01,One,-1`).errors.some((error) => error.includes("nonnegative")));
  assert.ok(parseMarketingCsv(`date,campaign,spend\n2026-07-01,One,`).errors.some((error) => error.includes("at least one metric")));
});

test("aggregates distinguish missing marketing data from true zero", () => {
  const missing = aggregateMarketingRows([{ clicks: 0 }, { clicks: 0 }]);
  assert.equal(missing.totals.clicks, 0); assert.equal(missing.totals.spend, null); assert.equal(missing.totals.conversions, null); assert.equal(missing.derived.cpc, null);
  const totals = aggregateMarketingRows([{ impressions: 100, clicks: 20, landingPageViews: 10, applications: 1, signups: 2, purchases: 1, spend: 40, revenue: 200 }]);
  assert.equal(totals.totals.conversions, 4); assert.equal(totals.derived.ctr, 20); assert.equal(totals.derived.roas, 5);
  assert.equal(metricChange(120, 100), 20); assert.equal(metricChange(0, 0), null);
  assert.equal(funnelFromTotals(totals.totals)[1].rateFromPrevious, 20);
});

test("marketing collection filters override attacker-supplied organization scope", () => {
  const orgA = new ObjectId(); const orgB = new ObjectId();
  const filter = scopedFilter(orgA, { orgId: orgB, date: "2026-07-01" } as any);
  assert.equal(filter.orgId, orgA); assert.notEqual(filter.orgId.toHexString(), orgB.toHexString());
});

