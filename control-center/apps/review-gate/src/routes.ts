import { createHash } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { reviewActions, type ReviewAction } from "./actions.js";
import { authenticate, type AuthenticatedPrincipal } from "./auth.js";
import type { AttestationResult, AttestationService } from "./attestationService.js";
import type { ReviewGateService, ServiceResult } from "./service.js";
import type { ReviewGateStore } from "./store.js";

// The API surface: the only door.
//
// Nothing here accepts state, a participation ledger, an identity, or a reviewer class from a body. A
// request carries a credential in a header and an INTENT in the body, and the gate decides everything
// else from its own records.
//
// ADVISORY UNTIL AN EXECUTOR IS ACTIVATED. The enforcement point is now wired (candidate W1), but every
// executor is DISABLED and activation is an owner decision that has not been taken — so this service still
// records and enforces the review lifecycle for callers that use it, and prevents nothing for a caller
// that does not. The notice is required to stay in /healthz until an executor is actually enforcing; it is
// the honest description of what exists, and "wired" is not "enforcing".

export const ADVISORY_NOTICE =
  "ADVISORY: this gate records and enforces the review lifecycle for callers that use it. Until the " +
  "enforcement point is wired and activated it prevents nothing for a caller that does not.";

const idempotencyKeySchema = z.string().min(1).max(200);

/** Every mutating request carries one, so a retry is a no-op rather than a second transition. */
function idempotencyKey(req: Request): string | null {
  const header = req.header("Idempotency-Key");
  const parsed = idempotencyKeySchema.safeParse(header);
  return parsed.success ? parsed.data : null;
}

/**
 * HTTP status for a refusal.
 *
 * Deliberately coarse. A caller learns THAT it was refused and the machine-readable code; it does not get
 * a status that reveals whether a candidate exists, who reviewed it, or why someone else's action failed.
 */
function statusFor(code: string): number {
  if (code === "malformed_input") return 400;
  if (code === "unknown_candidate") return 404;
  if (code === "idempotent_replay") return 200;
  if (code === "idempotency_key_reused") return 409;
  if (["actor_not_authorized", "role_required", "reviewer_class_not_held", "author_actor_mismatch",
    "verdict_actor_mismatch", "verdict_actor_not_claimant", "reviewer_not_independent",
    "evidence_actor_is_author", "successor_actor_uninvolved"].includes(code)) return 403;
  if (["state_moved", "occurrence_replayed", "content_already_live", "content_already_rejected",
    "content_already_released", "candidate_exists", "predecessor_already_superseded"].includes(code)) {
    return 409;
  }
  return 422;
}

function send(res: Response, result: ServiceResult): void {
  if (result.ok) {
    res.status(200).json({ ok: true, state: result.state });
    return;
  }
  res.status(statusFor(result.code)).json({ ok: false, code: result.code, message: result.message });
}

function sendAttestation(res: Response, result: AttestationResult): void {
  if (result.ok) {
    res.status(200).json({ ok: true, ...(result.value as object ?? {}) });
    return;
  }
  res.status(statusFor(result.code)).json({ ok: false, code: result.code, message: result.message });
}

export type RouteDependencies = {
  store: ReviewGateStore;
  service: ReviewGateService;
  attestations: AttestationService;
};

export function buildRouter(deps: RouteDependencies): Router {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));

  // Liveness only. No data, no authentication, and it says what this service currently is.
  router.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true, advisory: ADVISORY_NOTICE });
  });

  /** Resolve the caller, or refuse. Every route below this point has an authenticated principal. */
  const withPrincipal = async (
    req: Request, res: Response, handler: (principal: AuthenticatedPrincipal) => Promise<void>,
  ): Promise<void> => {
    const outcome = await authenticate(deps.store, req.header("authorization"));
    if (!outcome.ok) {
      res.status(401).json({ ok: false, code: outcome.code });
      return;
    }
    await handler(outcome.principal);
  };

  const requireIdempotency = (req: Request, res: Response): string | null => {
    const key = idempotencyKey(req);
    if (!key) {
      res.status(400).json({ ok: false, code: "idempotency_key_required",
        message: "every mutating request must carry an Idempotency-Key header" });
      return null;
    }
    return key;
  };

  router.post("/candidates", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const key = requireIdempotency(req, res);
      if (!key) return;
      const body = z.object({
        candidateId: z.string().min(1).max(200),
        binding: z.unknown(),
      }).safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ ok: false, code: "malformed_input" });
        return;
      }
      send(res, await deps.service.createCandidate(principal, {
        candidateId: body.data.candidateId,
        binding: body.data.binding as never,
        idempotencyKey: key,
      }));
    });
  });

  router.post("/candidates/:id/successors", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const key = requireIdempotency(req, res);
      if (!key) return;
      const body = z.object({
        candidateId: z.string().min(1).max(200),
        binding: z.unknown(),
        remediates: z.array(z.string().min(1).max(200)).max(500).optional(),
      }).safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ ok: false, code: "malformed_input" });
        return;
      }
      send(res, await deps.service.createSuccessor(principal, {
        candidateId: body.data.candidateId,
        supersedes: req.params.id,
        binding: body.data.binding as never,
        remediates: body.data.remediates,
        idempotencyKey: key,
      }));
    });
  });

  router.post("/candidates/:id/evidence", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const key = requireIdempotency(req, res);
      if (!key) return;
      send(res, await deps.service.recordTestExecution(principal, {
        ...(req.body ?? {}),
        candidateId: req.params.id,
        idempotencyKey: key,
      }));
    });
  });

  // NAMED ACTIONS, not a generic transition. The action is in the PATH, and it must be one this gate
  // knows: a caller cannot invent a move, and cannot describe a destination.
  router.post("/candidates/:id/actions/:action", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const key = requireIdempotency(req, res);
      if (!key) return;
      const action = req.params.action as ReviewAction;
      if (!(reviewActions as readonly string[]).includes(action)) {
        res.status(404).json({ ok: false, code: "unknown_action" });
        return;
      }
      send(res, await deps.service.performAction(principal, {
        candidateId: req.params.id,
        idempotencyKey: key,
        billingClass: (req.body ?? {}).billingClass,
        action,
      }));
    });
  });

  router.post("/candidates/:id/verdicts", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const key = requireIdempotency(req, res);
      if (!key) return;
      send(res, await deps.service.submitVerdict(principal, {
        candidateId: req.params.id,
        idempotencyKey: key,
        billingClass: (req.body ?? {}).billingClass,
        verdict: (req.body ?? {}).verdict,
      }));
    });
  });

  /**
   * A read-only projection.
   *
   * Deliberately NOT the stored record: occurrence ids, credential epochs and the raw participation
   * ledger are the gate's bookkeeping. A caller gets what it needs to act, not everything the gate knows.
   */
  router.get("/candidates/:id", async (req, res) => {
    await withPrincipal(req, res, async () => {
      const record = await deps.store.loadCandidate(req.params.id);
      if (!record) {
        res.status(404).json({ ok: false, code: "unknown_candidate" });
        return;
      }
      res.status(200).json({
        ok: true,
        candidateId: record.candidateId,
        state: record.state,
        digest: record.digest,
        contentDigest: record.contentDigest,
        supersedes: record.supersedes,
        supersededAt: record.supersededAt,
        claimedBy: record.claimedByPrincipalId,
        participants: record.participants.map((p) => ({ identity: p.identity, role: p.role })),
        outstandingFindings: (record.inherited ?? []).map((f) => ({
          occurrenceId: f.occurrenceId, label: f.label, severity: f.severity,
        })),
      });
    });
  });

  // ── attestations: layer 3 ─────────────────────────────────────────────────────────────────────

  router.post("/candidates/:id/owner-decision", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const key = requireIdempotency(req, res);
      if (!key) return;
      const body = z.object({
        attestations: z.array(z.object({
          kind: z.string().min(1).max(80),
          orgId: z.string().min(1).max(200),
          serverId: z.string().min(1).max(200),
          audiencePrincipalId: z.string().min(1).max(200),
          // Required on the wire, not defaulted server-side: the split must be an explicit owner
          // decision at mint, and a request that omits it is refused rather than repaired.
          bindingPrincipalId: z.string().min(1).max(200),
          supersedesAttestationId: z.string().min(1).max(200).optional(),
          expiresAt: z.string().datetime(),
        })).min(1).max(50),
      }).safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ ok: false, code: "malformed_input" });
        return;
      }
      sendAttestation(res, await deps.attestations.recordOwnerDecision(principal, {
        candidateId: req.params.id,
        idempotencyKey: key,
        attestations: body.data.attestations as never,
      }));
    });
  });

  router.post("/attestations/:id/reserve", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const body = z.object({ leaseSeconds: z.number().int().positive().max(3600) })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ ok: false, code: "malformed_input" });
        return;
      }
      sendAttestation(res, await deps.attestations.reserve(principal, {
        attestationId: req.params.id, leaseSeconds: body.data.leaseSeconds,
      }));
    });
  });

  router.post("/attestations/:id/bind", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const body = z.object({ leaseId: z.string().min(1).max(200), payload: z.unknown() })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ ok: false, code: "malformed_input" });
        return;
      }
      sendAttestation(res, await deps.attestations.bind(principal, {
        attestationId: req.params.id, leaseId: body.data.leaseId, payload: body.data.payload,
      }));
    });
  });

  // ACQUIRE IS A MUTATION, NOT A QUERY, and that is the whole point: an executor that merely ASKS
  // whether it may act, and then acts, is a check/use race. Exactly one caller leaves this route
  // having taken execution, and it happens before any host is touched.
  router.post("/attestations/:id/acquire", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const body = z.object({
        leaseId: z.string().min(1).max(200),
        actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
        orgId: z.string().min(1).max(200),
        serverId: z.string().min(1).max(200),
        kind: z.string().min(1).max(80),
      }).safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ ok: false, code: "malformed_input" });
        return;
      }
      // REQUIRED, and high-entropy. The key is what makes a committed retry return `already_acquired`
      // instead of a second attempt, so acquire cannot proceed without one.
      const key = idempotencyKey(req);
      if (!key) {
        res.status(400).json({ ok: false, code: "malformed_input",
          message: "acquire requires an Idempotency-Key header" });
        return;
      }
      const outcome = await deps.attestations.acquire(principal, {
        attestationId: req.params.id, ...body.data, kind: body.data.kind as never,
        idempotencyKey: key,
        // Bound to the whole request, not merely to the principal identity that every process of this
        // executor shares. A repeat with a different request is an error, not a replay.
        requestHash: createHash("sha256").update(JSON.stringify({
          attestationId: req.params.id, ...body.data,
        })).digest("hex"),
      });
      // THE ONE RESPONSE THAT CARRIES A TOKEN. `no-store` so no intermediary or client cache retains it;
      // set before the body is written, and on the refusal path too, so a 4xx cannot be cached either.
      res.setHeader("Cache-Control", "no-store");
      sendAttestation(res, outcome);
    });
  });

  // Extension is NOT the pre-acquire lease renewal below. That preserves the binder's allocation; this
  // asserts the acquired attempt is still running, and it refuses after an audience rotation because the
  // recorded acquiring epoch no longer matches.
  router.post("/attestations/:id/extend-execution", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const body = z.object({
        attemptToken: z.string().min(1).max(500),
        requestedDeadline: z.string().min(1).max(64),
      }).safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ ok: false, code: "malformed_input" });
        return;
      }
      // No `no-store` needed: extension never returns token material, only the new deadline.
      sendAttestation(res, await deps.attestations.extendExecution(principal, {
        attestationId: req.params.id, ...body.data,
      }));
    });
  });

  router.post("/attestations/:id/redeem", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const body = z.object({
        leaseId: z.string().min(1).max(200),
        attemptToken: z.string().min(1).max(500),
      }).safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ ok: false, code: "malformed_input" });
        return;
      }
      sendAttestation(res, await deps.attestations.redeem(principal, {
        attestationId: req.params.id, leaseId: body.data.leaseId,
        attemptToken: body.data.attemptToken,
      }));
    });
  });

  router.post("/attestations/:id/renew", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const body = z.object({
        leaseId: z.string().min(1).max(200),
        leaseSeconds: z.number().int().positive().max(3600),
      }).safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ ok: false, code: "malformed_input" });
        return;
      }
      sendAttestation(res, await deps.attestations.renew(principal, {
        attestationId: req.params.id, leaseId: body.data.leaseId,
        leaseSeconds: body.data.leaseSeconds,
      }));
    });
  });

  // A further target, or a further protected action, for work whose review is already complete.
  router.post("/candidates/:id/attestations", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const key = requireIdempotency(req, res);
      if (!key) return;
      const body = z.object({
        attestations: z.array(z.object({
          kind: z.string().min(1).max(80),
          orgId: z.string().min(1).max(200),
          serverId: z.string().min(1).max(200),
          audiencePrincipalId: z.string().min(1).max(200),
          // Required on the wire, not defaulted server-side: the split must be an explicit owner
          // decision at mint, and a request that omits it is refused rather than repaired.
          bindingPrincipalId: z.string().min(1).max(200),
          supersedesAttestationId: z.string().min(1).max(200).optional(),
          expiresAt: z.string().datetime(),
        })).min(1).max(50),
      }).safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ ok: false, code: "malformed_input" });
        return;
      }
      sendAttestation(res, await deps.attestations.mintFurther(principal, {
        candidateId: req.params.id,
        idempotencyKey: key,
        attestations: body.data.attestations as never,
      }));
    });
  });

  router.post("/attestations/:id/revoke", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      const body = z.object({ reason: z.string().min(1).max(2000) }).safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ ok: false, code: "malformed_input" });
        return;
      }
      sendAttestation(res, await deps.attestations.revoke(principal, {
        attestationId: req.params.id, reason: body.data.reason,
      }));
    });
  });

  router.post("/attestations/:id/resolve-indeterminate", async (req, res) => {
    await withPrincipal(req, res, async (principal) => {
      sendAttestation(res, await deps.attestations.resolveIndeterminate(principal, {
        attestationId: req.params.id,
        reconciliation: (req.body ?? {}).reconciliation,
      }));
    });
  });

  return router;
}
