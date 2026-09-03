import { MongoClient, type Db } from "mongodb";
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
  audienceFor: Array<{ orgId: string; serverId: string }>;
};

export type AuditEntry = {
  at: string;
  action: "provision" | "rotate" | "disable" | "enable";
  principalId: string;
  by: string;
  detail?: string;
};

async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.collection<AuditEntry>("principalAudit").insertOne(entry);
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
  await principals.insertOne({
    principalId: args.principalId,
    displayName: args.displayName,
    credentialHash: hashCredential(credential),
    credentialIndex: credentialIndex(credential),
    roles: args.roles,
    reviewerClasses: args.reviewerClasses,
    ...(args.audienceFor.length ? { audienceFor: args.audienceFor } : {}),
    // Starts at 1 and only ever increases. A timestamp cannot serve here: two rotations inside one clock
    // tick are indistinguishable, and clock adjustment moves one backwards.
    credentialEpoch: 1,
    createdAt: now,
  } as never);
  await audit(db, { at: now, action: "provision", principalId: args.principalId,
    by: operatorIdentity(), detail: `roles=${args.roles.join(",")}` });
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
  );
  if (update.modifiedCount !== 1) throw new Error("the principal changed during rotation; try again");
  await audit(db, { at: now, action: "rotate", principalId, by: operatorIdentity() });
  return { credential };
}

export async function disable(db: Db, principalId: string): Promise<void> {
  const principals = db.collection<Principal>("principals");
  const now = new Date().toISOString();
  // Disabling also bumps the epoch: outstanding leases stamped with the old one stop matching, so work
  // in flight is invalidated rather than left to finish under a revoked identity.
  const update = await principals.updateOne(
    { principalId },
    { $set: { disabledAt: now }, $inc: { credentialEpoch: 1 } } as never,
  );
  if (update.matchedCount !== 1) throw new Error(`no such principal: ${principalId}`);
  await audit(db, { at: now, action: "disable", principalId, by: operatorIdentity() });
}

const USAGE = `
review-gate operator

  provision --id <principalId> --name <display name>
            [--role author|ci|reviewer|owner|executor]...
            [--reviewer-class <class>]...
            [--audience <orgId>:<serverId>]...
  rotate    --id <principalId>
  disable   --id <principalId>

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
  if (!["provision", "rotate", "disable"].includes(command)) {
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
      const audienceFor = (flags.get("audience") ?? []).map((entry) => {
        const [orgId, serverId] = entry.split(":");
        if (!orgId || !serverId) throw new Error(`--audience must be <orgId>:<serverId>, got ${entry}`);
        return { orgId, serverId };
      });
      const { credential } = await provision(db, {
        principalId: id,
        displayName: flags.get("name")?.[0] ?? id,
        roles: flags.get("role") ?? [],
        reviewerClasses: flags.get("reviewer-class") ?? [],
        audienceFor,
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
    await disable(db, id);
    console.log(`principal ${id} disabled; outstanding leases are invalidated.`);
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
