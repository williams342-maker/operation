# Staging deployment readiness checklist

This checklist gates the first controlled staging deployment. It does not authorize production deployment.

## Application readiness

- [ ] Record the exact `GIT_COMMIT`, `GIT_BRANCH`, and `BUILD_VERSION`.
- [ ] Use `NODE_ENV=production` and populate every required staging variable.
- [ ] Tests, type checking, lint, and all production builds pass.
- [ ] `/healthz` reports liveness and expected build identity.
- [ ] `/readyz` returns 200 with API, MongoDB, audit, rate-limit, and cache readiness.
- [ ] Owner, Administrator, and Viewer can read `/api/system/health`; anonymous requests cannot.
- [ ] An Owner can read `/api/system/diagnostics`; a Viewer cannot.
- [ ] Startup has no environment errors or unknown-variable warnings.

## Data and recovery

- [ ] MongoDB uses `control_center_staging`, has no public port, and is not production-like.
- [ ] Verify a pre-deployment snapshot or `mongodump` by listing its contents.
- [ ] Startup completes index initialization; CI confirms required indexes.
- [ ] Record restore location, retention, rollback commit, and responsible operators.

## Security and access

- [ ] Cloudflare Access and MFA protect the hostname; origin bypass is blocked.
- [ ] Verify TLS, secure cookies, HSTS, CSP, frame denial, no-sniff, and no-referrer policy.
- [ ] CORS allows only the exact staging origin.
- [ ] Use manual bootstrap only for first-owner creation, then switch to `disabled` or `invitation`.
- [ ] `.env`, credentials, logs, TAP, coverage, builds, and dependencies are absent from the commit.
- [ ] Failed authentication/authorization produces sanitized audit events.

## Agent and operations

- [ ] Generate a staging-only, one-use enrollment token with a short expiry.
- [ ] Verify enrollment, signed heartbeat, discovery, and online state against staging roots only.
- [ ] Health reports background workers as `not_configured` until workers exist.
- [ ] Global HTTP and AI rate limits initialize successfully.

## AI safety

- [ ] `AI_ASSISTANT_ENABLED=false` for first deployment.
- [ ] Every organization remains disabled; readiness makes no provider request.
- [ ] Provider credentials are absent until separately approved.
- [ ] `/readyz`, UI, and `/api/ai-assistant/status` all report disabled.
- [ ] Rehearse the emergency disable procedure.

## Final staging gate

- [ ] `npm run smoke:staging -- https://staging-host` passes on desktop and 390 px.
- [ ] GitHub Actions is green at the exact deploy SHA.
- [ ] No unexplained high/critical dependency vulnerability remains.
- [ ] Deployment and rollback owners approve the staging window.
