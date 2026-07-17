# Phase 1C Private Staging Deployment

This runbook prepares a private HTTPS staging deployment only. It does not install an agent on any production server, does not connect to the Crafters Market MongoDB database, and does not expose the control center without an outer access layer.

## Proposed topology

- DNS: `control.<selected-domain>` or `staging.<selected-domain>`.
- Cloudflare Access protects the entire hostname before traffic reaches the origin.
- Public host Nginx listens only on ports 80 and 443.
- Nginx terminates HTTPS and forwards to `127.0.0.1:18080`.
- Docker Compose exposes the edge container only on `127.0.0.1:18080`.
- API, web, and MongoDB run on a private Docker network.
- MongoDB has no public port mapping.
- API has no public port mapping.
- No server agent is exposed publicly.

## Required DigitalOcean resources

- One isolated staging Droplet, separate from the Crafters Market production host.
- Recommended minimum: 1 vCPU, 2 GB RAM, 50 GB disk for light staging; 2 vCPU, 4 GB RAM if multiple users will test concurrently.
- Ubuntu 24.04 LTS.
- DigitalOcean Cloud Firewall attached to the staging Droplet.
- Volume or automated snapshots if staging data should survive Droplet rebuilds.

Estimated monthly footprint: roughly USD $12-$30/month for a small Droplet plus backups/snapshots, excluding domain and Cloudflare paid features.

## DNS

Create a proxied Cloudflare DNS record:

- Type: `A`
- Name: `control` or `staging`
- Value: staging Droplet public IPv4
- Proxy status: proxied

Do not point this hostname at the Crafters Market production host.

## Cloudflare Access checklist

- Create an Access application for `https://control.<selected-domain>/*`.
- Restrict to approved email addresses, approved groups, or the selected identity provider.
- Require MFA where the identity provider supports it.
- Protect the entire hostname, not only `/api`.
- Keep application authentication enabled; Access is an outer gate, not a replacement.
- Block direct origin bypass with a DigitalOcean firewall that allows 80/443 only from Cloudflare IP ranges, or use authenticated origin pulls/tunnels.
- Confirm API routes work behind Access because browser API calls use the same protected origin `/api`.
- Do not whitelist `/api/agent/*` publicly in Phase 1C. No production agent is installed yet.

## Firewall checklist

Public inbound:

- TCP 80 from Cloudflare IP ranges only, or temporarily from your admin IP during certificate setup.
- TCP 443 from Cloudflare IP ranges only.
- TCP 22 from your admin IP only.

Blocked inbound:

- 3000 API port.
- 18080 Docker edge port.
- 27017 MongoDB.
- Any agent port.

Outbound:

- HTTPS for package/image pulls and certificate issuance.
- DNS and NTP.

## Secret generation

Run locally or on the staging host:

```powershell
./deploy/scripts/generate-secrets.ps1
```

`CONTROL_CENTER_ENCRYPTION_KEY` must be base64 and decode to exactly 32 bytes. Store generated values in `deploy/env/.env.staging` on the host only. Do not commit it.

## Environment file

Copy `deploy/.env.staging.example` to `deploy/env/.env.staging` on the staging host and fill every blank value.

Required production variables:

- `NODE_ENV=production`
- `MONGO_URL=mongodb://mongo:27017/control_center_staging`
- `CONTROL_CENTER_PUBLIC_URL=https://control.<selected-domain>`
- `CONTROL_CENTER_WEB_ORIGIN=https://control.<selected-domain>`
- `CONTROL_CENTER_TRUST_PROXY=loopback`
- `CONTROL_CENTER_SECURE_COOKIES=true`
- `CONTROL_CENTER_BOOTSTRAP_MODE=manual` or `invitation`
- `CONTROL_CENTER_SESSION_SECRET`
- `CONTROL_CENTER_CSRF_SECRET`
- `CONTROL_CENTER_ENCRYPTION_KEY`

The API refuses known Crafters Market production-like hosts and production-like database names.

## Manual deployment procedure

1. Create a separate staging Droplet.
2. Install Docker Engine, Docker Compose plugin, Nginx, and Certbot.
3. Clone the repository to `/opt/control-center`.
4. Copy `control-center/deploy/.env.staging.example` to `control-center/deploy/env/.env.staging` and fill secrets.
5. Copy `control-center/deploy/nginx/staging.conf` to `/etc/nginx/conf.d/control-center-staging.conf` and replace `control.example.com`.
6. Issue a certificate with Certbot or configure Cloudflare Origin Certificates.
7. Apply the firewall rules and confirm origin bypass is blocked.
8. From `control-center/deploy`, run:

```bash
docker compose -f docker-compose.staging.yml build
docker compose -f docker-compose.staging.yml up -d
```

9. Reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

10. Open the staging URL through Cloudflare Access and complete the manual bootstrap with non-default owner credentials.

## Post-deployment verification

- `https://control.<selected-domain>/healthz` returns 200 through Access.
- Direct `http://<origin-ip>:18080` fails externally.
- Direct `http://<origin-ip>:3000` fails externally.
- Direct `mongodb://<origin-ip>:27017` fails externally.
- Browser redirects HTTP to HTTPS.
- HSTS, CSP, Referrer-Policy, X-Frame-Options, and X-Content-Type-Options headers are present.
- Login sets an HTTP-only secure cookie.
- `/api/auth/login`, enrollment, and agent routes are rate-limited.
- Failed auth and authorization attempts create audit events with request IDs.
- No secrets appear in Nginx or application logs.
- The staging MongoDB database name is not a Crafters Market database.

## Rollback procedure

Phase 1C does not configure automatic deployment. Rollback is manual:

1. Keep the previous Git commit SHA before updating the staging host.
2. Stop the current containers:

```bash
docker compose -f deploy/docker-compose.staging.yml down
```

3. Checkout the previous SHA:

```bash
git checkout <previous-sha>
```

4. Rebuild and start:

```bash
cd control-center/deploy
docker compose -f docker-compose.staging.yml build
docker compose -f docker-compose.staging.yml up -d
```

5. Verify `/healthz`, login, and dashboard status.

Data rollback is separate. Take a MongoDB volume snapshot before risky staging changes if test data matters.

## Logging and redaction

Nginx logs omit Authorization, Cookie, agent signature, nonce, MongoDB URI, and request bodies. Application audit metadata redacts secrets and credentials. Do not enable debug request logging on staging.

## Phase 1C limits

- No automatic CI deployment.
- No production server agent install.
- No Crafters Market database connection.
- No Phase 2A CRUD management UI work.
- No deployment, restart, rollback, environment editing, log deletion, or service-control capability.
