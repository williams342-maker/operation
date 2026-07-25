import { aiProviderIds, type AiProviderId } from "@control-center/shared";

type ProviderDefinition = {
  id: AiProviderId;
  label: string;
  transport: "openai-compatible" | "anthropic-messages" | "gemini-generate-content" | "deterministic";
  credentialVariable?: string;
  modelsVariable: string;
  baseUrlVariable?: string;
  defaultBaseUrl?: string;
};

export const aiProviderRegistry: ProviderDefinition[] = [
  { id: "openai", label: "OpenAI", transport: "openai-compatible", credentialVariable: "OPENAI_API_KEY", modelsVariable: "OPENAI_MODELS", baseUrlVariable: "OPENAI_BASE_URL", defaultBaseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", label: "Anthropic", transport: "anthropic-messages", credentialVariable: "ANTHROPIC_API_KEY", modelsVariable: "ANTHROPIC_MODELS", baseUrlVariable: "ANTHROPIC_BASE_URL", defaultBaseUrl: "https://api.anthropic.com/v1" },
  { id: "gemini", label: "Google Gemini", transport: "gemini-generate-content", credentialVariable: "GEMINI_API_KEY", modelsVariable: "GEMINI_MODELS", baseUrlVariable: "GEMINI_BASE_URL", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "openrouter", label: "OpenRouter", transport: "openai-compatible", credentialVariable: "OPENROUTER_API_KEY", modelsVariable: "OPENROUTER_MODELS", baseUrlVariable: "OPENROUTER_BASE_URL", defaultBaseUrl: "https://openrouter.ai/api/v1" },
  { id: "mock", label: "Deterministic mock", transport: "deterministic", modelsVariable: "MOCK_AI_MODELS" }
];

const list = (value = "") => [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
export const isAiProviderId = (value: string): value is AiProviderId => (aiProviderIds as readonly string[]).includes(value);
const definition = (provider: string) => aiProviderRegistry.find((item) => item.id === provider);

export function providerCredential(provider: string, env: NodeJS.ProcessEnv = process.env) {
  const item = definition(provider);
  if (provider === "mock") return "deterministic";
  return item?.credentialVariable ? env[item.credentialVariable] || env.AI_API_KEY : undefined;
}

export function providerBaseUrl(provider: string, env: NodeJS.ProcessEnv = process.env) {
  const item = definition(provider);
  const value = env.AI_BASE_URL || (item?.baseUrlVariable ? env[item.baseUrlVariable] : undefined) || item?.defaultBaseUrl;
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function providerModelRegistry(input: { env?: NodeJS.ProcessEnv; defaultProvider: string; defaultModel: string; allowedProviders: string[]; legacyAllowedModels: string[] }) {
  const env = input.env || process.env;
  const models: Record<string, string[]> = {};
  for (const provider of input.allowedProviders.filter(isAiProviderId)) {
    const item = definition(provider)!;
    const explicit = list(env[item.modelsVariable]);
    const legacy = provider === input.defaultProvider ? input.legacyAllowedModels : [];
    const defaults = provider === input.defaultProvider && input.defaultModel ? [input.defaultModel] : provider === "mock" ? ["deterministic-v1"] : [];
    models[provider] = explicit.length ? explicit : [...new Set([...legacy, ...defaults])];
  }
  return models;
}

export function providerHealth(input: { enabled: boolean; allowedProviders: string[]; modelsByProvider: Record<string, string[]> }, env: NodeJS.ProcessEnv = process.env) {
  return aiProviderRegistry.map((provider) => {
    const allowed = input.allowedProviders.includes(provider.id);
    const credentialPresent = Boolean(providerCredential(provider.id, env));
    const baseUrlValid = provider.id === "mock" || Boolean(providerBaseUrl(provider.id, env));
    const models = input.modelsByProvider[provider.id] || [];
    const state = !input.enabled ? "disabled" : !allowed ? "not_allowed" : !credentialPresent ? "missing_credential" : !baseUrlValid ? "invalid_endpoint" : !models.length ? "no_models" : "ready";
    return { id: provider.id, label: provider.label, transport: provider.transport, state, allowed, configured: credentialPresent && baseUrlValid && models.length > 0, credentialPresent, modelCount: models.length };
  });
}
