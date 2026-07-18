import { z } from "zod";

export const aiOrganizationSettingsUpdateSchema = z.object({
  enabled: z.boolean(), provider: z.string().max(80).nullable(), model: z.string().max(160).nullable(),
  monthlyRequestLimit: z.number().int().min(1).max(1_000_000).nullable(), monthlyTokenLimit: z.number().int().min(1).max(1_000_000_000).nullable(),
  maximumRequestsPerUserPerHour: z.number().int().min(1).max(10_000), maximumRequestsPerOrganizationPerDay: z.number().int().min(1).max(1_000_000), maximumConcurrentRequests: z.number().int().min(1).max(100),
  allowedScopeTypes: z.array(z.enum(["server", "application"])).min(1).max(2), retentionAcknowledged: z.boolean()
}).strict();
export type AiOrganizationSettingsUpdate = z.infer<typeof aiOrganizationSettingsUpdateSchema>;
