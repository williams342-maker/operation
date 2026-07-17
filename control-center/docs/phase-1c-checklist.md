# Phase 1C Acceptance Checklist

## Before deployment

- [ ] CI passes tests, DB-backed integration tests, typecheck, lint, and builds.
- [ ] Linux CI reports zero skipped tests, including the symlink escape test.
- [ ] Staging host is separate from Crafters Market production.
- [ ] DNS points to the staging host only.
- [ ] Cloudflare Access protects the entire hostname.
- [ ] Firewall blocks origin bypass and exposes only 80/443 publicly.
- [ ] `deploy/env/.env.staging` exists only on the host and contains generated secrets.
- [ ] MongoDB database name is non-production and not Crafters Market.

## After deployment

- [ ] HTTPS redirect works.
- [ ] Secure headers are present.
- [ ] Application login works after Cloudflare Access authentication.
- [ ] Direct origin API access is blocked externally.
- [ ] MongoDB is not reachable externally.
- [ ] API health checks pass through Nginx.
- [ ] Audit events include correlation IDs.
- [ ] Logs do not contain cookies, authorization headers, agent signatures, nonces, MongoDB URIs, or secrets.
