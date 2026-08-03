# Gitleaks finding triage

Prepared 2026-07-18 from the redacted Gitleaks 8.30.1 full-history report. No detected value, replacement map, or credential material is included.

## Affected ref set

Each introduction commit below is reachable from the same current ref set, abbreviated as **all refs** in the table:

- Local branches: `control-center-phase-1`, `phase-2a-management-ui`, `phase-2b-readonly-task-system`, `validation/discovery-hardening-linux`.
- Remote branches: `origin/main`, `origin/control-center-phase-1`, `origin/phase-2a-management-ui`, `origin/phase-2b-readonly-task-system`, `origin/validation/discovery-hardening-linux`.
- Tags: `v0.1.0-private-staging`, `v0.2.0-phase-2a-private-staging`, `v0.2.1-phase-2b-readonly-task-system`.

The current validation-branch snapshot redacts the confirmed Emergent finding, but the affected commit remains in its ancestry. A ref being listed does not mean every current tip still displays every finding; it means the introduction commit is reachable and therefore remains downloadable through that ref's history.

## Findings

| # | Path | Secret category | Introduction commit | Affected refs | Triage | Required owner action |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `memory/DEPLOY_ENV.md` | Emergent LLM API key | `4bd452d09043e3c0acdf4fcf5eef312654153be0` | All refs | Confirmed real credential-shaped deployment value | Emergent account owner must revoke or rotate it and provide value-free confirmation before cleanup approval. |
| 2 | `memory/DEPLOY_ENV.md` | Brevo API token | `4bd452d09043e3c0acdf4fcf5eef312654153be0` | All refs | Unresolved service-shaped deployment value | Brevo account owner must determine whether it was issued; revoke/rotate if real and report status without the value. |
| 3 | `memory/DEPLOY_ENV.md` | Buffer API key | `4bd452d09043e3c0acdf4fcf5eef312654153be0` | All refs | Unresolved service-shaped deployment value | Buffer account owner must verify issuance and revoke/rotate if real. |
| 4 | `memory/DEPLOY_ENV.md` | MailerSend API key | `4bd452d09043e3c0acdf4fcf5eef312654153be0` | All refs | Unresolved service-shaped deployment value | MailerSend account owner must verify issuance and revoke/rotate if real. |
| 5 | `memory/DEPLOY_ENV.md` | Mailtrap API key | `4bd452d09043e3c0acdf4fcf5eef312654153be0` | All refs | Unresolved service-shaped deployment value | Mailtrap account owner must verify issuance and revoke/rotate if real. |
| 6 | `memory/DEPLOY_ENV.md` | Postmark API key | `4bd452d09043e3c0acdf4fcf5eef312654153be0` | All refs | Unresolved service-shaped deployment value | Postmark account owner must verify issuance and revoke/rotate if real. |
| 7 | `memory/DEPLOY_ENV.md` | Cloudflare R2 secret access key | `4bd452d09043e3c0acdf4fcf5eef312654153be0` | All refs | Unresolved service-shaped deployment value | Cloudflare account owner must identify the access-key pair, revoke/rotate both parts if real, and review R2 access logs. |
| 8 | `memory/DEPLOY_ENV.md` | Resend API key | `4bd452d09043e3c0acdf4fcf5eef312654153be0` | All refs | Unresolved service-shaped deployment value | Resend account owner must verify issuance and revoke/rotate if real. |
| 9 | `memory/DEPLOY_ENV.md` | Sender API credential / JWT pattern | `4bd452d09043e3c0acdf4fcf5eef312654153be0` | All refs | Unresolved service-shaped deployment value | Sender account owner must verify issuance and revoke/rotate if real. |
| 10 | `memory/DEPLOY_ENV.md` | Stripe API access token | `4bd452d09043e3c0acdf4fcf5eef312654153be0` | All refs | Unresolved service-shaped deployment value | Stripe account owner must restrict or roll the key if real and review its event/request history. |
| 11 | `memory/DEPLOY_ENV.md` | Stripe webhook signing secret | `4bd452d09043e3c0acdf4fcf5eef312654153be0` | All refs | Unresolved service-shaped deployment value | Stripe account owner must roll the affected webhook secret if real and update only the authorized secret store. |
| 12 | `memory/DEPLOY_ENV.md` | Stripe Connect webhook signing secret | `4bd452d09043e3c0acdf4fcf5eef312654153be0` | All refs | Unresolved service-shaped deployment value | Stripe Connect owner must roll the affected webhook secret if real and update only the authorized secret store. |
| 13 | `scripts/bing_oauth_bootstrap.py` | Azure AD client secret | `3f446730ec5f33fcef92ca7de63b2e61628b5d3d` | All refs | Unresolved; credential-shaped value appears in an OAuth bootstrap script | Microsoft Entra application owner must verify whether it is an issued secret, revoke it if real, and replace code defaults with environment-only input. |
| 14 | `memory/CHANGELOG.md` | Generic API key pattern 1 | `2ed81b40c25cd6b3ca6b9b242db17cb919c64da8` | All refs | Unresolved historical documentation finding | Repository and service owners must identify the referenced service from private account records, then revoke/rotate if real or document fixture evidence. |
| 15 | `memory/CHANGELOG.md` | Generic API key pattern 2 | `2ed81b40c25cd6b3ca6b9b242db17cb919c64da8` | All refs | Unresolved historical documentation finding | Repository and service owners must identify the referenced service from private account records, then revoke/rotate if real or document fixture evidence. |
| 16 | `backend/tests/test_iter457_workshop_floor.py` | Administrative JWT pattern | `0bce89b59eb46402cdd2502f2405ff481acc6d98` | All refs | Likely synthetic/test-only based on path and identifier context; not yet verified | Test owner must prove it is generated/nonfunctional. Replace it with a scanner-safe generated fixture rather than allowlisting if feasible. |
| 17 | `test_reports/iteration_5.json` | Generic test credential pattern | `c357d0e867fe546681c6d741a9c94cfa87aaa243` | All refs | Likely synthetic/test-only based on test-report context; not yet verified | Test owner must trace the originating fixture, prove it is nonfunctional, and remove generated test reports from retained history/artifacts. |

## Value-free verification results

Verification date: 2026-07-18. Dashboard checks were read-only. No credential value was read, copied, supplied, compared, or tested, and no provider setting was changed.

| # | Verification result | Current status | Recommended remediation |
| --- | --- | --- | --- |
| 1 | No authenticated Emergent account surface or provider connector was available. | Revocation/rotation/expiry remains unverified. | Emergent account owner should confirm status from its credential inventory; if active or unverifiable, approve immediate rotation before history cleanup. |
| 2 | Brevo redirected to its sign-in page. | Unverified due to unavailable authenticated account access. | Brevo owner should inspect API-key status and last-use metadata, then revoke or rotate if active. |
| 3 | No authenticated Buffer connector or account surface was available. | Unverified. | Buffer owner should inspect the application/integration credential inventory and rotate any matching-era credential. |
| 4 | MailerSend redirected to its account login page. | Unverified due to unavailable authenticated account access. | MailerSend owner should inspect token status and rotate if active. |
| 5 | Mailtrap redirected to its sign-in page. | Unverified due to unavailable authenticated account access. | Mailtrap owner should inspect token status and rotate if active. |
| 6 | Postmark redirected to its account login page. | Unverified due to unavailable authenticated account access. | Postmark owner should inspect server/account token status and rotate if active. |
| 7 | A signed-in Cloudflare account was available. Its account-token inventory showed three active tokens with R2 object-write permission; one showed recent use and two showed no displayed use. This inventory does not expose enough value-free metadata to correlate the historical R2 secret-access-key finding to a specific active token or S3 access-key pair. | Historical credential remains unresolved; active R2-capable credentials exist. | Cloudflare owner should review R2 S3 access-key inventory and audit logs. Approve rotation of the affected key pair, or all unidentifiable R2 write credentials, before history cleanup. Do not infer safety from the absence of a value match. |
| 8 | Resend redirected to its login page. | Unverified due to unavailable authenticated account access. | Resend owner should inspect key status and rotate if active. |
| 9 | No authenticated Sender connector or account surface was available. | Unverified. | Sender owner should inspect API credential status and rotate if active. |
| 10 | Stripe redirected to its dashboard login page. | Unverified due to unavailable authenticated account access. | Stripe owner should inspect restricted/secret-key status and request history, then roll the affected key if active. |
| 11 | Stripe redirected to its dashboard login page. | Unverified due to unavailable authenticated account access. | Stripe owner should inspect the standard webhook endpoint's signing-secret rotation history and roll it if active. |
| 12 | Stripe redirected to its dashboard login page. | Unverified due to unavailable authenticated account access. | Stripe Connect owner should inspect the Connect webhook endpoint's signing-secret rotation history and roll it if active. |
| 13 | Microsoft Entra redirected to Microsoft Azure sign-in. | Unverified due to unavailable authenticated tenant access. | Entra application owner should inspect credential end date and status, revoke if active, and review sign-in/service-principal audit records. |
| 14 | The generic pattern cannot be attributed to a provider from value-free repository metadata. | Unresolved. | Repository owner must identify the service using private account records; otherwise treat it as real and include it in the replacement scope. |
| 15 | The generic pattern cannot be attributed to a provider from value-free repository metadata. | Unresolved. | Repository owner must identify the service using private account records; otherwise treat it as real and include it in the replacement scope. |
| 16 | Repository structure confirms a literal named administrative JWT is defined in a backend test, referenced twice, and used as test authorization input. No external validation of the literal was attempted. | Confirmed intended test-fixture usage; external nonfunctionality remains unverified. | Replace it with a runtime-generated, scanner-safe test token and remove the historical literal during the approved rewrite. No provider rotation is indicated unless the test owner cannot prove it was generated solely for tests. |
| 17 | Repository structure confirms a string-valued `test_credentials` field in a generated test-report path. No external validation of its value was attempted. | Confirmed test-report fixture context; external nonfunctionality remains unverified. | Trace it to the generating test, replace it with scanner-safe metadata, stop tracking generated test reports, and remove the historical report during the approved rewrite. |

### Verification conclusion

- No service credential could be confirmed revoked, rotated, expired, or disabled from the available authenticated metadata.
- Cloudflare confirms that active R2 write-capable credentials exist, but the historical finding cannot be correlated without prohibited credential comparison.
- Findings 16 and 17 are confirmed to be used as test artifacts; their nonfunctionality is not proven because testing detected values is prohibited.
- Service owners should rotate all active or unidentifiable service-shaped findings before a history rewrite. Rotation actions themselves remain unapproved.

## Cloudflare R2 rotation stop — 2026-07-18

The approved provider-by-provider remediation began with Cloudflare R2 and stopped at the required ambiguity gate before creating or revoking anything.

- Credential type: Cloudflare R2 write-capable account tokens plus the unresolved historical R2 S3 secret-access-key finding.
- Environment affected: repository evidence confirms the Crafters Market application uses R2, but available metadata does not safely map the separately named `Crafters Market` and `CraftersMarket2` tokens to production, staging, preview, or another environment. The `cortexviral-assets` name appears distinct but was not changed.
- Replacement status: not created. A least-privilege replacement cannot be assigned safely until the target bucket and environment secret store are identified.
- Validation performed: repository configuration/usage search; read-only Cloudflare token inventory review; comparison of token names, identical R2 object-write scope, creation/last-use metadata, and historical finding type without credential-value comparison.
- Revocation status: none revoked or disabled.
- Remaining risk: three active R2 write-capable account tokens remain; one showed recent use. The historical S3 access-key pair remains uncorrelated and may still be active. Two similarly named application tokens cannot be distinguished safely from current evidence.
- Files changed: this local triage report only; no application, environment, secret-store, provider, or deployment file changed.
- Commit/deployment requirement: no commit is needed for a secret value. The eventual replacement requires an authorized secret-store update for the identified environment and may require a controlled service restart or deployment. A rollback must retain the existing credential until an R2 upload/read smoke test succeeds.

Before resuming Cloudflare remediation, the owner must provide value-free mapping for each active token: environment, bucket, consuming service, secret-store location, deployment/restart method, and whether recent use is expected. If the historical key cannot be identified from account metadata, approve rotation of all unidentifiable R2 write credentials sequentially, one environment at a time.

## Stop point

Credential inventories were queried only where an existing authenticated session was available. No replacement specification was generated. No history, branch, tag, protected-branch setting, credential, or provider configuration was changed.

Separate explicit approval is required before either:

1. contacting or querying service/account systems to verify revocation or rotation; or
2. executing any history rewrite, force push, tag update/deletion, branch update/deletion, or protected-branch change.

## Cloudflare R2 mapping follow-up — 2026-07-18

Read-only review of the authenticated R2 inventory established the following value-free facts:

- Buckets present: `craftersmarket-assets` and `cortexviral-assets`.
- Account token `Crafters Market`: active, object read/write, restricted to `craftersmarket-assets`.
- Account token `CraftersMarket2`: active, object read/write, applied to all current and future buckets.
- Account token `cortexviral-assets`: active, object read/write, applied to all current and future buckets.
- A separate user-scoped token named `CraftersMarket` is also active with object read/write access to all current and future buckets. This credential is outside the three-account-token summary and must be included in the final inventory decision.
- The repository confirms production and preview R2 configuration patterns but does not identify the live secret-store location, consuming deployment, or restart procedure for any token.

The mapping safeguard remains unresolved. Token names alone are insufficient evidence that `CraftersMarket2` belongs to preview or that `cortexviral-assets` is used only by the similarly named bucket, because both account tokens can access every bucket. No token was created, edited, revoked, or deleted; no secret store, deployment, application configuration, or Git reference was changed.

## Cloudflare R2 value-free consumer mapping — 2026-07-18

### Shared application contract

The Crafters Market FastAPI backend has one R2 client configuration, sourced from `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, and `R2_PUBLIC_URL`. No secondary access-key variables, credential chain, or application-level fallback credential were found. `STORAGE_BACKEND=local` is a development-mode alternative to R2, not a second R2 credential.

The opt-in `backend/r2_storage.py::verify_storage_operations()` procedure creates a uniquely named `health/r2/` object, uploads it, creates a short-lived signed download URL, downloads and compares the payload, checks public URL construction, deletes the object, and retries cleanup in `finally`. For a controlled future rotation, validation must additionally issue an HTTP GET or HEAD against the configured public URL, confirm the application health endpoint, and review backend logs for R2 authentication or storage errors. This procedure was inspected only; it was not run during value-free mapping.

### Authoritative service-level mappings

#### Crafters Market production

- Consuming application: Crafters Market FastAPI backend.
- Environment and host: production on the DigitalOcean Droplet reachable through SSH alias `craftersmarket-server`; observed host name `ubuntu-s-2vcpu-4gb-120gb-intel-nyc3`.
- Runtime: Docker Compose project `craftersmarket`; container `craftersmarket-backend-1` is healthy and uses restart policy `unless-stopped`.
- Compose definition: `/root/Craftersmarket/docker-compose.yml`.
- Secret store: `/root/Craftersmarket/backend/.env`, loaded through the backend service `env_file`; only the six `R2_*` variable names above were inspected.
- Bucket actually configured: `craftersmarket-assets`.
- Public delivery: `https://cdn.craftersmarket.org`; Cloudflare reports the custom domain active and enabled. The bucket's `r2.dev` development URL is also enabled but is not the production URL. No CORS policy is defined.
- Restart after a future secret update: from `/root/Craftersmarket`, recreate the backend service so Compose reloads `env_file` (for example, `docker compose up -d --no-deps --force-recreate backend`), then wait for its health check. A plain container restart does not reliably reload changed environment files.
- Validation after a future update: run the opt-in isolated-object check inside the backend container, verify delivery through `cdn.craftersmarket.org`, confirm deletion, confirm the backend remains healthy, and inspect only sanitized backend logs.
- Fallback: none in application code or Compose.
- Credential identity: unverified. The production environment file timestamp and container creation predate the July 18 account tokens, so none of the four named credentials can be assigned to production from timing or naming alone. Production may still use an older S3 access-key pair that is outside the four-token inventory.

#### Crafters Market local development

- Consuming application: local Crafters Market FastAPI backend clone.
- Environment and platform: local Windows workspace at `C:/Users/willi/Documents/Codex/Craftersmarket`.
- Secret store: `C:/Users/willi/Documents/Codex/Craftersmarket/backend/.env`; it is ignored by `*.env` in the repository `.gitignore` and is not tracked. The same six `R2_*` names are present.
- Bucket actually configured: `craftersmarket-assets`.
- Public delivery: `https://cdn.craftersmarket.org`.
- Restart: restart the locally selected backend process or local container; no tracked local Compose or service definition establishes one authoritative local restart command.
- Validation after a future update: run the opt-in isolated-object check from the local backend environment, verify `cdn.craftersmarket.org`, confirm deletion, and review sanitized local backend logs.
- Fallback: none in application code; `STORAGE_BACKEND=local` is an alternate storage mode, not a credential fallback.
- Credential identity: likely, but not proven, to be the restricted account token `Crafters Market`. Its creation/first-use timing aligns with the local `.env` update and it is scoped to the locally configured bucket. Proving identity would require a prohibited credential-value comparison or provider audit metadata that names the caller.

#### Crafters Market preview or staging

- Repository documentation describes an Emergent-style preview secret file at `/app/backend/.env` and restart command `sudo supervisorctl restart backend`.
- The documented preview configuration uses the same R2 variable names and `craftersmarket-assets`, but no authenticated preview host or secret-store inventory was available during this review.
- This is a documented pattern, not a verified current deployment mapping. No named token can be assigned to preview or staging.

#### OpsWorkbench / Control Center CI and proposed staging

- The only tracked GitHub Actions workflow is `.github/workflows/control-center-ci.yml`; it does not reference R2 variables or Cloudflare storage credentials.
- Proposed Control Center staging uses `control-center/deploy/env/.env.staging` with Docker Compose, but its documented variables do not include R2.
- No evidence shows any of the four R2 credentials are consumed by OpsWorkbench, Control Center CI/CD, or proposed Control Center staging.

### Credential-by-credential mapping

| Credential | Evidence-backed consumer and environment | Secret store / restart | Bucket and delivery | Fallback / duplication assessment | Mapping status |
| --- | --- | --- | --- | --- | --- |
| Account token `Crafters Market` | Likely the local Crafters Market backend. It is restricted to `craftersmarket-assets`, was recently used, and its activity aligns with the local `.env` update. It cannot be assigned to production because production's loaded environment predates this token. | Likely `C:/Users/willi/Documents/Codex/Craftersmarket/backend/.env`; restart the active local backend process. Exact token-to-file identity is not proven. | `craftersmarket-assets`; `cdn.craftersmarket.org` is active. | No R2 fallback. It is the only one of the four with recorded use and least-privilege bucket scope; it does not presently look duplicated. | **Likely local; identity unverified.** |
| Account token `CraftersMarket2` | No repository, server, workflow, or provider-use evidence identifies a consumer. Cloudflare shows no recorded use. | No secret-store or restart mapping found. | Permission spans both current buckets and future buckets; no actual bucket use attributable to the token. | No configured fallback found. Broad scope plus no recorded use makes it likely unused or an abandoned duplicate. | **Unverified; likely unused.** |
| Account token `cortexviral-assets` | The CortexViral project and bucket are real, but Cloudflare shows no recorded token use. The token name alone does not establish that the CortexViral application uses it. | CortexViral DNS points to a separate DigitalOcean address, but the host is not enrolled in the local SSH known-hosts file and DigitalOcean dashboard access was unavailable. Secret-store and restart paths remain unknown. | `cortexviral-assets` contains approximately 2.76 MB under `assets/` and a user prefix. Public access, custom domains, the development URL, and CORS are disabled. | No fallback evidence. Because the bucket has operations but this token has no recorded use, another credential or dashboard uploads likely produced the objects. This token appears unused or mis-scoped. | **Project known; credential consumer unverified and likely unused.** |
| User token `CraftersMarket` | No repository, server, workflow, or Cloudflare-use evidence identifies a consumer. The user-token dashboard reports no last use. | No secret-store or restart mapping found. | Permission spans both current and future buckets; no actual bucket use attributable to the token. | No configured fallback found. It duplicates the purpose and broad scope of an account token while being tied to a user, so it is likely unused or redundant and is unsuitable for production service authentication. | **Unverified; likely unused/duplicated.** |

### Remaining value-free verification checklist

No credential rotation may begin until these checks close the unverified rows:

1. **Cloudflare account-token activity:** Open **Manage account → Account API tokens** and record, without revealing token values, each token's created, modified, last-used time, permission, and resource scope. In **Manage account → Audit logs**, filter around each creation and last-use timestamp and look for a caller/service or source network that can distinguish the local workstation, the Crafters Market Droplet, and the CortexViral Droplet.
2. **Cloudflare user token:** Open **My Profile → API Tokens** and record the `CraftersMarket` row's permissions, resources, last-used date, expiry, and status. Do not open or copy any secret value.
3. **Crafters Market production:** On the Droplet, inspect only `/root/Craftersmarket/docker-compose.yml`, the names of variables in `/root/Craftersmarket/backend/.env`, container creation/start timestamps, and sanitized logs. Do not print either access-key variable. The current evidence indicates the production credential is older than the four-token set; confirm its non-secret issue date or credential label in Cloudflare's S3-access-key inventory if the dashboard exposes one.
4. **Crafters Market preview/staging:** In the hosting platform, open the active project/environment's secret-variable inventory and record only whether the six `R2_*` names exist, the non-secret bucket/public URL, the service name, and the documented restart/redeploy action. Record the credential's provider-side label only if the platform exposes that label without exposing or comparing its value.
5. **CortexViral DigitalOcean host:** In DigitalOcean, open **Droplets**, select the Droplet serving `cortexviral.com`, and record its project, Droplet name, environment, image, tags, and deployment method. Verify its SSH host fingerprint through the DigitalOcean console before adding it locally. Then inspect only service definitions, Compose labels, `.env` file paths, R2 variable names, non-secret bucket/public URL, and restart policy. Do not print credential values. Suggested read-only commands after fingerprint verification: `hostname`, `docker ps --format '{{.Names}} {{.Image}}'`, `systemctl list-units --type=service --state=running`, `docker inspect` for Compose labels and restart policy, and `grep -l '^R2_'` over known application directories to locate candidate environment files.
6. **GitHub Actions:** In both repositories, open **Settings → Secrets and variables → Actions** and each **Environment**. Record names and update dates only. Confirm whether any `R2_*` secret names exist and whether a workflow/environment consumes them. The local GitHub CLI is unavailable, so this inventory could not be queried from the workstation.

No provider setting, credential, environment file, service, deployment, branch, commit, or Git history was changed during this mapping pass.

## Controlled rotation preflight — 2026-07-18

The owner authorized sequential credential rotation and controlled authentication testing. No credential value was displayed, copied, compared, logged, or committed.

### Local Crafters Market

- A non-mutating `HeadBucket` check using the configured local backend environment returned `401 Unauthorized`.
- The local `backend/.env` also produced dotenv parse warnings, so it is not a safe or authoritative source for a live credential rotation.
- No local file was edited and no local replacement was created.

### Production Crafters Market

- A non-mutating `HeadBucket` check from `craftersmarket-backend-1` returned `401 Unauthorized`.
- Sanitized backend logs independently show R2 `PutObject` operations returning `Unauthorized` for the scheduled design seeder.
- Public application checks: `/healthz` returned 200 and `/api/ci/health` returned 200. `/api/healthz` is not implemented and returned 404. The CDN root returned 404, which does not test an existing object.
- Current status: the application and database are healthy, but authenticated R2 operations are already unavailable. The currently loaded production credential is not a viable rollback credential.
- Required backup created without reading its contents: `/root/Craftersmarket/backend/.env.r2-rotation-20260718T182354Z.bak` with mode `600`, owner `root:root`, preserving the source metadata.
- No live environment variable, container, provider token, or deployment was changed.

### Rotation stop

The production consumer, bucket, secret-store path, service recreation command, and validation procedure are mapped. Rotation stopped before replacement creation because this automation surface cannot safely transfer a newly generated one-time Cloudflare access-key pair into the remote secret store without exposing, echoing, copying, or temporarily storing the values in tool output. The owner must use a secure interactive channel to install the replacement into `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in `/root/Craftersmarket/backend/.env`, or provide an approved secret-manager integration that supports write-only installation. The replacement must be an account token restricted to `craftersmarket-assets` with object read/write permission. Do not revoke any existing token yet.
