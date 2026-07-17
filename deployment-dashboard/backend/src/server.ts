import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { MongoClient } from "mongodb";
import si from "systeminformation";
import { z } from "zod";
import { loadSettings, saveSettings } from "./config.js";
import { getDeployment, startDeployment } from "./deployments.js";
import { envSaveSchema, readEnvFile, saveEnvFile, backupEnvFile } from "./envFiles.js";
import { execSafe } from "./safeExec.js";
import { issueCsrfToken, requireAdmin, requireCsrf } from "./security.js";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(helmet());
app.use(compression());
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120 }));
app.use(requireAdmin);
app.use(requireCsrf);

function settings() {
  return loadSettings();
}

app.get("/api/csrf", (_req, res) => res.json({ csrfToken: issueCsrfToken() }));

app.get("/api/status", async (_req, res, next) => {
  try {
    const cfg = settings();
    const [branch, commit, latest, pm2, mem, load] = await Promise.all([
      execSafe("git", ["rev-parse", "--abbrev-ref", "HEAD"], cfg.paths.repoRoot).catch((e) => ({ stdout: "", stderr: String(e), code: 1 })),
      execSafe("git", ["rev-parse", "--short", "HEAD"], cfg.paths.repoRoot).catch((e) => ({ stdout: "", stderr: String(e), code: 1 })),
      execSafe("git", ["ls-remote", "origin", cfg.github.branch], cfg.paths.repoRoot).catch((e) => ({ stdout: "", stderr: String(e), code: 1 })),
      execSafe("pm2", ["jlist"], cfg.paths.repoRoot).catch((e) => ({ stdout: "[]", stderr: String(e), code: 1 })),
      si.mem(),
      si.currentLoad()
    ]);
    let pm2Processes: unknown[] = [];
    try { pm2Processes = JSON.parse(pm2.stdout || "[]"); } catch { pm2Processes = []; }
    res.json({
      backendStatus: "online",
      frontendStatus: "online",
      mongoStatus: "unknown",
      git: {
        branch: branch.stdout.trim(),
        commit: commit.stdout.trim(),
        latestCommit: latest.stdout.trim().split(/\s+/)[0] || ""
      },
      uptime: os.uptime(),
      nodeVersion: process.version,
      pm2: pm2Processes,
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free
      },
      cpu: {
        currentLoad: load.currentLoad,
        cores: os.cpus().length
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/github/check", async (_req, res, next) => {
  try {
    const cfg = settings();
    await execSafe("git", ["fetch", "origin", cfg.github.branch], cfg.paths.repoRoot);
    const local = await execSafe("git", ["rev-parse", "HEAD"], cfg.paths.repoRoot);
    const remote = await execSafe("git", ["rev-parse", `origin/${cfg.github.branch}`], cfg.paths.repoRoot);
    const history = await execSafe("git", ["log", "--oneline", "--decorate", "-10"], cfg.paths.repoRoot);
    res.json({
      local: local.stdout.trim(),
      remote: remote.stdout.trim(),
      updatesAvailable: local.stdout.trim() !== remote.stdout.trim(),
      history: history.stdout.trim().split(/\r?\n/).filter(Boolean)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/github/deploy", (_req, res) => {
  const id = startDeployment(settings());
  res.status(202).json({ deploymentId: id });
});

app.get("/api/github/deploy/:id/events", (req, res) => {
  const deployment = getDeployment(req.params.id);
  if (!deployment) return res.status(404).json({ error: "Deployment not found" });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  let idx = 0;
  const timer = setInterval(() => {
    const current = getDeployment(req.params.id);
    if (!current) return;
    while (idx < current.lines.length) {
      res.write(`data: ${JSON.stringify({ line: current.lines[idx++] })}\n\n`);
    }
    if (current.status !== "running") {
      res.write(`event: done\ndata: ${JSON.stringify({ status: current.status })}\n\n`);
      clearInterval(timer);
      res.end();
    }
  }, 500);
  req.on("close", () => clearInterval(timer));
});

function envRoutes(kind: "backend" | "frontend") {
  const getPath = () => kind === "backend" ? settings().paths.backendEnv : settings().paths.frontendEnv;
  const required = () => kind === "backend" ? settings().envValidation.backendRequired : settings().envValidation.frontendRequired;
  app.get(`/api/env/${kind}`, (_req, res) => {
    res.json({ entries: readEnvFile(getPath(), required()) });
  });
  app.post(`/api/env/${kind}`, async (req, res, next) => {
    try {
      const body = envSaveSchema.parse(req.body);
      const missing = required().filter((key) => {
        const entry = body.entries.find((item) => item.key === key);
        return entry && !entry.keepExisting && !entry.value;
      });
      if (missing.length) return res.status(400).json({ error: "Missing required values", missing });
      const backupPath = saveEnvFile(getPath(), settings().paths.backupRoot, kind, body.entries);
      const processName = kind === "backend" ? settings().pm2.backendProcess : settings().pm2.frontendProcess;
      await execSafe("pm2", ["restart", processName], settings().paths.repoRoot).catch(() => ({ code: 1, stdout: "", stderr: "PM2 restart failed" }));
      res.json({ ok: true, backupPath });
    } catch (error) {
      next(error);
    }
  });
}
envRoutes("backend");
envRoutes("frontend");

async function pm2Action(processName: string, action: "restart" | "stop") {
  return execSafe("pm2", [action, processName], settings().paths.repoRoot);
}

app.post("/api/restart/backend", async (_req, res, next) => {
  try { res.json(await pm2Action(settings().pm2.backendProcess, "restart")); } catch (e) { next(e); }
});
app.post("/api/restart/frontend", async (_req, res, next) => {
  try { res.json(await pm2Action(settings().pm2.frontendProcess, "restart")); } catch (e) { next(e); }
});
app.post("/api/restart/all", async (_req, res, next) => {
  try {
    const backend = await pm2Action(settings().pm2.backendProcess, "restart");
    const frontend = await pm2Action(settings().pm2.frontendProcess, "restart");
    res.json({ backend, frontend });
  } catch (e) { next(e); }
});
app.post("/api/stop/backend", async (_req, res, next) => {
  try { res.json(await pm2Action(settings().pm2.backendProcess, "stop")); } catch (e) { next(e); }
});
app.post("/api/stop/frontend", async (_req, res, next) => {
  try { res.json(await pm2Action(settings().pm2.frontendProcess, "stop")); } catch (e) { next(e); }
});

app.get("/api/logs", async (req, res, next) => {
  try {
    const source = z.enum(["backend", "frontend", "deployment"]).parse(req.query.source || "deployment");
    const filter = String(req.query.filter || "");
    if (source === "deployment") {
      const file = path.join(settings().paths.logRoot, "deployment.log");
      const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      return res.type("text/plain").send(filter ? text.split(/\r?\n/).filter((line) => line.includes(filter)).join("\n") : text);
    }
    const processName = source === "backend" ? settings().pm2.backendProcess : settings().pm2.frontendProcess;
    const logs = await execSafe("pm2", ["logs", processName, "--lines", "300", "--nostream"], settings().paths.repoRoot);
    const text = filter ? logs.stdout.split(/\r?\n/).filter((line) => line.includes(filter)).join("\n") : logs.stdout;
    res.type("text/plain").send(text);
  } catch (e) { next(e); }
});

app.post("/api/logs/clear", async (_req, res, next) => {
  try { res.json(await execSafe("pm2", ["flush"], settings().paths.repoRoot)); } catch (e) { next(e); }
});

app.get("/api/db/test", async (_req, res, next) => {
  const start = Date.now();
  try {
    const envText = fs.existsSync(settings().paths.backendEnv) ? fs.readFileSync(settings().paths.backendEnv, "utf8") : "";
    const mongoUrl = /MONGO_URL=(.+)/.exec(envText)?.[1]?.replace(/^["']|["']$/g, "") || process.env.MONGO_URL || "";
    if (!mongoUrl) return res.status(400).json({ ok: false, error: "MONGO_URL missing" });
    const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const db = client.db();
    await db.command({ ping: 1 });
    const collections = await db.listCollections().toArray();
    await client.close();
    res.json({ ok: true, latencyMs: Date.now() - start, database: db.databaseName, collections: collections.map((c) => c.name), connectionStringValid: true });
  } catch (e) { next(e); }
});

app.get("/api/backups", (_req, res) => {
  const dir = settings().paths.backupRoot;
  const backups = fs.existsSync(dir)
    ? fs.readdirSync(dir).map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, path: full, size: stat.size, createdAt: stat.birthtime };
    }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    : [];
  res.json({ backups });
});

app.post("/api/backups/create", (req, res) => {
  const kind = z.enum(["backend", "frontend"]).parse(req.body.kind);
  const file = kind === "backend" ? settings().paths.backendEnv : settings().paths.frontendEnv;
  res.json({ backupPath: backupEnvFile(file, settings().paths.backupRoot, kind) });
});

app.post("/api/backups/restore", async (req, res, next) => {
  try {
    const body = z.object({ backupName: z.string(), kind: z.enum(["backend", "frontend"]) }).parse(req.body);
    if (body.backupName.includes("..") || path.basename(body.backupName) !== body.backupName) {
      return res.status(400).json({ error: "Invalid backup name" });
    }
    const src = path.join(settings().paths.backupRoot, body.backupName);
    const dest = body.kind === "backend" ? settings().paths.backendEnv : settings().paths.frontendEnv;
    fs.copyFileSync(src, dest);
    const processName = body.kind === "backend" ? settings().pm2.backendProcess : settings().pm2.frontendProcess;
    await execSafe("pm2", ["restart", processName], settings().paths.repoRoot).catch(() => ({ code: 1, stdout: "", stderr: "PM2 restart failed" }));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get("/api/settings", (_req, res) => res.json(settings()));
app.post("/api/settings", (req, res, next) => {
  try { res.json(saveSettings(req.body)); } catch (e) { next(e); }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`Deployment dashboard API listening on http://localhost:${port}`);
});
