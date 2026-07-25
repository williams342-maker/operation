import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("./api", () => ({ api: { get: mocks.get, post: mocks.post }, apiError: (error: unknown) => error instanceof Error ? error.message : "Unable to load marketing analytics." }));
import { MarketingAnalyticsPage, marketingFormatters } from "./MarketingAnalyticsPage";

const totals = { spend: null, impressions: null, reach: null, clicks: null, landingPageViews: null, leads: null, applications: null, signups: null, purchases: null, conversions: null, revenue: null, videoViews: null, videoCompletions: null };
const derived = { ctr: null, landingPageViewRate: null, leadConversionRate: null, conversionRate: null, purchaseConversionRate: null, cpc: null, costPerLead: null, costPerConversion: null, costPerPurchase: null, roas: null, averageOrderValue: null };
const emptyOverview = { range: { start: "2026-07-01", end: "2026-07-30", compare: "previous_period" }, currency: "USD", totals, derived, comparison: { changes: {} }, hasData: false };

function response(path: string) {
  if (path.startsWith("/marketing/overview")) return { data: emptyOverview };
  if (path.startsWith("/marketing/timeseries")) return { data: { metrics: ["spend", "clicks", "conversions"], points: [] } };
  if (path.startsWith("/marketing/funnel")) return { data: { stages: [], hasData: false } };
  if (path.startsWith("/marketing/channels")) return { data: { channels: [] } };
  if (path.startsWith("/marketing/campaigns")) return { data: { campaigns: [] } };
  return { data: {} };
}
function renderPage() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); return render(<QueryClientProvider client={client}><MarketingAnalyticsPage /></QueryClientProvider>); }

describe("Marketing Analytics Phase 1", () => {
  beforeEach(() => { window.history.replaceState({}, "", "/marketing"); mocks.get.mockReset(); mocks.post.mockReset(); mocks.get.mockImplementation(async (path: string) => response(path)); });
  afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

  it("shows a truthful empty state and null metric formatting", async () => {
    renderPage();
    expect(await screen.findByText("No marketing data is available for this period.")).toBeInTheDocument();
    expect(screen.getByText("Connect an account, import a report, or add first-party conversion tracking.")).toBeInTheDocument();
    expect(screen.getAllByText("Not available").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByRole("navigation", { name: "Marketing Analytics sections" })).toBeInTheDocument();
  });

  it("renders loading and error states without invented results", async () => {
    mocks.get.mockImplementation((path: string) => path.startsWith("/marketing/overview") ? new Promise(() => {}) : Promise.resolve(response(path)));
    const view = renderPage(); expect(await screen.findByLabelText("Spend loading")).toBeInTheDocument(); view.unmount();
    mocks.get.mockImplementation((path: string) => path.startsWith("/marketing/overview") ? Promise.reject(new Error("Scoped analytics unavailable")) : Promise.resolve(response(path)));
    renderPage(); expect(await screen.findByRole("alert")).toHaveTextContent("Scoped analytics unavailable");
  });

  it("updates the global date range and comparison query", async () => {
    renderPage(); await screen.findByText("No marketing data is available for this period.");
    await userEvent.selectOptions(screen.getByLabelText("Marketing date range"), "last_7");
    await userEvent.selectOptions(screen.getByLabelText("Marketing comparison"), "previous_year");
    await waitFor(() => expect(mocks.get.mock.calls.some(([path]) => String(path).startsWith("/marketing/overview?") && String(path).includes("compare=previous_year"))).toBe(true));
  });

  it("shows comparison values and treats higher spend as an adverse change", async () => {
    mocks.get.mockImplementation(async (path: string) => path.startsWith("/marketing/overview") ? { data: { ...emptyOverview, hasData: true, totals: { ...totals, spend: 120 }, comparison: { totals: { ...totals, spend: 100 }, derived, changes: { spend: 20 } } } } : response(path));
    renderPage();
    expect(await screen.findByText("Comparison: $100.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Spend: +20.0% vs comparison")).toHaveClass("text-danger");
  });

  it("enforces a three-metric chart selection maximum", async () => {
    renderPage(); await screen.findByText("No marketing data is available for this period.");
    expect(screen.getByLabelText("Impressions")).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Conversions"));
    expect(screen.getByLabelText("Impressions")).toBeEnabled();
    await userEvent.click(screen.getByLabelText("Impressions"));
    await waitFor(() => expect(mocks.get.mock.calls.some(([path]) => String(path).includes("metrics=spend%2Cclicks%2Cimpressions") || String(path).includes("metrics=spend,clicks,impressions"))).toBe(true));
  });

  it("previews and confirms a validated CSV import", async () => {
    mocks.post.mockImplementation(async (path: string) => path === "/marketing/imports/preview" ? { data: { rowCount: 1, rows: [{ date: "2026-07-01", provider: "manual", channel: "Email", campaign: "Newsletter", currency: "USD", clicks: 12 }], previewDigest: "a".repeat(64) } } : { data: { imported: 1, updated: 0, skipped: 0 } });
    renderPage(); await screen.findByText("No marketing data is available for this period.");
    const file = new File(["date,channel,campaign,clicks\n2026-07-01,Email,Newsletter,12"], "marketing.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "date,channel,campaign,clicks\n2026-07-01,Email,Newsletter,12" });
    await userEvent.upload(screen.getByLabelText("Marketing CSV file"), file);
    await userEvent.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByRole("button", { name: "Confirm 1 rows" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm 1 rows" }));
    expect(await screen.findByRole("status")).toHaveTextContent("1 added");
  });

  it("formats currency, percent, number, and ROAS nulls consistently", () => {
    expect(marketingFormatters.currency(null)).toBe("Not available"); expect(marketingFormatters.percent(null)).toBe("Not available"); expect(marketingFormatters.number(null)).toBe("Not available"); expect(marketingFormatters.roas(null)).toBe("Not available");
    expect(marketingFormatters.currency(12.5, "USD")).toContain("12.50"); expect(marketingFormatters.percent(12.345)).toBe("12.35%"); expect(marketingFormatters.roas(3.2)).toBe("3.20×");
  });
});
