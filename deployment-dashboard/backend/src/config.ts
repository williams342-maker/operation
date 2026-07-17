import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppSettings } from "./types.js";

const root = path.resolve(process.cwd());
const examplePath = path.join(root, "config.example.json");
const localPath = path.join(root, "config.local.json");

const settingsSchema = z.object({
  github: z.object({
    repository: z.string().min(1),
    branch: z.string().regex(/^[\w./-]+$/)
  }),
  paths: z.object({
    repoRoot: z.string().min(1),
    backendRoot: z.string().min(1),
    frontendRoot: z.string().min(1),
    backendEnv: z.string().min(1),
    frontendEnv: z.string().min(1),
    backupRoot: z.string().min(1),
    logRoot: z.string().min(1)
  }),
  commands: z.object({
    backendInstall: z.array(z.string()).min(1),
    frontendInstall: z.array(z.string()).min(1),
    frontendBuild: z.array(z.string()).min(1)
  }),
  pm2: z.object({
    backendProcess: z.string().min(1),
    frontendProcess: z.string().min(1)
  }),
  envValidation: z.object({
    backendRequired: z.array(z.string()),
    frontendRequired: z.array(z.string())
  }),
  auth: z.object({
    issuer: z.string().optional(),
    audience: z.string().optional()
  })
});

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadSettings(): AppSettings {
  const base = readJson(examplePath);
  const local = fs.existsSync(localPath) ? readJson(localPath) : {};
  const merged = {
    ...base,
    ...local,
    github: { ...base.github, ...local.github },
    paths: { ...base.paths, ...local.paths },
    commands: { ...base.commands, ...local.commands },
    pm2: { ...base.pm2, ...local.pm2 },
    envValidation: { ...base.envValidation, ...local.envValidation },
    auth: { ...base.auth, ...local.auth }
  };
  const parsed = settingsSchema.parse(merged);
  for (const dir of [parsed.paths.backupRoot, parsed.paths.logRoot]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return parsed;
}

export function saveSettings(settings: AppSettings) {
  const parsed = settingsSchema.parse(settings);
  fs.writeFileSync(localPath, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}
