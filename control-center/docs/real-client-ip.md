# Real client IP and rate-limit qualification

Boundary: Cloudflare -> host nginx -> edge **or admin** nginx -> API. Host nginx
accepts CF-Connecting-IP only from explicit published Cloudflare ranges, overwrites
X-Forwarded-For/X-Real-IP/CF-Connecting-IP and removes Forwarded. Internal proxies
append their socket peer to that clean chain. Health/readiness use the same policy.

API trust names individual proxy IPs (/32 or /128). Existing `loopback` remains
valid for local development. Boolean trust, numeric hop counts and subnet trust
fail startup. This intentionally tightens compatibility: migrate existing subnet
settings to exact reserved identities. Untrusted socket peers cannot override their
IP through headers. Trusted peers with missing/malformed XFF receive 400 before
rate limiting. The legacy loopback-only setting permits local checks without XFF.

Both limiters use express-rate-limit v8 ipKeyGenerator after ipaddr.js converts
IPv4-mapped IPv6 into IPv4. IPv6 clients share a /56 bucket to resist interface
address rotation. Budgets remain auth20/15min and global180/min; the existing
development/test authentication-limiter exemption is unchanged.

## Measured staging evidence, September 28, 2026

Host **198.199.70.250** (`StagingHostOpsworkbench-small`) runs v0.1.19-operate /
4e81f5427d90396528df22500f6d2cd9bc8d7848, Compose project `deploy`, database
`control_center_staging`. Network172.18.0.0/16 has gateway172.18.0.1, edge172.18.0.5,
admin172.18.0.6, API172.18.0.2 and Mongo172.18.0.4. Edge18080/admin18081 publish
only on loopback. Addresses were dynamic when inspected.

Reserve edge/admin addresses with `deploy/docker-compose.real-ip.yml`, applied
LAST after the candidate overlay defining admin. Populate `.env.proxy.example`
as a host-only Compose interpolation file, use `--env-file <file> -p deploy`, and
check collisions. Existing network IPAM must match; network recreation requires a
planned staging outage and database-preserving rollback. Verify pinned identities
after recreation; do not automatically expand trust when addresses change.
Only after verification, staging API trust is `172.18.0.5,172.18.0.6,172.18.0.1`.
Production requires its own measurement; these are not production defaults.

## Host setup and ingress

1. Use dedicated staging DNS/TLS/private outer access. Existing `automatex.work`
   DNS serves a different site; do not repoint it. Staging currently permits only
   SSH through UFW, so external-chain qualification remains incomplete.
2. Generate an include with `node deploy/scripts/cloudflare-real-ip.mjs <new-path>`.
   Both address families are validated; malformed, overly broad, duplicate and
   incomplete input is rejected. The script refuses overwrite and never reloads
   nginx. Review differences against the September28 checked-in snapshot.
3. Install the reviewed include as `/etc/nginx/cloudflare-real-ip.conf` on staging.
   Apply real_ip and sanitation directives from `deploy/nginx/staging.conf` to
   **every public and admin host vhost** (admin upstream18081). Keep host443
   firewall access restricted to current Cloudflare ranges. Never use universal trust.
4. Disable Cloudflare PseudoIPv4 Overwrite Headers, preserving actual IPv6. Review
   Workers/Transform Rules affecting client identity. The anchor assumes Cloudflare
   authoritatively supplies CF-Connecting-IP. Back up host config/environment safely.
5. Run nginx -t and activate host sanitation, reserved proxy addresses and API trust
   together. Production changes require separate owner approval.

## Required runtime proof

Measure a known external client through the actual staging hostname, recording
only source IP, nginx realip_remote_addr/remote_addr, edge/API peers, XFF and req.ip.
Never record cookies/credentials. Expected API XFF is `client, 172.18.0.1`, socket
edge `.5` or admin `.6`: this is a **prediction from measured addresses and config**,
not completed external verification. Existing edge logs show local gateway `.1`
with no incoming XFF, proving only the local/tunnel path.

Test two real external sources: independent nginx/API buckets, same-client
exhaustion/reset, IPv4/IPv6, spoofed XFF/CF/XReal, direct-origin rejection, public
and admin login, and agent polling. Internal ports must remain unpublished.
Remove temporary diagnostic instrumentation after measurement.

## Local qualification

```sh
node --import tsx --test apps/api/test/clientIdentity.test.ts
node --test deploy/scripts/cloudflare-real-ip.test.mjs
node deploy/scripts/test-real-ip-mutations.mjs
NGINX_BINARY=/path/to/nginx node deploy/scripts/test-real-ip-nginx.mjs
```

The real nginx harness runs an isolated loopback instance and tests header rewrites,
per-client limits and two negative mutations. It does not replace Cloudflare tests.
Rollback restores prior API image/environment, host nginx and pinned networking
together. Preserve Mongo volumes. Run nginx -t before reload, then health/auth smoke.
Known-good application: v0.1.19-operate/4e81f542 (original rate-limit defect returns).

Sources: [Cloudflare IP guidance](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/),
[IPv4](https://www.cloudflare.com/ips-v4), [IPv6](https://www.cloudflare.com/ips-v6),
[rate-limit helper](https://express-rate-limit.mintlify.app/reference/helpers).
