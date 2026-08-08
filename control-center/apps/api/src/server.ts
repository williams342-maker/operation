import crypto from "node:crypto";
import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { ZodError } from "zod";
import { assertFlagOffRollbackSafe } from "@control-center/shared";
import { captureRawBody } from "./agentAuth.js";
import { connectDb, collections } from "./db.js";
import { agentV2Enabled } from "./agentProtocolFlag.js";
import { resolveBuildIdentity } from "./buildIdentity.js";
import { validateRuntimeSecrets } from "./crypto.js";
import { assertValidEnvironment } from "./environmentValidation.js";
import { initializeRuntimeReadiness, runtimeHealth } from "./runtimeReadiness.js";
import { router } from "./routes.js";
import { startAiWorkforceWorker } from "./aiWorkforceWorker.js";

const environmentValidation = assertValidEnvironment();
initializeRuntimeReadiness(environmentValidation);
validateRuntimeSecrets();
if (process.env.NODE_ENV === "production" && process.env.CONTROL_CENTER_ALLOW_INSECURE_COOKIES === "true") {
  throw new Error("Insecure cookies are not allowed in production");
}

const app = express();
const port = Number(process.env.PORT || 3000);
if (process.env.CONTROL_CENTER_TRUST_PROXY) app.set("trust proxy", process.env.CONTROL_CENTER_TRUST_PROXY);

app.use((req, _res, next) => {
  req.requestId = req.header("x-request-id") || crypto.randomUUID();
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "https://accounts.google.com/gsi/client"],
      "style-src": ["'self'", "'unsafe-inline'", "https://accounts.google.com/gsi/style"],
      "img-src": ["'self'", "data:"],
      "connect-src": ["'self'", "https://accounts.google.com/gsi/"],
      "frame-src": ["https://accounts.google.com/gsi/"],
      "frame-ancestors": ["'none'"]
    }
  },
  hsts: process.env.NODE_ENV === "production" ? { maxAge: 15552000, includeSubDomains: true, preload: false } : false,
  referrerPolicy: { policy: "no-referrer" },
  frameguard: { action: "deny" },
  noSniff: true
}));
app.use(compression());
app.use(cors({ origin: process.env.CONTROL_CENTER_WEB_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(rateLimit({ windowMs: 60_000, limit: 180 }));
app.use(express.json({ limit: "1mb", verify: captureRawBody }));
app.get("/healthz", (_req, res) => { const identity = resolveBuildIdentity(); res.json({ ok: true, status: "alive", version: identity.version, commit: identity.commit, source: identity.source }); });
app.get("/readyz", async (_req, res) => { const health = await runtimeHealth(); res.status(health.status === "ready" ? 200 : 503).json(health); });
// Coarse per-IP cap on the credential endpoints, on top of the global limiter and the per-account
// progressive lockout (authThrottle). Disabled under test so the integration suite's many logins from
// a single loopback IP do not trip it; the per-account lockout is exercised by tests instead.
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "staging",
  message: { error: "Too many authentication attempts. Try again later.", code: "RATE_LIMITED" }
});
app.use(["/api/auth/login", "/api/auth/reauthenticate", "/api/auth/owner-replacement", "/api/auth/google"], authLimiter);
app.use("/api", router);

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if ((error as { status?: number })?.status === 413) return res.status(413).json({ error: "Request payload exceeds the 1 MB limit", requestId: req.requestId });
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue?.path.join(" ") || "request";
    return res.status(400).json({ error: `Invalid ${field}: ${issue?.message || "invalid value"}`, requestId: req.requestId });
  }
  const message = process.env.NODE_ENV === "production" ? "Internal server error" : error instanceof Error ? error.message : "Unknown error";
  res.status(500).json({ error: message, requestId: req.requestId });
});

if (process.env.NODE_ENV !== "test") {
  await connectDb();
  // Fail-safe rollback preflight: if agent-v2 is DISABLED (v1-only) but active agents exist that have no
  // usable v1 credential (fresh-v2 or legacy-invalidated), refuse to boot rather than silently strand
  // them. The operator must re-enable v2 or roll back to a v2-capable release + state rollback.
  if (!agentV2Enabled()) {
    const activeAgents = await collections.servers.find({ archivedAt: { $exists: false }, revokedAt: { $exists: false } }, { projection: { keyProtocolVersion: 1, migrationState: 1, legacyCredentialUsable: 1, hostname: 1 } }).toArray();
    assertFlagOffRollbackSafe(activeAgents.map((server) => ({ id: server._id.toHexString(), hostname: server.hostname, keyProtocolVersion: server.keyProtocolVersion, migrationState: server.migrationState, legacyCredentialUsable: server.legacyCredentialUsable })));
  }
  await startAiWorkforceWorker();
  console.log(JSON.stringify({ event: "startup_validation", mode: environmentValidation.mode, valid: environmentValidation.valid, warnings: environmentValidation.diagnostics.filter((item) => item.level === "warning").map((item) => ({ code: item.code, variable: item.variable })), aiState: environmentValidation.ai.state }));
  app.listen(port, () => {
    console.log(`Control Center API listening on http://localhost:${port}`);
  });
}

export { app };
