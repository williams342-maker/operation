import { execFileSync } from "node:child_process";
import type { ConnectivityStatus } from "@control-center/shared";
import fs from "node:fs";

function command(file: string, args: string[]) { try { return execFileSync(file, args, { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } }

export function collectConnectivity(): ConnectivityStatus[] {
  const systemctl = fs.existsSync("/usr/bin/systemctl") ? "/usr/bin/systemctl" : "/bin/systemctl";
  const installed = Boolean(command(systemctl, ["show", "cloudflared.service", "--property=LoadState", "--value"]));
  if (!installed) return [];
  const active = command(systemctl, ["is-active", "cloudflared.service"]) === "active";
  const enabled = command(systemctl, ["is-enabled", "cloudflared.service"]) === "enabled";
  const started = Number(command(systemctl, ["show", "cloudflared.service", "--property=ActiveEnterTimestampUSec", "--value"]));
  const cloudflared = fs.existsSync("/usr/local/bin/cloudflared") ? "/usr/local/bin/cloudflared" : "/usr/bin/cloudflared";
  const version = command(cloudflared, ["--version"]).slice(0, 160) || undefined;
  let identifier: string | undefined; try { const value = fs.readFileSync("/etc/cloudflared/opsworkbench-tunnel-id", "utf8").trim(); if (/^[A-Za-z0-9._:-]{1,160}$/.test(value)) identifier = value; } catch { /* optional non-secret identifier */ }
  return [{ provider: "cloudflare", configured: true, state: active ? "connected" : "disconnected", service: { installed, active, enabled, version, ...(started > 0 ? { uptimeSeconds: Math.max(0, Math.floor((Date.now() * 1000 - started) / 1_000_000)), lastReconnectAt: new Date(Math.floor(started / 1000)).toISOString() } : {}) }, tunnel: { connected: active, identifier }, observedAt: new Date().toISOString() }];
}
