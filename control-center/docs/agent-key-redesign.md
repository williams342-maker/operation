# Agent credential redesign — asymmetric protocol (agent-v2)

Status: **design + flagged primitives landed; integration/migration staged.** The new protocol is
implemented behind the **disabled-by-default** flag `CONTROL_CENTER_AGENT_PROTOCOL_V2`. No behavior
changes for existing (v1) agents until the flag is enabled, and never for production agents until an
explicit production go-ahead (see Stop conditions).

## 1. Threat model

### Assets
- Agent authentication credential (proves a request/enrollment came from a specific enrolled agent).
- Task-envelope integrity (agents must only execute tasks issued by the control plane).
- Owner-signed task authorization (privileged managed-server actions require an owner signature).
- Deployment-secret bundles (plaintext env values in transit to an agent).

### Trust boundaries
- The MongoDB datastore (backups, snapshots, replicas, logs, a NoSQL-injection read primitive).
- The control-plane process memory/host.
- The agent process memory/host.
- The network between control plane and agent (already TLS + signed + replay-protected).

### v1 (current) weaknesses this redesign closes
1. **Symmetric credential at rest = plaintext key (HIGH).** `server.agentSecretHash` is
   `sha256("agent-v1:"+agentSecret)` — the *same* value the agent uses as the HMAC key
   (`packages/shared/src/signing.ts:19`, `apps/api/src/agentAuth.ts:52`, `apps/agent/src/client.ts:21`).
   A read of the `servers` collection lets an attacker (a) forge fully-authenticated agent requests and
   (b) mint task envelopes → code execution on every managed host.
2. **Deployment-bundle key derived from a DB value (HIGH).** `encryptDeploymentValues(values,
   server.agentSecretHash)` (`apps/api/src/configurationDeployment.ts`) derives the AES key from the
   same DB-resident value, so a DB read also decrypts deployment secrets in queued tasks.
3. **Task envelope is agent-keyed symmetric HMAC (MEDIUM).** Proves "produced by a holder of the agent
   key," not "issued by the control plane."

### Adversary the redesign defeats
An adversary with **read** access to the control-plane database (the most common real breach — a leaked
backup) must gain **no** ability to impersonate an agent, forge a task, or decrypt a deployment secret.
Under agent-v2 the database holds only **public** keys and ciphertext; the private keys never leave the
agent hosts.

### Explicitly out of scope
- Compromise of an agent host itself (that host's own credential is inherently exposed — mitigated by
  rotation + revocation, not prevented).
- The offline owner signing key (unchanged; owner-signed task authorization is preserved as-is).

## 2. Protocol specification (agent-v2)

Versioned, negotiated per-server via the stored `keyProtocolVersion` (`"agent-v1"` | `"agent-v2"`).

### 2.1 Key material (separate keys, separate purposes — no reuse)
- **Signing keypair — Ed25519.** Agent-generated at enrollment. Used only to sign agent→control-plane
  requests and the enrollment proof-of-possession. The control plane stores **only** the public key.
- **Encryption keypair — X25519.** Agent-generated at enrollment. Used only to receive sealed
  deployment-secret bundles (ECIES: ephemeral X25519 + HKDF-SHA256 + AES-256-GCM). The control plane
  stores **only** the public key.
- **Control-plane signing keypair — Ed25519.** Held by the control plane; its public key is distributed
  to agents in the signed bootstrap bundle. Used to sign task envelopes so agents verify envelope
  integrity with a **public** key (removing the symmetric envelope key). Owner-signed task
  authorization is layered on top and **unchanged**.

Primitives are implemented in `packages/shared/src/agentKeys.ts` (Ed25519 + X25519 via `node:crypto`,
`agentKeyProtocolVersion = "agent-v2"`, algorithm pinned, no negotiation of algorithm by the caller).

### 2.2 Enrollment (v2)
1. Agent generates the Ed25519 and X25519 keypairs locally and persists the private keys at `0600`.
2. Agent POSTs: `enrollmentToken`, `hostname`, `signingPublicKey`, `encryptionPublicKey`, `issuedAt`,
   and a **proof-of-possession** = Ed25519 signature over
   `canonical(enrollmentToken || signingPublicKey || encryptionPublicKey || issuedAt)`.
3. Control plane verifies the enrollment token (single-use, unchanged) **and** the PoP against the
   presented signing public key, and that `issuedAt` is fresh. Enrollment fails closed on any mismatch.
4. Control plane stores `signingPublicKey`, `encryptionPublicKey`, `keyProtocolVersion="agent-v2"`,
   `credentialVersion`. **No secret is ever generated server-side or returned.**

### 2.3 Request authentication (v2)
Canonical request unchanged: `method\npath\ntimestamp\nnonce\nsha256(body)`, plus a bound
`protocolVersion` field. Signed with the agent's Ed25519 private key; headers add
`x-agent-key-version: agent-v2`. The server selects the verifier by the stored `keyProtocolVersion` and
verifies with the stored public key. Timestamp freshness (±5 min) and nonce replay protection are
unchanged (and the verify-before-nonce ordering fix already landed).

### 2.4 Task envelope (v2)
Envelope signed by the control-plane Ed25519 key; agent verifies with the control-plane public key from
its bootstrap bundle. `payloadDigest`, `taskId/orgId/serverId/agentId/expiresAt` binding, and the
**owner-signed authorization** are preserved. The task runner still cannot approve its own privileged
tasks.

### 2.5 Deployment secrets (v2)
Bundle sealed to the agent's X25519 public key (ECIES). Only the agent's private key decrypts. The DB
holds sealed ciphertext + the public key only. Replaces the `sha256("configuration-deployment:"+
agentSecretHash)` derivation.

### 2.6 Downgrade prevention
- `protocolVersion` is inside the signed canonical request, so it cannot be stripped/forced to v1.
- Once a server's `keyProtocolVersion` is `agent-v2`, the control plane **rejects** v1 (HMAC) requests
  for that server — no silent downgrade.
- A v2-enrolled agent refuses to emit v1 requests.
- After enforcement (Phase 3) v1 acceptance is disabled globally.

## 3. Dual-accept migration sequence

| Phase | Control plane | Agents | Reversible? |
|-------|---------------|--------|-------------|
| 0 — Ship | v2 code present, flag **off**. v1 only. | unchanged (v1) | n/a (no change) |
| 1 — Dual-accept | flag **on**. Accept v1 **and** v2 per-server `keyProtocolVersion`. New enrollments = v2. | v1 agents unchanged; new agents v2 | Yes: flag off ⇒ v1-only |
| 2 — Rotate | For each v1 agent: agent authenticates with its **current v1** credential and registers v2 public keys (+PoP). Server atomically flips that server `keyProtocolVersion` v1→v2 and re-seals pending deployment bundles to the new key. Per-agent, idempotent. | Agent generates + persists v2 keys, keeps v1 in **dual-hold** | Yes: revert that server to v1; v1 credential retained |
| 3 — Enforce | Once all servers report v2, disable v1 acceptance globally. | Drop v1 dual-hold | One-way (after verification) |

Interrupted migration is safe: rotation is a single atomic server-document update guarded by
`credentialVersion`; a crash before/after leaves the server on a valid, consistent version, and the
agent retries with dual-hold.

## 4. Secret re-encryption plan
- **At-rest configuration vault** (`configurationVault.ts`, master-key envelope) is **unaffected** —
  those secrets are server-side and independent of the agent key.
- **Deployment bundles** are created at approve-time with a 15-minute expiry, so the re-encryption
  surface is only *pending* bundles for a rotating server. On rotation the control plane re-seals any
  pending bundle to the new X25519 public key; expired/absent bundles need nothing. No plaintext is
  written to disk or logs during re-encryption (decrypt→reseal happens in memory, then zeroized).

## 5. Rollback procedure
- **Flag off** at any point ⇒ control plane reverts to v1-only acceptance.
- Rotated agents keep their v1 credential in **dual-hold** until Phase 3, so they immediately fall back
  to v1 signing when the flag is off.
- Public keys are stored **additively** (never overwrite/erase v1 fields until Phase 3), so rollback
  loses no data and re-enabling the flag resumes exactly where it left off.
- Rollback triggers: auth-failure spike, any agent unable to rotate, any deployment-secret decryption
  failure, or any data-integrity/rollback-gate failure.

## 6. Production rollout & stop conditions
**Staging first (disposable agents):** enroll v2, rotate legacy→v2, restart persistence, mixed
legacy/new fleet, interrupted-migration, and rollback drills must all pass before touching production.

**Production:** enable flag (dual-accept) → observe → rotate agents in small batches → verify every
server reports v2 + healthy → enforce (disable v1).

**Hard stop before / on:**
- Production-agent migration (rotation of any *production* agent) — requires explicit owner go-ahead.
- Invalidating any legacy credential or re-enrolling any production agent.
- Migrating production deployment secrets.
- Any CI/staging data-integrity or rollback-gate failure.
- Any spike in agent authentication failures or a deployment-secret decryption failure.

## 7. Test matrix (staging / disposable agents)
Registration, proof-of-possession (accept valid / reject forged), request sign+verify, algorithm
pinning, key rotation, revocation, downgrade prevention, audit-event ordering, failure/fail-closed,
rollback, enrollment, **restart persistence**, **mixed legacy/new fleet**, **interrupted migration**,
and **rollback** — each with disposable enrollments/keys and no production target.
