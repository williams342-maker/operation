import express from "express";
import helmet from "helmet";
import { ADVISORY_NOTICE, buildRouter } from "./routes.js";
import { AttestationService } from "./attestationService.js";
import { ReviewGateService } from "./service.js";
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
  return {
    port: Number(env.REVIEW_GATE_PORT ?? 3100),
    // Loopback by default. This is not a public service, and a default of 0.0.0.0 would be a decision
    // made by omission.
    bind: env.REVIEW_GATE_BIND ?? "127.0.0.1",
    mongoUrl,
    dbName,
  };
}

export function buildApp(store: ReviewGateStore): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(buildRouter({
    store,
    service: new ReviewGateService(store),
    attestations: new AttestationService(store),
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
 * NOT CALLED BY ANY TEST and not wired to any deployment. The Mongo store this needs is the next build
 * phase; until then this function exists to be read and to fail loudly rather than to run.
 */
export async function main(): Promise<void> {
  const config = readConfig(process.env);
  console.log(`[review-gate] ${ADVISORY_NOTICE}`);
  throw new Error(
    "the Mongo store is not implemented yet; this service does not start. See " +
    "docs/REVIEW_GATE_OPTION_B_DESIGN.md §8.3 for the transaction boundaries it must satisfy. " +
    `(configured for ${config.dbName} on ${config.bind}:${config.port})`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  main().catch((error) => {
    console.error("[review-gate] failed to start:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
