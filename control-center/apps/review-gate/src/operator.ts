import { MongoClient, type ClientSession, type Db } from "mongodb";
import { credentialIndex, generateCredential, hashCredential } from "./auth.js";
import { ensureIndexes } from "./mongoStore.js";
import { readConfig } from "./server.js";
import type { Principal } from "./store.js";

// The operator CLI: the only thing that creates a principal.
//
// PRINCIPALS ARE NOT CREATED BY REQUEST HANDLING. That is the point of gate-owned identity — if a route
// could provision, a caller could grant itself the reviewer class the candidate asked for. Provisioning
// is an out-of-band act by whoever administers the gate.
//
// I CREATE NO CREDENTIALS. This prints one, once, generated at the moment of provisioning by the person
// running it. Nothing is written to a file, echoed to a log, or stored anywhere but as a hash.

type ProvisionArgs = {
  principalId: string;
  displayName: string;
  roles: string[];
  reviewerClasses: string[];
  targetScopes: Array<{ orgId: string; serverId: string }>;
};

export type AuditEntry = {
  at: string;
  action: "provision" | "rotate" | "disable" | "enable";
  principalId: string;
  by: string;
  detail?: string;
};

async function audit(db: Db, entry: AuditEntry, session?: ClientSession): Promise<void> {
  await db.collection<AuditEntry>("principalAudit").insertOne(entry, { session });
}

/**
 * One transaction over the principal change and its audit entry.
 *
 * Rotation and disablement write the principal document conditioned on its current epoch, which is the
 * other half of the write-conflict domain the store relies on: a mutation in flight has also written
 * that document, so one of the two transactions aborts rather than both committing.
 *
 * An independent review found these were two separate writes, so a crash between them left a principal
 * changed with no record of who changed it -- which contradicts the design postcondition of "both, or
 * neither", and is exactly the gap that matters when someone is trying to work out what happened.
 */
async function inTransaction<T>(
  db: Db, work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const client = (db as unknown as { client: MongoClient }).client;
  const session = client.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Who ran the command. Recorded, not trusted: the audit says what the shell said. */
function operatorIdentity(): string {
  return process.env.REVIEW_GATE_OPERATOR
    ?? `${process.env.USERNAME ?? process.env.USER ?? "unknown"}@${process.env.COMPUTERNAME ?? "unknown"}`;
}

export async function provision(db: Db, args: ProvisionArgs): Promise<{ credential: string }> {
  const principals = db.collection<Principal & { _id?: unknown; credentialIndex: string }>("principals");
  if (await principals.findOne({ principalId: args.principalId })) {
    throw new Error(`principal ${args.principalId} already exists; use rotate or disable`);
  }
  const credential = generateCredential();
  const now = new Date().toISOString();
  await inTransaction(db, async (session) => {
    await principals.insertOne({
      principalId: args.principalId,
      displayName: args.displayName,
      credentialHash: hashCredential(credential),
      credentialIndex: credentialIndex(credential),
      roles: args.roles,
      reviewerClasses: args.reviewerClasses,
      ...(args.targetScopes.length ? { targetScopes: args.targetScopes } : {}),
      // Starts at 1 and only ever increases. A timestamp cannot serve here: two rotations inside one
      // clock tick are indistinguishable, and clock adjustment moves one backwards.
      credentialEpoch: 1,
      createdAt: now,
    } as never, { session });
    await audit(db, { at: now, action: "provision", principalId: args.principalId,
      by: operatorIdentity(), detail: `roles=${args.roles.join(",")}` }, session);
  });
  return { credential };
}

export async function rotate(db: Db, principalId: string): Promise<{ credential: string }> {
  const principals = db.collection<Principal & { credentialIndex: string }>("principals");
  const existing = await principals.findOne({ principalId });
  if (!existing) throw new Error(`no such principal: ${principalId}`);
  const credential = generateCredential();
  const now = new Date().toISOString();
  // The epoch increments IN THE SAME UPDATE as the new hash, so a request authenticated against the old
  // credential cannot commit against a lease stamped before the rotation.
  await inTransaction(db, async (session) => {
    const update = await principals.updateOne(
      { principalId, credentialEpoch: existing.credentialEpoch },
      {
        $set: {
          credentialHash: hashCredential(credential),
          credentialIndex: credentialIndex(credential),
          credentialRotatedAt: now,
        },
        $inc: { credentialEpoch: 1 },
      } as never,
      { session },
    );
    if (update.modifiedCount !== 1) throw new Error("the principal changed during rotation; try again");
    await audit(db, { at: now, action: "rotate", principalId, by: operatorIdentity() }, session);
  });
  return { credential };
}

export async function disable(db: Db, principalId: string): Promise<void> {
  const principals = db.collection<Principal>("principals");
  const now = new Date().toISOString();
  // Disabling also bumps the epoch: outstanding leases stamped with the old one stop matching, so work
  // in flight is invalidated rather than left to finish under a revoked identity.
  //
  // AND IT BUMPS THE INCARNATION, which is a different mechanism for a different reason. Under split
  // authority, acquire deliberately ignores the binder's credential epoch -- rotation must not invalidate
  // a completed binding -- so the epoch alone would no longer invalidate this binder's outstanding
  // bindings. The incarnation is the value bind records and acquire compares, and it increments ONLY
  // here. That is what makes disable-then-re-enable invalidate prior bindings while an ordinary rotation
  // leaves them alone.
  //
  // This mutates ONLY the canonical principal row and its audit record. There is deliberately no bulk
  // update over attestations: that would be an unbounded write, and incident identification is derived
  // instead by querying EXECUTING records by bindingPrincipalId.
  await inTransaction(db, async (session) => {
    // AN AGGREGATION PIPELINE, AND NOT `$inc`, AND THIS IS A DEFECT AN INDEPENDENT REVIEW FOUND.
    //
    // `$inc` treats a missing field as ZERO, so on a row written before `incarnation` existed it set the
    // field to 1. Bind reads that same absent field as ONE (`binder.incarnation ?? 1`) and records 1.
    // The two agreed exactly: disabling a legacy binder produced the very incarnation its outstanding
    // bindings had recorded, so the fence still matched and re-enabling the principal handed those
    // bindings straight back. Disablement did nothing for precisely the rows old enough to need it.
    //
    // `$ifNull` makes the base explicit and makes the two readings agree: absent means 1 here, exactly
    // as it means 1 at bind, so the first disable moves it to 2 and the fence stops matching.
    // `credentialEpoch` keeps `$inc`'s own base of 0 -- it is not read through a `?? 1` anywhere.
    const update = await principals.updateOne(
      { principalId },
      [{
        $set: {
          disabledAt: now,
          credentialEpoch: { $add: [{ $ifNull: ["$credentialEpoch", 0] }, 1] },
          incarnation: { $add: [{ $ifNull: ["$incarnation", 1] }, 1] },
        },
      }] as never,
      { session },
    );
    if (update.matchedCount !== 1) throw new Error(`no such principal: ${principalId}`);
    await audit(db, { at: now, action: "disable", principalId, by: operatorIdentity() }, session);
  });
}

/**
 * Re-enable a disabled principal. It does NOT restore the previous incarnation, and that is the point.
 *
 * A principal disabled after a bind and later re-enabled is *presently enabled*, so anything checking
 * only enabled/disabled status would accept exactly the bindings disablement was meant to invalidate.
 * The incarnation stays where disable left it, so those bindings remain refused at acquire while new
 * ones taken after re-enablement work normally.
 *
 * (The design asserted this operation already existed here. It did not -- only the audit action name did.
 * Implemented rather than quietly dropped, because A9 requires the enable path to be exercised.)
 */
export async function enable(db: Db, principalId: string): Promise<void> {
  const principals = db.collection<Principal>("principals");
  const now = new Date().toISOString();
  await inTransaction(db, async (session) => {
    const update = await principals.updateOne(
      { principalId },
      { $unset: { disabledAt: "" } } as never,
      { session },
    );
    if (update.matchedCount !== 1) throw new Error(`no such principal: ${principalId}`);
    await audit(db, { at: now, action: "enable", principalId, by: operatorIdentity() }, session);
  });
}

const USAGE = `
review-gate operator

  provision --id <principalId> --name <display name>
            [--role author|ci|reviewer|owner|executor]...
            [--reviewer-class <class>]...
            [--audience <orgId>:<serverId>]...
  rotate    --id <principalId>
  disable   --id <principalId>
  enable    --id <principalId>

Prints a credential ONCE on provision and rotate. It is not stored, logged, or recoverable:
if it is lost, rotate again.

Configuration comes from the same environment the service uses (REVIEW_GATE_MONGO_URL,
REVIEW_GATE_DB_NAME). The URL must name a replica set.
`.trim();

function parseArgs(argv: string[]): { command: string; flags: Map<string, string[]> } {
  const [command, ...rest] = argv;
  const flags = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${key} needs a value`);
    }
    flags.set(key, [...(flags.get(key) ?? []), value]);
    i += 1;
  }
  return { command: command ?? "", flags };
}

export async function main(argv: string[]): Promise<number> {
  let parsed: { command: string; flags: Map<string, string[]> };
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { command, flags } = parsed;
  if (!["provision", "rotate", "disable", "enable"].includes(command)) {
    console.error(USAGE);
    return 2;
  }
  const id = flags.get("id")?.[0];
  if (!id) {
    console.error(`--id is required\n\n${USAGE}`);
    return 2;
  }

  const config = readConfig(process.env);
  const client = new MongoClient(config.mongoUrl);
  await client.connect();
  try {
    const db = client.db(config.dbName);
    await ensureIndexes(db);
    if (command === "provision") {
      const targetScopes = (flags.get("audience") ?? []).map((entry) => {
        const [orgId, serverId] = entry.split(":");
        if (!orgId || !serverId) throw new Error(`--audience must be <orgId>:<serverId>, got ${entry}`);
        return { orgId, serverId };
      });
      const { credential } = await provision(db, {
        principalId: id,
        displayName: flags.get("name")?.[0] ?? id,
        roles: flags.get("role") ?? [],
        reviewerClasses: flags.get("reviewer-class") ?? [],
        targetScopes,
      });
      // The one and only time this value exists outside the caller's head.
      console.log(`principal ${id} provisioned.`);
      console.log(`credential (shown once, not stored): ${credential}`);
      return 0;
    }
    if (command === "rotate") {
      const { credential } = await rotate(db, id);
      console.log(`principal ${id} rotated; work in flight under the old credential is invalidated.`);
      console.log(`credential (shown once, not stored): ${credential}`);
      return 0;
    }
    if (command === "enable") {
      await enable(db, id);
      console.log(`principal ${id} enabled. Bindings taken before it was disabled stay refused: `
        + `re-enabling does not restore the previous incarnation.`);
      return 0;
    }
    await disable(db, id);
    console.log(`principal ${id} disabled; outstanding leases are invalidated, and bindings it made `
      + `can no longer be acquired.`);
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  } finally {
    await client.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith("operator.js")) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
