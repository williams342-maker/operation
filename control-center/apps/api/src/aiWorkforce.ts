export type WorkforceProviderId = "openai" | "anthropic" | "gemini" | "openrouter" | "mock";
export type WorkforceCapability = "operations_analysis" | "seo_analysis" | "website_planning" | "review";
export type WorkforceRole = { id: string; name: string; capability: WorkforceCapability; description: string; readOnly: true };
export type WorkforceModel = { id: string; provider: WorkforceProviderId; capabilities: WorkforceCapability[] };

export const providerRegistry: Record<WorkforceProviderId, { name: string; credentialVariable?: string; defaultBaseUrl?: string }> = {
  openai: { name: "OpenAI", credentialVariable: "OPENAI_API_KEY", defaultBaseUrl: "https://api.openai.com/v1" },
  anthropic: { name: "Anthropic", credentialVariable: "ANTHROPIC_API_KEY", defaultBaseUrl: "https://api.anthropic.com/v1" },
  gemini: { name: "Google Gemini", credentialVariable: "GEMINI_API_KEY", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  openrouter: { name: "OpenRouter", credentialVariable: "OPENROUTER_API_KEY", defaultBaseUrl: "https://openrouter.ai/api/v1" },
  mock: { name: "Deterministic Mock" },
};

export const workforceRoles: WorkforceRole[] = [
  { id: "operations-analyst", name: "Operations Analyst", capability: "operations_analysis", description: "Explains bounded operational evidence and recommends reversible next steps.", readOnly: true },
  { id: "seo-analyst", name: "SEO Analyst", capability: "seo_analysis", description: "Reviews stored crawl findings and drafts prioritized remediation guidance.", readOnly: true },
  { id: "website-planner", name: "Website Planner", capability: "website_planning", description: "Turns approved discovery answers into a structured draft brief.", readOnly: true },
  { id: "reviewer", name: "AI Reviewer", capability: "review", description: "Checks drafts for evidence, safety, completeness, and policy compliance.", readOnly: true },
];

const allCapabilities: WorkforceCapability[] = ["operations_analysis", "seo_analysis", "website_planning", "review"];
export function modelRegistry(allowedProviders: string[], allowedModels: string[], mapping = process.env.AI_WORKFORCE_MODEL_MAP || ""): WorkforceModel[] {
  const providers = allowedProviders.filter((provider): provider is WorkforceProviderId => provider in providerRegistry);
  const pairs = mapping.split(",").map((item) => item.trim()).filter(Boolean).map((item) => { const split = item.indexOf("="); return split > 0 ? { provider: item.slice(0, split).trim(), id: item.slice(split + 1).trim() } : null; }).filter((item): item is { provider: string; id: string } => Boolean(item?.provider && item.id));
  if (!pairs.length && providers.length === 1) return allowedModels.map((id) => ({ id, provider: providers[0], capabilities: allCapabilities }));
  return pairs.filter((pair): pair is { provider: WorkforceProviderId; id: string } => providers.includes(pair.provider as WorkforceProviderId) && allowedModels.includes(pair.id)).map((pair) => ({ ...pair, capabilities: allCapabilities })).filter((model, index, rows) => rows.findIndex((row) => row.id === model.id && row.provider === model.provider) === index);
}
export function providerCredential(provider: string, env: NodeJS.ProcessEnv = process.env) {
  if (provider === "mock") return "mock";
  const variable = providerRegistry[provider as WorkforceProviderId]?.credentialVariable;
  return variable ? env[variable] || env.AI_API_KEY : undefined;
}
export function providerBaseUrl(provider: string, env: NodeJS.ProcessEnv = process.env) {
  const prefix = provider.toUpperCase();
  return env.AI_BASE_URL || env[`${prefix}_BASE_URL`] || providerRegistry[provider as WorkforceProviderId]?.defaultBaseUrl;
}
export function workforceStatus(allowedProviders: string[], allowedModels: string[], env: NodeJS.ProcessEnv = process.env) {
  const models = modelRegistry(allowedProviders, allowedModels, env.AI_WORKFORCE_MODEL_MAP); const providers = allowedProviders.filter((id): id is WorkforceProviderId => id in providerRegistry).map((id) => { const credentialPresent = id === "mock" || Boolean(providerCredential(id, env)); const modelsMapped = models.some((model) => model.provider === id); return { id, name: providerRegistry[id].name, configured: credentialPresent && modelsMapped, credentialPresent, modelsMapped, health: !credentialPresent ? "missing_credential" : !modelsMapped ? "models_not_mapped" : "ready" }; });
  const assignments = workforceRoles.map((role) => ({ roleId: role.id, route: routeWorkforceRole(role.id, allowedProviders, allowedModels, env) }));
  return { providers, models, roles: workforceRoles, assignments };
}
export function routeWorkforceRole(roleId: string, allowedProviders: string[], allowedModels: string[], env: NodeJS.ProcessEnv = process.env) {
  const role = workforceRoles.find((item) => item.id === roleId); if (!role) return null;
  const configured = allowedProviders.filter((provider): provider is WorkforceProviderId => provider in providerRegistry && (provider === "mock" || Boolean(providerCredential(provider, env))));
  const model = modelRegistry(allowedProviders, allowedModels, env.AI_WORKFORCE_MODEL_MAP).find((item) => configured.includes(item.provider) && item.capabilities.includes(role.capability));
  return model ? { role, provider: model.provider, model: model.id } : null;
}
