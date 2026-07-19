# Private staging deployment intake

Status: **BLOCKED — owner and infrastructure inputs unresolved**. This worksheet contains no secrets and is not deployment authorization.

| Input | Required value / decision | Status |
| --- | --- | --- |
| Private staging hostname | Exact HTTPS hostname | UNRESOLVED |
| Server IP or host identifier | Inventory ID; do not record credentials | UNRESOLVED |
| Cloud provider and region | Provider, account/project, region | UNRESOLVED |
| Operating system | Distribution, version, architecture | UNRESOLVED |
| SSH username | Dedicated deployment operator | UNRESOLVED |
| SSH port | Port number | UNRESOLVED |
| SSH key delivery | Approved vault/agent or ephemeral certificate; never Git/chat | UNRESOLVED |
| Sudo availability | Commands allowed and accountable operator | UNRESOLVED |
| Firewall | 22 from admin source; 80/443 through approved edge; block 3000/18080/27017 | UNRESOLVED |
| DNS management | Provider, zone owner, record/change identifier | UNRESOLVED |
| TLS method | Cloudflare Origin Certificate, ACME, or approved equivalent | UNRESOLVED |
| Outer access control | Cloudflare Access/MFA, VPN, HTTP auth, or strict IP allowlist | UNRESOLVED |
| Origin-bypass prevention | Firewall/tunnel/authenticated-origin method and verification | UNRESOLVED |
| Secrets delivery | Approved secret manager or host-only protected file transfer | UNRESOLVED |
| Deployment directory | Proposed `/opt/control-center`; confirm owner/mode | UNRESOLVED |
| Docker availability | Engine and Compose plugin versions | UNRESOLVED |
| Database | Dedicated `control_center_staging`; no production data or public port | UNRESOLVED |
| Backup location | Encrypted snapshot/dump location, retention, restore test | UNRESOLVED |
| Monitoring/log access | Metrics, alerts, value-safe logs, access owner | UNRESOLVED |
| Deployment window | Start/end in UTC and local timezone | UNRESOLVED |
| Deployment owner | Named accountable operator | UNRESOLVED |
| Rollback owner | Named operator with host and backup access | UNRESOLVED |
| Burn-in duration | Minimum 24 hours; owner-approved duration | UNRESOLVED |
| Success criteria | Approved thresholds from staging burn-in plan | UNRESOLVED |

## Mandatory evidence before deployment

- [ ] Historical credential rotation/revocation evidence is approved.
- [ ] Coordinated Git-history remediation decision is approved (execute now, defer with accepted risk, or another documented decision).
- [ ] Exact artifact tag, commit, manifest, checksum, and provenance attestation are verified.
- [ ] Private host and secure access path are tested by the deployment owner.
- [ ] Secrets-delivery channel is established without placing values in command history.
- [ ] Firewall, DNS, TLS, outer access, and origin-bypass controls are reviewed.
- [ ] Non-production backup is created and its restore procedure is rehearsed.
- [ ] Deployment and rollback owners approve the window.
- [ ] CI is green at the exact deploy commit and no high/critical audit finding remains.

## Value-safe execution record

Record only change IDs, artifact digests, timestamps, operator names, health statuses, backup identifiers, and sanitized defect references. Do not record cookies, tokens, authorization headers, environment-file contents, connection strings, signatures, private keys, or credential-bearing URLs.
