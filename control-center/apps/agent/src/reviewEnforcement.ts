import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// Whether THIS executor enforces layer 3, held durably.
//
// WHY IT IS NOT JUST A CONFIG FLAG. The design's rollout is "inert until configured", which is the same
// additive discipline the owner-authorization layer used — a new check must not be able to break the path
// it is being added to. An independent review pointed out the obvious corollary: if enforcement is
// nothing but the presence of a setting, then LOSING that setting silently turns enforcement off, and
// configuration loss becomes a bypass.
//
// So activation is a durable, audited fact. Once an executor is ENFORCING, starting it without working
// gate configuration is a startup FAILURE, not a quiet downgrade to advisory.

export const enforcementStates = ["DISABLED", "ENFORCING"] as const;
export type EnforcementState = (typeof enforcementStates)[number];

export const enforcementRecordSchema = z.object({
  state: z.enum(enforcementStates),
  /** Who activated, and when. Append-only history; the newest entry is current. */
  history: z.array(z.object({
    state: z.enum(enforcementStates),
    at: z.string().datetime(),
    by: z.string().min(1).max(200),
    reason: z.string().min(1).max(2000),
  })).min(1),
}).strict().superRefine((record, context) => {
  // THE TWO MUST AGREE. An independent review found that `state` and `history` were validated
  // separately while only `state` was ever read — so a record saying `state: "DISABLED"` with a newest
  // history entry of `ENFORCING` passed the schema and resolved advisory. That is a *semantically*
  // corrupt record slipping through a check that only ever caught *syntactically* corrupt ones, which is
  // the difference between "a corrupted record throws" as a description and as a mechanism.
  const newest = record.history[record.history.length - 1];
  if (newest.state !== record.state) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["state"],
      message: `state "${record.state}" contradicts the newest history entry "${newest.state}"`,
    });
  }
});
export type EnforcementRecord = z.infer<typeof enforcementRecordSchema>;

/**
 * Loopback, where "no TLS" means "no network", not "plaintext on the wire".
 *
 * Kept narrow on purpose: a hostname that merely *resolves* to loopback does not qualify, because
 * resolution is exactly what an attacker on the path controls.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const gateConfigSchema = z.object({
  /**
   * The gate's base URL. Private network; this is not a public service — but "private network" is a
   * deployment intention, not a property of the connection.
   *
   * TLS IS REQUIRED. An independent review pointed out that any syntactically valid URL counted as usable
   * configuration, including `http://`: the executor would send its bearer credential in plaintext, and
   * would accept `200 {"ok":true}` from whoever answered. The client fails closed on transport errors and
   * on negative bodies, and that is worth nothing if it cannot tell who produced the positive one.
   *
   * This is the minimal fix, and it is NOT full authentication of the gate: TLS with the host's default
   * trust store stops a plaintext spoof and credential capture, but a certificate from any trusted CA for
   * that name still satisfies it. Pinning the gate's certificate or key is the real answer and belongs in
   * the activation design, where the per-executor credential is issued.
   */
  url: z.string().url().refine((value) => {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || (parsed.protocol === "http:" && LOOPBACK.has(parsed.hostname));
  }, "the review gate URL must be https (http is allowed only for loopback)"),
  /** The executor's OWN credential, distinct from its transport keys. */
  credential: z.string().min(1),
  /** Milliseconds. A gate that does not answer promptly is a gate that is unreachable. */
  timeoutMs: z.number().int().min(100).max(30_000).default(5_000),
}).strict();
export type GateConfig = z.infer<typeof gateConfigSchema>;

const STATE_FILE = "review-enforcement.json";

export function enforcementPath(stateDir: string): string {
  return path.join(stateDir, STATE_FILE);
}

/**
 * Read the durable state.
 *
 * A MISSING FILE MEANS DISABLED, and that is the residual weakness in this design rather than a
 * decision I am comfortable with. An executor that has never been activated and one whose state file was
 * deleted look identical from here. Defending that needs the state to live somewhere the executor cannot
 * be talked out of — a signed bootstrap, or the gate itself refusing to answer an executor it believes
 * is enforcing. It is recorded in the design's residual-trust list rather than papered over.
 */
export function readEnforcement(stateDir: string): EnforcementRecord {
  const file = enforcementPath(stateDir);
  if (!fs.existsSync(file)) {
    return { state: "DISABLED", history: [{
      state: "DISABLED", at: new Date(0).toISOString(), by: "default",
      reason: "no enforcement record; an executor is advisory until activated",
    }] };
  }
  const parsed = enforcementRecordSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) {
    // An unreadable record is NOT treated as DISABLED. That would make corrupting one file a bypass, and
    // this whole layer exists because a boundary that can be talked out of existence is not one.
    throw new Error(
      `the review-enforcement record at ${file} is unreadable; refusing to start rather than ` +
      "assume this executor is not enforcing",
    );
  }
  return parsed.data;
}

/** Activate or deactivate, appending to the history. Deactivation is deliberately as loud as activation. */
export function writeEnforcement(stateDir: string, input: {
  state: EnforcementState;
  by: string;
  reason: string;
  at?: string;
}): EnforcementRecord {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const current = readEnforcement(stateDir);
  const record: EnforcementRecord = {
    state: input.state,
    history: [...current.history, {
      state: input.state,
      at: input.at ?? new Date().toISOString(),
      by: input.by,
      reason: input.reason,
    }],
  };
  fs.writeFileSync(enforcementPath(stateDir), JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

export type EnforcementDecision =
  | { enforcing: true; gate: GateConfig }
  | { enforcing: false };

/**
 * What this executor should do at startup, given its durable state and its configuration.
 *
 * THROWS rather than returning a decision when the two disagree. An ENFORCING executor with no usable
 * gate configuration must not run: running it would be exactly the silent downgrade this file exists to
 * prevent, and it would run looking healthy.
 */
export function resolveEnforcement(input: {
  stateDir: string;
  gate?: unknown;
}): EnforcementDecision {
  const record = readEnforcement(input.stateDir);
  if (record.state === "DISABLED") return { enforcing: false };
  const parsed = gateConfigSchema.safeParse(input.gate);
  if (!parsed.success) {
    throw new Error(
      "this executor is ENFORCING but has no usable review-gate configuration, so it refuses to start. " +
      "Losing the configuration must not silently make it advisory. " +
      `(${parsed.error.issues.map((i) => i.path.join(".") || "gate").join(", ")})`,
    );
  }
  return { enforcing: true, gate: parsed.data };
}
