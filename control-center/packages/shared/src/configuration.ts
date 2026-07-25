import { z } from "zod";

export const settingTypes = ["text", "secret", "url", "boolean", "integer", "enum", "multiline", "json"] as const;
export const settingStatuses = ["missing", "configured", "invalid", "stale", "unverified", "conflicted", "pending", "active"] as const;
export const configurationRiskLevels = ["low", "medium", "high", "critical"] as const;
export const configurationValidationTypes = ["text", "url", "boolean", "integer", "port", "enum", "regex", "json"] as const;
export const restartRequirements = ["none", "reload", "restart", "recreate", "rebuild"] as const;
export const criticalConfigurationVariables = [
  "CONTROL_CENTER_ENROLLMENT_TRUST_ROOT",
  "CONTROL_CENTER_AGENT_SIGNING_KEY",
  "CONTROL_CENTER_RECOVERY_CREDENTIAL",
  "CONTROL_CENTER_ENCRYPTION_KEY",
  "CONTROL_CENTER_AGENT_CAPABILITY_POLICY",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET"
] as const;
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
export const environmentDefinitionSchema = z.object({
  name: settingNameSchema,
  description: z.string().trim().min(1).max(1000),
  secret: z.boolean(),
  required: z.boolean(),
  applicableEnvironments: z.array(z.enum(["production", "staging", "development", "testing", "preview", "ci", "custom"])).min(1).max(7),
  validation: z.object({ type: z.enum(configurationValidationTypes), pattern: z.string().max(500).optional(), allowedValues: z.array(z.string().max(1024)).max(100).optional(), minimum: z.number().optional(), maximum: z.number().optional() }).strict(),
  services: z.array(z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/)).max(30),
  restartRequirement: z.enum(restartRequirements),
  removalPermitted: z.boolean(),
  browserDisplayPermitted: z.boolean(),
  risk: z.enum(configurationRiskLevels),
  introducedIn: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  deprecatedIn: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  renamedFrom: settingNameSchema.optional()
}).strict().superRefine((definition, context) => {
  if (definition.secret && definition.browserDisplayPermitted) context.addIssue({ code: z.ZodIssueCode.custom, message: "Secret values can never be browser-displayable", path: ["browserDisplayPermitted"] });
  if ((criticalConfigurationVariables as readonly string[]).includes(definition.name) && definition.risk !== "critical") context.addIssue({ code: z.ZodIssueCode.custom, message: "Protected variables must use the critical rotation workflow", path: ["risk"] });
  if (definition.validation.type === "enum" && !definition.validation.allowedValues?.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Enum validation requires allowed values", path: ["validation", "allowedValues"] });
});

export type EnvironmentDefinition = z.infer<typeof environmentDefinitionSchema>;

export function validateEnvironmentDefinitionValue(definition: EnvironmentDefinition, value: string): string | undefined {
  if (Buffer.byteLength(value, "utf8") > 16 * 1024 || /[\0\r\n]/.test(value)) return "Value contains prohibited bytes or exceeds 16 KiB";
  const rule = definition.validation;
  if (rule.type === "boolean" && !/^(true|false)$/.test(value)) return "Value must be true or false";
  if (["integer", "port"].includes(rule.type) && !/^-?\d+$/.test(value)) return "Value must be an integer";
  if (rule.type === "port" && (+value < 1 || +value > 65535)) return "Port must be between 1 and 65535";
  if (rule.type === "url") { try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return "URL must be credential-free HTTP(S)"; } catch { return "Value must be a valid URL"; } }
  if (rule.type === "enum" && !rule.allowedValues?.includes(value)) return "Value is not allowlisted";
  if (rule.type === "regex" && (!rule.pattern || !(new RegExp(rule.pattern, "u")).test(value))) return "Value does not match the required format";
  if (rule.type === "json") { try { JSON.parse(value); } catch { return "Value must be valid JSON"; } }
  if (rule.minimum !== undefined && +value < rule.minimum) return "Value is below the minimum";
  if (rule.maximum !== undefined && +value > rule.maximum) return "Value is above the maximum";
  return undefined;
}

export function safeConfigurationDisplay(definition: Pick<EnvironmentDefinition, "secret" | "browserDisplayPermitted">, state: "configured" | "missing" | "changed" | "pending_replacement", value?: string) {
  return { state, ...(definition.secret || !definition.browserDisplayPermitted ? {} : { value }) };
}

export function definitionsForPromotion(definitions: EnvironmentDefinition[], targetEnvironment: EnvironmentDefinition["applicableEnvironments"][number]) {
  return definitions.map((definition) => ({ ...definition, applicableEnvironments: [targetEnvironment], value: undefined, secretState: definition.secret ? "missing" as const : undefined }));
}

export function missingRequiredDefinitions(definitions: EnvironmentDefinition[], configuredNames: Iterable<string>, environment: EnvironmentDefinition["applicableEnvironments"][number]) {
  const configured = new Set(configuredNames);
  return definitions.filter((definition) => definition.required && definition.applicableEnvironments.includes(environment) && !configured.has(definition.name)).map((definition) => definition.name).sort();
}
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
  [/^PAYPAL_/, "PayPal"], [/^OPENAI_/, "OpenAI"], [/^ANTHROPIC_/, "Anthropic"], [/^GEMINI_/, "Google Gemini"], [/^OPENROUTER_/, "OpenRouter"],
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
