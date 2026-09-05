import express from "express";
import helmet from "helmet";
import { MongoClient } from "mongodb";
import { ADVISORY_NOTICE, buildRouter } from "./routes.js";
import { AttestationService } from "./attestationService.js";
import { ReviewGateService } from "./service.js";
import { MongoReviewGateStore, ensureIndexes } from "./mongoStore.js";
import type { ReviewGateStore } from "./store.js";

// The process entry point, and THE ONLY PLACE A STORE IS CONSTRUCTED.
//
// That sentence is the whole architecture. For ten review rounds the store was injectable, so whoever
// held the service could substitute one, wrap one, or drive one directly. Here it is created at process
// start from configuration, never accepted from a caller, and never handed back — the service keeps it in
// a runtime-private field.

export type ServerConfig = {
  port: number;
  bind: string;
  mongoUrl: string;
  dbName: string;
  /** Absent = the service default. See `buildApp`. */
  initialExecutionMs?: number;
};

export function readConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const mongoUrl = env.REVIEW_GATE_MONGO_URL;
  const dbName = env.REVIEW_GATE_DB_NAME;
  if (!mongoUrl) throw new Error("REVIEW_GATE_MONGO_URL is required");
  if (!dbName) throw new Error("REVIEW_GATE_DB_NAME is required");
  // The gate commits multi-document transactions. A standalone server cannot satisfy the invariants in
  // the design, so refusing to start is better than discovering it on the first concurrent verdict.
  if (!/replicaSet=/.test(mongoUrl)) {
    throw new Error(
      "REVIEW_GATE_MONGO_URL must name a replica set: the gate commits multi-document transactions " +
      "and a standalone server cannot satisfy its invariants",
    );
  }
  // The initial execution window. Absent means the service's own default; present means an operator
  // chose one, and `AttestationService` refuses a value that would collapse the extension path. Parsed
  // here rather than read deep in the service so a typo fails at start, not at the first acquire.
  const rawInitial = env.REVIEW_GATE_INITIAL_EXECUTION_MS;
  let initialExecutionMs: number | undefined;
  if (rawInitial !== undefined && rawInitial !== "") {
    initialExecutionMs = Number(rawInitial);
    if (!Number.isFinite(initialExecutionMs)) {
      throw new Error("REVIEW_GATE_INITIAL_EXECUTION_MS must be a number of milliseconds");
    }
  }
  return {
    port: Number(env.REVIEW_GATE_PORT ?? 3100),
    // Loopback by default. This is not a public service, and a default of 0.0.0.0 would be a decision
    // made by omission.
    bind: env.REVIEW_GATE_BIND ?? "127.0.0.1",
    mongoUrl,
    dbName,
    initialExecutionMs,
  };
}

/**
 * Drive the expiry sweep.
 *
 * WITHOUT THIS, THE SWEEP WAS DEAD CODE. An independent review found that `sweepAttestations` had the
 * right behaviour and nothing called it outside tests — so an expired bound lease stayed RESERVED_BOUND
 * for ever and an abandoned execution stayed EXECUTING, neither becoming reconcilable. Acquire and redeem
 * correctly refuse an expired record, but the state transition the design promises simply never happened.
 *
 * Errors are logged and swallowed: a sweep that throws must not take the process down, and the next tick
 * retries. Every transition it makes is a CAS, so a slow sweep overlapping the next one cannot double-apply.
 */
export function startExpirySweep(store: ReviewGateStore, options: {
  intervalMs?: number;
  now?: () => string;
} = {}): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 30_000;
  const now = options.now ?? (() => new Date().toISOString());
  const timer = setInterval(() => {
    void store.sweepAttestations(now()).then((swept) => {
      if (swept.expired.length) {
        console.log(`[review-gate] expired ${swept.expired.length} unbound attestation(s)`);
      }
      if (swept.indeterminate.length) {
        // Worth a louder line: each of these now needs a human reconciliation before anything can
        // proceed, which is the deliberate cost of refusing to guess whether a host changed.
        console.warn(
          `[review-gate] ${swept.indeterminate.length} attestation(s) became INDETERMINATE and require ` +
          "owner reconciliation: " + swept.indeterminate.join(", "));
      }
    }).catch((error) => {
      console.error("[review-gate] expiry sweep failed", error);
    });
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

/**
 * `options` carries DEPLOYMENT TUNABLES only — values a real operator sets, not behaviour a caller
 * injects. Today that is the initial execution window, and nothing in this object can substitute a
 * policy, a clock, an identity or a store.
 *
 * The `store` PARAMETER is a separate matter and predates this: `main()` constructs the only store this
 * process ever uses, and the ten review rounds spent on injectability were about the SERVICE never
 * handing one back or accepting one after construction. An earlier draft of this comment said the store
 * was "never accepted here", which is plainly false of a function whose first parameter is one; an
 * independent review caught it. The options object adds no new injection point, which is the claim that
 * was actually meant.
 *
 * `AttestationService` validates the window against the absolute cap, so a bad value is refused at
 * construction rather than surfacing as a dead extension path mid-execution.
 */
export function buildApp(store: ReviewGateStore, options: {
  initialExecutionMs?: number;
} = {}): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(buildRouter({
    store,
    service: new ReviewGateService(store),
    attestations: new AttestationService(store, { initialExecutionMs: options.initialExecutionMs }),
  }));
  // Anything unhandled is a refusal, not a stack trace: an error path that leaks internals is a data
  // path. The detail goes to the gate's own logs.
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[review-gate] unhandled", error);
    res.status(500).json({ ok: false, code: "internal_error" });
  });
  return app;
}

/**
 * Start the process.
 *
 * The store is constructed HERE and nowhere else. It is never accepted from a caller and never handed
 * back: the service keeps it in a runtime-private field. For ten review rounds it was injectable, and
 * every attempt to make that safe relocated the reachable primitive instead of removing it.
 *
 * NOT EXERCISED. This has never been run against a live replica set, because none was available where it
 * was written. The Mongo store it depends on is typechecked and unverified — see
 * `test/mongoStore.test.ts`, which runs the same conformance suite the in-memory reference passes and
 * skips loudly until REVIEW_GATE_TEST_MONGO_URL points at a replica set.
 */
export async function main(): Promise<void> {
  const config = readConfig(process.env);
  const client = new MongoClient(config.mongoUrl);
  await client.connect();
  const store = new MongoReviewGateStore(client, config.dbName);
  // Indexes are the ones that ENFORCE invariants — content-claim uniqueness, evidence replay, principal
  // identity. Creating them at start means the service refuses to run against a database that cannot
  // hold its guarantees, rather than discovering that on the first concurrent write.
  await ensureIndexes(store.database);

  const app = buildApp(store, { initialExecutionMs: config.initialExecutionMs });
  const sweep = startExpirySweep(store);
  await new Promise<void>((resolve) => {
    const server = app.listen(config.port, config.bind, () => {
      // The advisory sentence is logged at every start, deliberately. It is the honest description of
      // what this process currently is, and it stays until the enforcement point ships.
      console.log(`[review-gate] listening on ${config.bind}:${config.port}`);
      // Logged only when an operator has overridden it. A non-default execution window changes how
      // every acquire behaves, and it is the first thing worth knowing when extensions start being
      // refused -- which is otherwise visible only as a code at the far end of a real execution.
      if (config.initialExecutionMs !== undefined) {
        console.log(`[review-gate] initial execution window ${config.initialExecutionMs} ms (configured)`);
      }
      console.log(`[review-gate] ${ADVISORY_NOTICE}`);
      resolve();
    });
    const shutdown = (signal: string) => {
      console.log(`[review-gate] ${signal}: closing`);
      sweep.stop();
      server.close(() => { void client.close().then(() => process.exit(0)); });
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  });
}

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  main().catch((error) => {
    console.error("[review-gate] failed to start:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
