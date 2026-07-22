import { z } from "zod";

export const connectivityProviderSchema = z.enum(["cloudflare"]);

export const connectivityStatusSchema = z.object({
  provider: connectivityProviderSchema,
  configured: z.boolean(),
  state: z.enum(["connected", "disconnected", "unknown"]),
  service: z.object({
    installed: z.boolean(), active: z.boolean(), enabled: z.boolean(),
    version: z.string().max(160).optional(), uptimeSeconds: z.number().int().nonnegative().optional(),
    lastReconnectAt: z.string().datetime().optional()
  }),
  tunnel: z.object({ connected: z.boolean(), identifier: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/).optional() }),
  observedAt: z.string().datetime()
}).strict();

export const cloudflareOnboardingSchema = z.object({
  enabled: z.boolean().default(false),
  tunnel: z.object({ enabled: z.boolean(), token: z.string().min(16).max(8192).optional() }).strict().default({ enabled: false }),
  access: z.object({ enabled: z.boolean(), clientId: z.string().min(3).max(2048).optional(), clientSecret: z.string().min(8).max(8192).optional() }).strict().default({ enabled: false })
}).strict().superRefine((value, context) => {
  if (!value.enabled && (value.tunnel.enabled || value.access.enabled)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Cloudflare must be enabled" });
  if (value.tunnel.enabled && !value.tunnel.token) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tunnel", "token"], message: "Tunnel token is required" });
  if (value.access.enabled && (!value.access.clientId || !value.access.clientSecret)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["access"], message: "Access credentials are required" });
});

export type ConnectivityStatus = z.infer<typeof connectivityStatusSchema>;
export type CloudflareOnboarding = z.infer<typeof cloudflareOnboardingSchema>;
