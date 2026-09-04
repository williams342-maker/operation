import type { GateConfig } from "./reviewEnforcement.js";

// The executor's client for layer 3.
//
// TWO THINGS ABOUT THIS FILE ARE THE POINT, and both come from the design rather than from convenience.
//
// It authenticates with THE EXECUTOR'S OWN CREDENTIAL. Not the control-center's, and not anything the
// control-center handed it in a task. An instruction is not authorization: if the thing that asks for a
// deployment could also supply the proof that it was reviewed, the review would be decorative.
//
// ACQUIRE IS A POST, and the gate MUTATES state to answer it. An executor that merely asks "may I?" and
// then acts has a check/use race by construction — two deliveries both get yes, both mutate the host,
// and the bookkeeping notices afterwards. Exactly one caller leaves acquire having taken execution.

export type GateOutcome =
  | { ok: true }
  | { ok: false; code: string; detail?: string };

/**
 * Acquire returns the ATTEMPT TOKEN, once. It is the executor's proof that it is the winning attempt,
 * and it is required to extend or redeem.
 *
 * It is deliberately not part of `GateOutcome`: every other operation returns that type, and a token
 * field on the shared type is how a secret ends up in a log line that prints "the outcome". Keep it in
 * memory for the life of the attempt and never write it to the journal, a report, or an error.
 *
 * SINGLE DELIVERY: losing this response loses the attempt. The gate stores only a verifier and cannot
 * reissue it; a retry returns `already_acquired` with no token, and the attempt must be reconciled.
 */
export type AcquireOutcome =
  | { ok: true; attemptToken: string; executionDeadline: string }
  | { ok: false; code: string; detail?: string };

/**
 * FAIL CLOSED, everywhere, with no exceptions.
 *
 * Unreachable, slow, wrong status, unparseable body, unexpected shape: all refuse. There is no cache, no
 * grace period and no last-known-good, because every one of those is a way for a deployment to proceed
 * on the strength of a review nobody checked. If the gate is down, deployment stops — that is the
 * intended trade and it is the owner's to overrule explicitly, not mine to soften here.
 */
export class ReviewGateClient {
  readonly #gate: GateConfig;
  readonly #fetch: typeof fetch;

  constructor(gate: GateConfig, fetchImpl: typeof fetch = fetch) {
    this.#gate = gate;
    this.#fetch = fetchImpl;
  }

  async #post(endpoint: string, body: unknown, headers: Record<string, string> = {},
  ): Promise<GateOutcome & { body?: Record<string, unknown> }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#gate.timeoutMs);
    try {
      const response = await this.#fetch(`${this.#gate.url.replace(/\/+$/, "")}${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // The executor's own credential. Never one the control-center supplied.
          authorization: `Bearer ${this.#gate.credential}`,
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        return { ok: false, code: "gate_unreadable", detail: `status ${response.status}` };
      }
      const payload = parsed as { ok?: unknown; code?: unknown; message?: unknown };
      if (response.status === 200 && payload.ok === true) {
        return { ok: true, body: parsed as Record<string, unknown> };
      }
      // Anything else is a refusal, including a 200 whose body does not say ok. A response we cannot
      // interpret is not permission.
      return {
        ok: false,
        code: typeof payload.code === "string" ? payload.code : `gate_status_${response.status}`,
        detail: typeof payload.message === "string" ? payload.message : undefined,
      };
    } catch (error) {
      const aborted = (error as Error)?.name === "AbortError";
      return {
        ok: false,
        code: aborted ? "gate_timeout" : "gate_unreachable",
        detail: (error as Error)?.message?.slice(0, 300),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Take execution. A MUTATION on the gate, performed before the host is touched.
   *
   * The digest, target and kind are sent so the gate can refuse a payload that does not match what was
   * reviewed. The executor computes that digest from the bytes it is about to apply — which is why the
   * residual trust list says the gate is trusting the executor about bytes, and about nothing else.
   */
  async acquire(input: {
    attestationId: string;
    leaseId: string;
    actionDigest: string;
    orgId: string;
    serverId: string;
    kind: string;
    /** High-entropy and per-attempt. A committed retry with the same key returns `already_acquired`. */
    idempotencyKey: string;
  }): Promise<AcquireOutcome> {
    const outcome = await this.#post(
      `/attestations/${encodeURIComponent(input.attestationId)}/acquire`,
      {
        leaseId: input.leaseId,
        actionDigest: input.actionDigest,
        orgId: input.orgId,
        serverId: input.serverId,
        kind: input.kind,
      },
      { "idempotency-key": input.idempotencyKey },
    );
    if (!outcome.ok) return outcome;
    const token = outcome.body?.attemptToken;
    const deadline = outcome.body?.executionDeadline;
    // A 200 that does not carry a token is not a successful acquire. Failing closed here rather than
    // proceeding tokenless keeps the effect gated on something the gate actually issued.
    if (typeof token !== "string" || !token || typeof deadline !== "string") {
      return { ok: false, code: "gate_unreadable", detail: "acquire returned no attempt token" };
    }
    return { ok: true, attemptToken: token, executionDeadline: deadline };
  }

  /** Extend a live attempt. Refused after a credential rotation, by design; redeem is not. */
  async extendExecution(input: {
    attestationId: string;
    attemptToken: string;
    requestedDeadline: string;
  }): Promise<GateOutcome> {
    const outcome = await this.#post(
      `/attestations/${encodeURIComponent(input.attestationId)}/extend-execution`,
      { attemptToken: input.attemptToken, requestedDeadline: input.requestedDeadline },
    );
    return outcome.ok ? { ok: true } : outcome;
  }

  /** Close it out. A failure to redeem does not un-apply anything; it leaves the record for a human. */
  async redeem(input: {
    attestationId: string; leaseId: string; attemptToken: string;
  }): Promise<GateOutcome> {
    const outcome = await this.#post(
      `/attestations/${encodeURIComponent(input.attestationId)}/redeem`,
      { leaseId: input.leaseId, attemptToken: input.attemptToken },
    );
    return outcome.ok ? { ok: true } : outcome;
  }
}
