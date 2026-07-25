import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { marketingMetricNames } from "@control-center/shared";
import { audit } from "./audit.js";
import { requirePermission } from "./auth.js";
import { collections } from "./db.js";
import { parseMarketingCsv } from "./marketingCsv.js";
import { aggregateMarketingRows, funnelFromTotals, metricChange, type MarketingMetricRow } from "./marketingMetrics.js";
import { manualMarketingProvider } from "./marketingProviders.js";

export const marketingRouter = express.Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeSchema = z.object({ start: isoDate, end: isoDate, compare: z.enum(["none", "previous_period", "previous_year"]).default("previous_period") }).superRefine((value, context) => {
  const start = new Date(`${value.start}T00:00:00.000Z`); const end = new Date(`${value.end}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== value.start) context.addIssue({ code: "custom", path: ["start"], message: "Invalid start date" });
  if (Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== value.end) context.addIssue({ code: "custom", path: ["end"], message: "Invalid end date" });
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (!Number.isNaN(days) && (days < 1 || days > 366)) context.addIssue({ code: "custom", path: ["end"], message: "Range must be between 1 and 366 days" });
});
const csvSchema = z.object({ csv: z.string().min(1).max(1_000_000), currency: z.string().regex(/^[A-Za-z]{3}$/).optional(), previewDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();

function orgId(req: express.Request) { if (!req.orgId) throw new Error("Missing organization scope"); return req.orgId; }
function actorId(req: express.Request) { if (!req.user?._id) throw new Error("Missing user"); return req.user._id; }
function day(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function dateValue(value: Date) { return value.toISOString().slice(0, 10); }
function validatedRange(query: unknown) {
  const range = rangeSchema.parse(query); const start = day(range.start); const end = day(range.end);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return { ...range, startDate: start, endDate: end, days };
}
function comparisonRange(range: ReturnType<typeof validatedRange>) {
  if (range.compare === "none") return null;
  if (range.compare === "previous_year") { const start = new Date(range.startDate); const end = new Date(range.endDate); start.setUTCFullYear(start.getUTCFullYear() - 1); end.setUTCFullYear(end.getUTCFullYear() - 1); return { start: dateValue(start), end: dateValue(end) }; }
  const end = new Date(range.startDate.getTime() - 86_400_000); const start = new Date(end.getTime() - (range.days - 1) * 86_400_000);
  return { start: dateValue(start), end: dateValue(end) };
}
function metricRows(rows: Array<Record<string, unknown>>) { return rows.map((row) => Object.fromEntries(marketingMetricNames.filter((name) => typeof row[name] === "number").map((name) => [name, row[name]])) as MarketingMetricRow); }
async function rowsFor(org: ObjectId, start: string, end: string) { return collections.marketingMetricsDaily.find({ orgId: org, date: { $gte: start, $lte: end } }).sort({ date: 1 }).limit(100_000).toArray(); }
function currencyFor(rows: Array<{ currency?: string }>) { const values = [...new Set(rows.map((row) => row.currency).filter(Boolean))]; return values.length === 1 ? values[0]! : values.length ? null : "USD"; }
function monetarySafe(result: ReturnType<typeof aggregateMarketingRows>, currency: string | null) {
  if (currency) return result;
  const totals = { ...result.totals, spend: null, revenue: null };
  return { totals, derived: aggregateMarketingRows([{ impressions: totals.impressions ?? undefined, clicks: totals.clicks ?? undefined, landingPageViews: totals.landingPageViews ?? undefined, leads: totals.leads ?? undefined, applications: totals.applications ?? undefined, signups: totals.signups ?? undefined, purchases: totals.purchases ?? undefined }]).derived };
}
function changes(current: Record<string, number | null>, previous: Record<string, number | null>) { return Object.fromEntries(Object.keys(current).map((key) => [key, metricChange(current[key], previous[key])])); }

marketingRouter.get("/marketing/overview", requirePermission("marketing:view"), async (req, res, next) => {
  try {
    const range = validatedRange(req.query); const org = orgId(req); const compare = comparisonRange(range);
    const [rows, previousRows] = await Promise.all([rowsFor(org, range.start, range.end), compare ? rowsFor(org, compare.start, compare.end) : []]);
    const currency = currencyFor(rows); const current = monetarySafe(aggregateMarketingRows(metricRows(rows)), currency); const previous = monetarySafe(aggregateMarketingRows(metricRows(previousRows)), currencyFor(previousRows));
    res.json({ range: { start: range.start, end: range.end, compare: range.compare }, currency, totals: current.totals, derived: current.derived, comparison: compare ? { range: compare, totals: previous.totals, derived: previous.derived, changes: { ...changes(current.totals, previous.totals), ...changes(current.derived, previous.derived) } } : null, hasData: rows.length > 0 });
  } catch (error) { next(error); }
});

marketingRouter.get("/marketing/timeseries", requirePermission("marketing:view"), async (req, res, next) => {
  try {
    const range = validatedRange(req.query); const requested = String(req.query.metrics || "spend,clicks,purchases").split(",").filter(Boolean);
    const supported = [...marketingMetricNames, "conversions", "roas"] as const;
    if (requested.length < 1 || requested.length > 3 || requested.some((name) => !supported.includes(name as typeof supported[number]))) return res.status(400).json({ error: "Select between one and three supported metrics" });
    const rows = await rowsFor(orgId(req), range.start, range.end); const grouped = new Map<string, MarketingMetricRow[]>();
    rows.forEach((row) => grouped.set(row.date, [...(grouped.get(row.date) || []), row]));
    res.json({ metrics: requested, points: [...grouped.entries()].map(([date, values]) => { const aggregate = aggregateMarketingRows(metricRows(values)); return { date, ...Object.fromEntries(requested.map((name) => [name, name === "roas" ? aggregate.derived.roas : aggregate.totals[name as keyof typeof aggregate.totals]])) }; }) });
  } catch (error) { next(error); }
});

marketingRouter.get("/marketing/channels", requirePermission("marketing:view"), async (req, res, next) => {
  try {
    const range = validatedRange(req.query); const rows = await rowsFor(orgId(req), range.start, range.end); const grouped = new Map<string, typeof rows>();
    rows.forEach((row) => grouped.set(row.channel, [...(grouped.get(row.channel) || []), row]));
    res.json({ channels: [...grouped.entries()].map(([channel, values]) => ({ channel, currency: currencyFor(values), ...aggregateMarketingRows(metricRows(values)) })).sort((a, b) => (b.totals.spend || 0) - (a.totals.spend || 0)) });
  } catch (error) { next(error); }
});

marketingRouter.get("/marketing/campaigns", requirePermission("marketing:view"), async (req, res, next) => {
  try {
    const range = validatedRange(req.query); const org = orgId(req); const rows = await rowsFor(org, range.start, range.end); const ids = [...new Set(rows.map((row) => row.campaignId?.toHexString()).filter((id): id is string => Boolean(id)))];
    const campaigns = ids.length ? await collections.marketingCampaigns.find({ orgId: org, _id: { $in: ids.map((id) => new ObjectId(id)) } }).toArray() : []; const byId = new Map(campaigns.map((campaign) => [campaign._id!.toHexString(), campaign])); const grouped = new Map<string, typeof rows>();
    rows.forEach((row) => { const key = row.campaignId?.toHexString() || "unassigned"; grouped.set(key, [...(grouped.get(key) || []), row]); });
    res.json({ campaigns: [...grouped.entries()].map(([id, values]) => { const campaign = byId.get(id); return { id, name: campaign?.name || "Unassigned campaign", provider: campaign?.provider || values[0]?.provider || "manual", status: campaign?.status || "unknown", currency: currencyFor(values), ...aggregateMarketingRows(metricRows(values)) }; }).sort((a, b) => (b.totals.spend || 0) - (a.totals.spend || 0)) });
  } catch (error) { next(error); }
});

marketingRouter.get("/marketing/campaigns/:campaignId", requirePermission("marketing:view"), async (req, res, next) => {
  try { if (!ObjectId.isValid(String(req.params.campaignId))) return res.status(404).json({ error: "Campaign not found" }); const campaign = await collections.marketingCampaigns.findOne({ _id: new ObjectId(String(req.params.campaignId)), orgId: orgId(req) }); if (!campaign) return res.status(404).json({ error: "Campaign not found" }); res.json({ campaign }); } catch (error) { next(error); }
});

marketingRouter.get("/marketing/funnel", requirePermission("marketing:view"), async (req, res, next) => {
  try { const range = validatedRange(req.query); const rows = await rowsFor(orgId(req), range.start, range.end); res.json({ stages: funnelFromTotals(aggregateMarketingRows(metricRows(rows)).totals), hasData: rows.length > 0 }); } catch (error) { next(error); }
});

marketingRouter.get("/marketing/accounts", requirePermission("marketing:view"), async (req, res, next) => {
  try { const accounts = await collections.marketingAccounts.find({ orgId: orgId(req) }, { projection: { encryptedCredentials: 0, lastSyncError: 0 } }).sort({ createdAt: -1 }).toArray(); res.json({ accounts }); } catch (error) { next(error); }
});

marketingRouter.post("/marketing/imports/preview", requirePermission("marketing:import"), async (req, res, next) => {
  try { const body = csvSchema.omit({ previewDigest: true }).parse(req.body); const parsed = parseMarketingCsv(body.csv, { currency: body.currency }); if (parsed.errors.length) return res.status(400).json({ error: "Marketing CSV validation failed", errors: parsed.errors }); res.json({ rowCount: parsed.rows.length, rows: parsed.rows.slice(0, 25), previewDigest: parsed.digest, truncated: parsed.rows.length > 25 }); } catch (error) { next(error); }
});

marketingRouter.post("/marketing/imports", requirePermission("marketing:import"), async (req, res, next) => {
  try {
    const body = csvSchema.extend({ previewDigest: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.body); const parsed = parseMarketingCsv(body.csv, { currency: body.currency });
    if (parsed.errors.length) return res.status(400).json({ error: "Marketing CSV validation failed", errors: parsed.errors });
    if (parsed.digest !== body.previewDigest) return res.status(409).json({ error: "CSV changed after preview; preview it again before importing" });
    const normalized = await manualMarketingProvider.normalizeManualRows!(parsed.rows); const org = orgId(req); const now = new Date();
    const account = await collections.marketingAccounts.findOneAndUpdate({ orgId: org, provider: "manual", displayName: "Manual CSV imports" }, { $setOnInsert: { orgId: org, provider: "manual", displayName: "Manual CSV imports", status: "connected", createdBy: actorId(req), createdAt: now }, $set: { lastSyncAt: now, lastSyncStatus: "success", updatedAt: now } }, { upsert: true, returnDocument: "after" });
    if (!account?._id) throw new Error("Unable to prepare manual marketing account");
    let imported = 0; let updated = 0; let skipped = 0;
    for (const row of normalized.rows) {
      const campaign = await collections.marketingCampaigns.findOneAndUpdate({ orgId: org, provider: row.provider, marketingAccountId: account._id, name: row.campaign }, { $setOnInsert: { orgId: org, provider: row.provider, marketingAccountId: account._id, name: row.campaign, status: "unknown", currency: row.currency, createdAt: now }, $set: { currency: row.currency, updatedAt: now } }, { upsert: true, returnDocument: "after" });
      if (!campaign?._id) throw new Error("Unable to prepare marketing campaign");
      const metrics = Object.fromEntries(marketingMetricNames.filter((name) => row[name] !== undefined).map((name) => [name, row[name]]));
      const absent = Object.fromEntries(marketingMetricNames.filter((name) => row[name] === undefined).map((name) => [name, 1 as const]));
      const metricFilter = { orgId: org, provider: row.provider, marketingAccountId: account._id, campaignId: campaign._id, date: row.date };
      const existing = await collections.marketingMetricsDaily.findOne(metricFilter);
      const unchanged = existing
        && existing.channel === row.channel
        && existing.currency === row.currency
        && marketingMetricNames.every((name) => Object.is(existing[name], row[name]));
      if (unchanged) { skipped += 1; continue; }
      const result = await collections.marketingMetricsDaily.updateOne(metricFilter, { $set: { channel: row.channel, currency: row.currency, ...metrics, updatedAt: now }, $setOnInsert: { orgId: org, provider: row.provider, marketingAccountId: account._id, campaignId: campaign._id, date: row.date, createdAt: now }, ...(Object.keys(absent).length ? { $unset: absent } : {}) }, { upsert: true });
      if (result.upsertedCount) imported += 1; else if (result.modifiedCount) updated += 1; else skipped += 1;
    }
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "marketing.import", targetType: "marketing-metrics", targetId: account._id, result: "success", requestId: req.requestId, metadata: { imported, updated, skipped, rowCount: parsed.rows.length, provider: "manual" } });
    res.status(201).json({ imported, updated, skipped, warnings: normalized.warnings, rowCount: parsed.rows.length });
  } catch (error) { next(error); }
});
