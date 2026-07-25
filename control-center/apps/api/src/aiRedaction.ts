const patterns: Array<[string, RegExp]> = [
  ["private_key", /-----BEGIN[\s\S]{0,80}PRIVATE KEY-----[\s\S]*?-----END[\s\S]{0,80}PRIVATE KEY-----/gi],
  ["authorization", /\b(authorization\s*[:=]\s*|bearer\s+)[^\s,;"']+/gi],
  ["provider_api_key", /\b(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-or-v1-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,})\b/g],
  ["enrollment_token", /\bowenr_[A-Za-z0-9_-]{16,}\b/g],
  ["database_url", /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s"']+/gi],
  ["credential_url", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s"']+/gi],
  ["sensitive_query", /([?&](?:token|key|secret|signature|password|auth|code)=)[^&#\s]+/gi],
  ["cookie", /\b(?:cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi],
  ["secret_assignment", /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|WEBHOOK)[A-Z0-9_]*\s*=\s*[^\s]+/gi],
  ["high_entropy", /\b[A-Za-z0-9_+/=-]{40,}\b/g]
];
export type RedactionResult = { value: string; counts: Record<string, number> };
export function redactText(input: string, maxLength = 1000): RedactionResult { let value = input.slice(0, maxLength); const counts: Record<string, number> = {}; for (const [category, pattern] of patterns) value = value.replace(pattern, (_match) => { counts[category] = (counts[category] || 0) + 1; return `[redacted:${category}]`; }); return { value, counts }; }
export function sanitizeForAi(value: unknown, limits = { maxDepth: 6, maxArray: 30, maxString: 1000 }): { value: unknown; counts: Record<string, number> } { const counts: Record<string, number> = {}; const merge = (part: Record<string, number>) => Object.entries(part).forEach(([k, v]) => counts[k] = (counts[k] || 0) + v); const walk = (item: unknown, depth: number): unknown => { if (depth > limits.maxDepth) return "[truncated:depth]"; if (typeof item === "string") { const result = redactText(item, limits.maxString); merge(result.counts); return result.value; } if (Array.isArray(item)) return item.slice(0, limits.maxArray).map((child) => walk(child, depth + 1)); if (item && typeof item === "object") { const safe: Record<string, unknown> = {}; for (const [key, child] of Object.entries(item as Record<string, unknown>).slice(0, 80)) { if (/(secret|token|password|authorization|cookie|credential|connection|string|environment|env|raw|prompt)/i.test(key)) { counts.sensitive_key = (counts.sensitive_key || 0) + 1; safe[key] = "[redacted:sensitive_key]"; } else safe[key] = walk(child, depth + 1); } return safe; } return item; }; return { value: walk(value, 0), counts }; }
