import { createHash } from "node:crypto";
import { marketingMetricNames, type MarketingMetricInput } from "@control-center/shared";

export type MarketingImportRow = MarketingMetricInput & { date: string; provider: string; channel: string; campaign: string; currency: string };
const headerMap: Record<string, keyof MarketingImportRow> = {
  date: "date", provider: "provider", channel: "channel", campaign: "campaign", currency: "currency",
  impressions: "impressions", reach: "reach", clicks: "clicks", landing_page_views: "landingPageViews",
  landingpageviews: "landingPageViews", spend: "spend", leads: "leads", applications: "applications",
  signups: "signups", purchases: "purchases", revenue: "revenue", video_views: "videoViews", video_completions: "videoCompletions",
};

function parseRecords(csv: string) {
  const records: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); records.push(row); row = []; field = ""; }
    else field += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field || row.length) { row.push(field.replace(/\r$/, "")); records.push(row); }
  return records.filter((record) => record.some((value) => value.trim()));
}

function isoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export function parseMarketingCsv(csv: string, defaults: { currency?: string } = {}) {
  if (Buffer.byteLength(csv, "utf8") > 1_000_000) return { rows: [] as MarketingImportRow[], errors: ["CSV exceeds the 1 MB limit"], digest: "" };
  let records: string[][];
  try { records = parseRecords(csv.replace(/^\uFEFF/, "")); } catch (error) { return { rows: [] as MarketingImportRow[], errors: [(error as Error).message], digest: "" }; }
  if (records.length < 2) return { rows: [] as MarketingImportRow[], errors: ["CSV must contain a header and at least one data row"], digest: "" };
  if (records.length > 5001) return { rows: [] as MarketingImportRow[], errors: ["CSV exceeds the 5,000 row limit"], digest: "" };
  const headers = records[0].map((value) => value.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  if (!headers.includes("date")) return { rows: [] as MarketingImportRow[], errors: ["CSV requires a date column"], digest: "" };
  const errors: string[] = []; const rows: MarketingImportRow[] = []; const seen = new Set<string>();
  records.slice(1).forEach((record, rowIndex) => {
    const raw: Record<string, string> = {};
    headers.forEach((header, index) => { const mapped = headerMap[header]; if (mapped) raw[mapped] = (record[index] || "").trim(); });
    const line = rowIndex + 2; const date = raw.date || ""; const provider = (raw.provider || "manual").toLowerCase(); const channel = raw.channel || "Other"; const campaign = raw.campaign || "Unassigned campaign"; const currency = (raw.currency || defaults.currency || "USD").toUpperCase();
    if (!isoDate(date)) errors.push(`Row ${line}: date must use YYYY-MM-DD`);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(provider)) errors.push(`Row ${line}: provider is invalid`);
    if (!channel || channel.length > 80) errors.push(`Row ${line}: channel is invalid`);
    if (!campaign || campaign.length > 200 || [...campaign].some((character) => character.charCodeAt(0) < 32)) errors.push(`Row ${line}: campaign is invalid`);
    if (!/^[A-Z]{3}$/.test(currency)) errors.push(`Row ${line}: currency must be a three-letter code`);
    const metrics: MarketingMetricInput = {};
    for (const name of marketingMetricNames) {
      const value = raw[name]; if (value === undefined || value === "") continue;
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0) errors.push(`Row ${line}: ${name} must be a nonnegative number`);
      else metrics[name] = numeric;
    }
    if (!Object.keys(metrics).length) errors.push(`Row ${line}: at least one metric is required`);
    const key = `${provider}\u0000${campaign}\u0000${date}`;
    if (seen.has(key)) errors.push(`Row ${line}: duplicate provider, campaign, and date`); else seen.add(key);
    rows.push({ date, provider, channel, campaign, currency, ...metrics });
  });
  if (errors.length) return { rows: [], errors: errors.slice(0, 100), digest: "" };
  const digest = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  return { rows, errors: [], digest };
}
