import type { MarketingImportRow } from "./marketingCsv.js";

export interface MarketingProviderAdapter {
  provider: string;
  validateConnection(input: { encryptedCredentials: unknown; externalAccountId?: string }): Promise<{ valid: boolean; accountName?: string; error?: string }>;
  normalizeManualRows?(rows: MarketingImportRow[]): Promise<{ rows: MarketingImportRow[]; warnings: string[] }>;
}

export const manualMarketingProvider: MarketingProviderAdapter = {
  provider: "manual",
  async validateConnection() { return { valid: true, accountName: "Manual CSV imports" }; },
  async normalizeManualRows(rows) { return { rows, warnings: [] }; },
};

