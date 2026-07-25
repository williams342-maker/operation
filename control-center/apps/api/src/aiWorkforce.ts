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
export function modelRegistry(allowedProviders: string[], allowedModels: string[]): WorkforceModel[] {
  return allowedModels.flatMap((id) => allowedProviders.filter((provider): provider is WorkforceProviderId => provider in providerRegistry).map((provider) => ({ id, provider, capabilities: allCapabilities }))).filter((model, index, rows) => rows.findIndex((row) => row.id === model.id && row.provider === model.provider) === index);
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
  const providers = allowedProviders.filter((id): id is WorkforceProviderId => id in providerRegistry).map((id) => ({ id, name: providerRegistry[id].name, configured: id === "mock" || Boolean(providerCredential(id, env)) }));
  return { providers, models: modelRegistry(allowedProviders, allowedModels), roles: workforceRoles };
}
export function routeWorkforceRole(roleId: string, allowedProviders: string[], allowedModels: string[], env: NodeJS.ProcessEnv = process.env) {
  const role = workforceRoles.find((item) => item.id === roleId); if (!role) return null;
  const configured = workforceStatus(allowedProviders, allowedModels, env).providers.filter((item) => item.configured).map((item) => item.id);
  const model = modelRegistry(allowedProviders, allowedModels).find((item) => configured.includes(item.provider) && item.capabilities.includes(role.capability));
  return model ? { role, provider: model.provider, model: model.id } : null;
}
