import crypto from "node:crypto";
import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { ZodError } from "zod";
import { captureRawBody } from "./agentAuth.js";
import { connectDb } from "./db.js";
import { validateRuntimeSecrets } from "./crypto.js";
import { assertValidEnvironment } from "./environmentValidation.js";
import { initializeRuntimeReadiness, runtimeHealth } from "./runtimeReadiness.js";
import { runtimeIdentity } from "./runtimeIdentity.js";
import { router } from "./routes.js";

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
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
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
app.get("/healthz", (_req, res) => { const build = runtimeIdentity(); res.json({ ok: true, status: "alive", version: build.version, commit: build.commit }); });
app.get("/readyz", async (_req, res) => { const health = await runtimeHealth(); res.status(health.status === "ready" ? 200 : 503).json(health); });
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
  console.log(JSON.stringify({ event: "startup_validation", mode: environmentValidation.mode, valid: environmentValidation.valid, warnings: environmentValidation.diagnostics.filter((item) => item.level === "warning").map((item) => ({ code: item.code, variable: item.variable })), aiState: environmentValidation.ai.state }));
  app.listen(port, () => {
    console.log(`Control Center API listening on http://localhost:${port}`);
  });
}

export { app };
