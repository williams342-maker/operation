# Multi-provider AI Workforce

OpsWorkbench implements the AI Workforce as a provider-neutral, read-only
analysis layer. Its initial autonomy level is Guided Automation: the system may
research bounded operational evidence, plan, draft, review, and revise, but it
cannot execute infrastructure changes, publish content, activate advertising,
increase budgets, rotate credentials, or approve production releases.

## Provider registry

The fixed provider registry supports:

| Provider | Transport | Credential variable | Model registry |
| --- | --- | --- | --- |
| OpenAI | OpenAI-compatible chat completions | `OPENAI_API_KEY` | `OPENAI_MODELS` |
| Anthropic | Anthropic Messages | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODELS` |
| Google Gemini | Generate Content | `GEMINI_API_KEY` | `GEMINI_MODELS` |
| OpenRouter | OpenAI-compatible chat completions | `OPENROUTER_API_KEY` | `OPENROUTER_MODELS` |
| Deterministic mock | Local deterministic response | none | `MOCK_AI_MODELS` |

Credentials stay in the server environment. They are never returned by an API,
sent to browser code, written to audit metadata, or placed in provider request
URLs. Provider endpoint overrides must be credential-free HTTPS URLs without
query strings or fragments.

`AI_ALLOWED_PROVIDERS` controls which registered providers may be selected.
Models are bound to a provider through its provider-specific model variable.
The legacy `AI_ALLOWED_MODELS` list remains a compatibility input for the
default provider only. A model registered to one provider cannot be routed to
another provider.

## Role registry

The role registry is fixed in code and every role is read-only:

- Operations analyst: current health and low-risk diagnostics.
- Incident reviewer: chronology, correlation, and alternative causes.
- Release readiness reviewer: validation and rollback evidence; never
  authorizes or publishes.
- Security reviewer: security signals and manual verification; never requests,
  reveals, rotates, or uses credentials.

Each role is scope-bounded and contributes a fixed system instruction. Page
content, logs, questions, and collected evidence cannot define new roles or
replace role instructions.

## Routing and health

Routing requires all of the following:

1. the global beta feature flag is enabled;
2. the organization has enabled the assistant and acknowledged retention/cost;
3. the provider is registered and allowlisted;
4. the model is registered for that same provider;
5. the provider credential and credential-free HTTPS endpoint are configured;
6. scope, RBAC, quota, token, and concurrency checks pass.

Provider readiness is passive. It reports configured/not-configured state,
model count, allowlist state, and endpoint validity without making a provider
request or consuming API credit. A real analysis request is the only operation
that contacts a provider.

## Security and cost boundaries

Context is organization-scoped, sanitized, redacted, size-bounded, and labeled
as untrusted. Provider-shaped API keys, authorization headers, credentials,
cookies, connection strings, private keys, high-entropy values, and sensitive
object fields are redacted before transport. Provider responses must match the
strict no-action schema and `executedActions` must remain empty.

Per-user, per-organization, monthly-request, monthly-token, and concurrency
limits are enforced before transport. Provider prompts/responses and secrets
are not retained in OpsWorkbench audit records. Audits store only bounded
provider/model/role identifiers, context categories, timing, redaction counts,
outcome, and a question digest.
