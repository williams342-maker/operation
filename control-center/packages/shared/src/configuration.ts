import { z } from "zod";

export const settingTypes = ["text", "secret", "url", "boolean", "integer", "enum", "multiline", "json"] as const;
export const settingStatuses = ["missing", "configured", "invalid", "stale", "unverified", "conflicted", "pending", "active"] as const;
export const configurationCapabilities = [
  "environmentDiscovery",
  "configurationFingerprinting",
  "encryptedSecretDelivery",
  "environmentFileWrite",
  "dockerComposeActivation",
  "systemdActivation",
  "configurationValidation",
  "configurationRollback"
] as const;

export const settingNameSchema = z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/);
export const configurationScopeSchema = z.object({
  projectId: z.string().min(12).max(64),
  applicationPath: z.string().max(1024).optional(),
  environment: z.string().trim().min(1).max(80),
  serverId: z.string().min(12).max(64).optional(),
  service: z.string().trim().min(1).max(255).optional()
});

export const discoveredSettingSchema = z.object({
  name: settingNameSchema,
  applicationPath: z.string().max(1024),
  sources: z.array(z.enum(["env-example", "compose", "dockerfile", "source", "workflow", "systemd", "runtime-name"])).max(12),
  sourcePaths: z.array(z.string().max(1024)).max(20),
  services: z.array(z.string().max(255)).max(30).default([]),
  required: z.boolean().default(false),
  secret: z.boolean(),
  type: z.enum(settingTypes),
  provider: z.string().max(120).optional(),
  usage: z.enum(["runtime", "build", "worker", "scheduler", "proxy", "unknown"]).default("unknown"),
  configured: z.boolean().optional(),
  authoritativePath: z.string().max(1024).optional()
});

export type DiscoveredSetting = z.infer<typeof discoveredSettingSchema>;
export type SettingType = typeof settingTypes[number];

const providerRules: Array<[RegExp, string]> = [
  [/^(MONGO|MONGODB)_/, "MongoDB"], [/^(POSTGRES|PG)_/, "PostgreSQL"], [/^REDIS_/, "Redis"],
  [/^R2_/, "Cloudflare R2"], [/^(AWS_|S3_)/, "Amazon S3"], [/^STRIPE_/, "Stripe"],
  [/^PAYPAL_/, "PayPal"], [/^OPENAI_/, "OpenAI"], [/^ANTHROPIC_/, "Anthropic"],
  [/^(SENDGRID|BREVO|RESEND|MAILERSEND|MAILTRAP|POSTMARK|MAILGUN)_/, "Email"],
  [/^TWILIO_/, "Twilio"], [/^(GOOGLE|GA4|GADS)_/, "Google"], [/^(AZURE|ENTRA|MICROSOFT)_/, "Microsoft"],
  [/^(GITHUB|GH)_/, "GitHub"], [/^CLOUDFLARE_/, "Cloudflare"]
];

export function recognizeProvider(name: string) {
  return providerRules.find(([pattern]) => pattern.test(name))?.[1];
}

export function classifySecret(name: string) {
  return /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|API_KEY|SIGNING|CREDENTIAL|CONNECTION_STRING|DATABASE_URL|MONGO_URL|REDIS_URL)/i.test(name);
}

export function classifySettingType(name: string, secret = classifySecret(name)): SettingType {
  if (secret) return "secret";
  if (/(URL|URI|ENDPOINT|ORIGIN|CALLBACK|REDIRECT|DOMAIN|HOST)$/i.test(name)) return "url";
  if (/(ENABLED|DISABLED|REQUIRED|DEBUG)$/i.test(name)) return "boolean";
  if (/(PORT|LIMIT|TIMEOUT|TTL|COUNT|SIZE|BYTES)$/i.test(name)) return "integer";
  return "text";
}
