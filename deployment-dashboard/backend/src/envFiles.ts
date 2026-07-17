import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isSecretKey, redact } from "./security.js";
import type { EnvEntry } from "./types.js";

export const envSaveSchema = z.object({
  entries: z.array(z.object({
    key: z.string().regex(/^[A-Z0-9_]+$/i),
    value: z.string(),
    keepExisting: z.boolean().optional()
  }))
});

export function parseEnv(text: string) {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const rawValue = trimmed.slice(idx + 1).trim();
    map.set(key, rawValue.replace(/^["']|["']$/g, ""));
  }
  return map;
}

export function serializeEnv(map: Map<string, string>) {
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${quoteIfNeeded(value)}`)
    .join("\n") + "\n";
}

function quoteIfNeeded(value: string) {
  if (/[\s#]/.test(value)) return JSON.stringify(value);
  return value;
}

export function readEnvFile(filePath: string, required: string[]): EnvEntry[] {
  const text = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const map = parseEnv(text);
  const keys = new Set([...map.keys(), ...required]);
  return Array.from(keys).sort().map((key) => {
    const value = map.get(key) || "";
    const masked = isSecretKey(key);
    return {
      key,
      value: masked ? redact(value) : value,
      masked,
      required: required.includes(key),
      present: Boolean(value)
    };
  });
}

export function backupEnvFile(filePath: string, backupRoot: string, label: string) {
  fs.mkdirSync(backupRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupRoot, `${label}.env.${timestamp}.bak`);
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, dest);
  else fs.writeFileSync(dest, "");
  return dest;
}

export function saveEnvFile(filePath: string, backupRoot: string, label: string, entries: z.infer<typeof envSaveSchema>["entries"]) {
  const backupPath = backupEnvFile(filePath, backupRoot, label);
  const current = fs.existsSync(filePath) ? parseEnv(fs.readFileSync(filePath, "utf8")) : new Map<string, string>();
  for (const entry of entries) {
    if (entry.keepExisting) continue;
    current.set(entry.key, entry.value);
  }
  fs.writeFileSync(filePath, serializeEnv(current));
  return backupPath;
}
