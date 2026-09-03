import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// The executor's durable claim on an action.
//
// WHY THIS EXISTS. The gate guarantees that exactly one caller ACQUIRES an attestation, and that is all
// it can guarantee: a database cannot fence a mutation on a host. An independent review of the design
// pointed out that the agent's existing replay protection is an in-memory nonce map, so a restart
// mid-apply loses it entirely — the gate would refuse a second acquisition, but nothing stopped THIS
// executor applying the same action twice across its own restart.
//
// So the claim is a file, taken BEFORE the effect, and it survives the process.
//
// WHAT IT CANNOT DO, said plainly because the surrounding design says it too: it does not make
// application atomic. A crash between the claim and the effect leaves a STARTED entry with no outcome,
// and that is deliberately not something this code resolves — it is exactly the case a human reconciles,
// and guessing would be worse than halting.

export type JournalOutcome = "STARTED" | "SUCCEEDED" | "FAILED";

export type JournalEntry = {
  actionDigest: string;
  attestationId: string;
  leaseId: string;
  serverId: string;
  attempt: number;
  outcome: JournalOutcome;
  startedAt: string;
  finishedAt?: string;
  /** The post-effect digest this attempt observed. Reconciliation compares a fresh reading to it. */
  postStateDigest?: string;
  terminalPhase?: string;
  error?: string;
};

export type ClaimResult =
  | { claimed: true; attempt: number }
  | { claimed: false; reason: "already_applied" | "in_flight_or_indeterminate"; entry: JournalEntry };

/**
 * A journal on disk, one file per action digest.
 *
 * One file per action rather than one shared log: a shared file has to be rewritten to record an
 * outcome, and a rewrite is the operation that loses entries when a machine stops abruptly.
 */
export class ExecutionJournal {
  readonly #dir: string;

  constructor(directory: string) {
    this.#dir = directory;
    fs.mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
  }

  #file(actionDigest: string): string {
    // The digest is already hex from the gate, but this is a filename, so it is validated rather than
    // trusted: a caller-shaped path is how a directory gets escaped.
    if (!/^[a-f0-9]{64}$/.test(actionDigest)) throw new Error("actionDigest must be a sha256 hex digest");
    return path.join(this.#dir, `${actionDigest}.json`);
  }

  read(actionDigest: string): JournalEntry | null {
    const file = this.#file(actionDigest);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as JournalEntry;
    } catch {
      // An unreadable entry is treated as present-but-unknown by the caller, never as absent. Absent
      // would mean "safe to apply", which is the one conclusion a corrupt file cannot support.
      return { actionDigest, attestationId: "", leaseId: "", serverId: "", attempt: 0,
        outcome: "STARTED", startedAt: "unknown", error: "journal entry unreadable" };
    }
  }

  /**
   * Take the claim, or refuse.
   *
   * `wx` is the whole mechanism: an exclusive create fails if the file exists, and the filesystem
   * decides, not a read followed by a write. Two processes racing here cannot both win.
   */
  claim(input: {
    actionDigest: string;
    attestationId: string;
    leaseId: string;
    serverId: string;
    at: string;
  }): ClaimResult {
    const file = this.#file(input.actionDigest);
    const entry: JournalEntry = {
      actionDigest: input.actionDigest,
      attestationId: input.attestationId,
      leaseId: input.leaseId,
      serverId: input.serverId,
      attempt: 1,
      outcome: "STARTED",
      startedAt: input.at,
    };
    try {
      fs.writeFileSync(file, JSON.stringify(entry, null, 2), { flag: "wx", mode: 0o600 });
      return { claimed: true, attempt: 1 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const existing = this.read(input.actionDigest)!;
    // SUCCEEDED and FAILED are both terminal for this executor: the action was attempted and its outcome
    // is on record. A retry needs a fresh attestation, which needs a fresh owner decision.
    if (existing.outcome === "SUCCEEDED" || existing.outcome === "FAILED") {
      return { claimed: false, reason: "already_applied", entry: existing };
    }
    // STARTED with no outcome. The previous attempt may have changed the host and died before saying so.
    // Refusing is the only safe answer; a human reconciles it.
    return { claimed: false, reason: "in_flight_or_indeterminate", entry: existing };
  }

  /** Record how it ended. Written before the executor reports anything to anyone else. */
  complete(input: {
    actionDigest: string;
    outcome: Exclude<JournalOutcome, "STARTED">;
    postStateDigest?: string;
    terminalPhase?: string;
    error?: string;
    at: string;
  }): JournalEntry {
    const existing = this.read(input.actionDigest);
    if (!existing) throw new Error("cannot complete an action that was never claimed");
    const entry: JournalEntry = {
      ...existing,
      outcome: input.outcome,
      finishedAt: input.at,
      ...(input.postStateDigest ? { postStateDigest: input.postStateDigest } : {}),
      ...(input.terminalPhase ? { terminalPhase: input.terminalPhase } : {}),
      ...(input.error ? { error: input.error.slice(0, 2000) } : {}),
    };
    // Written to a sibling and renamed, so a reader never sees a half-written entry. rename is atomic
    // within a directory on both platforms this runs on.
    const file = this.#file(input.actionDigest);
    const temporary = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(entry, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
    return entry;
  }

  /** Everything the journal holds. For an operator reconciling an INDETERMINATE attestation. */
  list(): JournalEntry[] {
    if (!fs.existsSync(this.#dir)) return [];
    return fs.readdirSync(this.#dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.read(path.basename(name, ".json")))
      .filter((entry): entry is JournalEntry => entry !== null);
  }
}
