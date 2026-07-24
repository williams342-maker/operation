# Staging security review

Review date: 2026-07-24. Scope: API, web UI, agent protocol, AI Assistant, Operational Intelligence, and staging configuration.

| Area | Finding | Status / recommendation |
| --- | --- | --- |
| Secrets | Runtime context, audits, AI evidence, agent results, and startup diagnostics redact values. `.env` is ignored. A credential-shaped value was found in tracked deployment memory and redacted in this milestone. | Blocker: rotate/revoke the credential and scrub it from Git history before staging. Keep secrets in host-only `deploy/env/.env.staging`. |
| Prompt injection | AI context is untrusted, sanitized, bounded, and deterministic evidence cannot be overridden by provider output. | Pass. Retain response validation. |
| Authorization | RBAC separates status, audit, AI use, and AI administration. Diagnostics requires `audit:view`. | Pass. Smoke-test Owner access and Viewer denial. |
| Organization isolation | Database queries and incident similarity use server-derived organization scope. | Pass; covered by isolation and disposable-Mongo tests. |
| Rate limiting | Global middleware is 180 requests/minute; AI has user, organization, monthly, and concurrency controls. | Pass. Monitor staging 429 rates. |
| Audit retention | Audit events are indexed and sanitized but have no TTL. | Accepted staging limitation. Define retention/export policy before production. |
| Environment | Startup reports missing, unknown, conflicting, deprecated, unsafe, and provider configuration without values. | Pass. Treat warnings as a staging gate. |
| HTTP | Helmet security headers, exact-origin credentialed CORS, 1 MB limits, and generic production 500s are configured. Health-check writes and ad-hoc HTTP tasks reject private/reserved DNS answers. API discovery and agent checks pin the validated address and revalidate every redirect destination. | Pass. Retain private-DNS, mixed-answer, metadata, rebinding, and redirect regression coverage. |
| Validation | Zod validates API inputs and AI structured responses. | Pass. |
| Logging | Audit metadata, task output, AI context, and startup output omit credentials. | Pass. Do not enable body/debug logging. |
| Credentials | Enrollment tokens are hashed/expiring; production session, CSRF, and encryption secrets are mandatory. | Pass. Rotate exposed credentials immediately. |
| AI transports | OpenAI, Anthropic, and mock paths are explicit; readiness never calls a provider. | Pass. Base URL overrides are trusted-operator configuration. |
| Dependencies | Full and production-only `npm audit` report zero vulnerabilities after upgrading Playwright to a patched release. | Pass. Re-run immediately before staging. |

## Security assumptions

- Only approved operators can access the staging host and secret file.
- An outer access layer protects the entire hostname.
- MongoDB, API port 3000, and edge port 18080 are not public.
- Staging contains no production customer data or credentials.
- Build commit/branch metadata is non-secret.

## Known limitations

- Background workers are not implemented and health reports this explicitly.
- Audit retention is policy-managed rather than TTL-enforced.
- Provider enablement is manual and separately approved.
- Browser smoke tests require Playwright Chromium on the smoke runner.
- Redacting the working tree does not remove the discovered credential from Git history; rotation/revocation and coordinated history cleanup remain mandatory.
