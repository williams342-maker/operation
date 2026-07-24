import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { isPublicIpAddress, isSafeHttpCheckUrl } from "@control-center/shared";

export type SafeHttpResponse = { statusCode: number; location?: string };
export type SafeHttpHooks = {
  resolve?: (hostname: string) => Promise<string[]>;
  request?: (url: URL, timeoutMs: number, address: string) => Promise<SafeHttpResponse>;
  now?: () => number;
};

export class UnsafeHttpTargetError extends Error {
  constructor() { super("HTTP health target rejected"); }
}

async function defaultResolve(hostname: string) {
  const literal = net.isIP(hostname);
  if (literal) return [hostname];
  return (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

export async function resolveSafeHttpTarget(raw: string, resolver = defaultResolve) {
  if (!isSafeHttpCheckUrl(raw)) throw new UnsafeHttpTargetError();
  const url = new URL(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await resolver(hostname);
  if (!addresses.length || addresses.some((address) => !isPublicIpAddress(address))) throw new UnsafeHttpTargetError();
  return { url, addresses };
}

function requestPinned(url: URL, timeoutMs: number, address: string): Promise<SafeHttpResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method: "GET",
      headers: { "user-agent": "OpsWorkbench-Agent/1.0", accept: "*/*" },
      lookup: pinnedLookup(address)
    }, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      response.destroy();
      finish(() => resolve({ statusCode, location }));
    });
    request.setTimeout(timeoutMs, () => {
      const error = new Error("HTTP health check timed out");
      error.name = "AbortError";
      request.destroy(error);
    });
    request.once("error", (error) => finish(() => reject(error)));
    request.end();
  });
}

export function pinnedLookup(address: string): net.LookupFunction {
  const family = net.isIPv6(address) ? 6 : 4;
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

export async function requestSafeHttp(raw: string, timeoutMs: number, hooks: SafeHttpHooks = {}) {
  const started = (hooks.now || Date.now)();
  let current = raw;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const target = await resolveSafeHttpTarget(current, hooks.resolve);
    const response = await (hooks.request || requestPinned)(target.url, timeoutMs, target.addresses[0]);
    if (response.statusCode >= 300 && response.statusCode < 400 && response.location) {
      if (redirects === 3) throw new UnsafeHttpTargetError();
      current = new URL(response.location, target.url).toString();
      continue;
    }
    return { statusCode: response.statusCode, latencyMs: Math.max(0, (hooks.now || Date.now)() - started) };
  }
  throw new UnsafeHttpTargetError();
}

export function safeHttpErrorCategory(error: unknown): "dns" | "timeout" | "tls" | "network" | "unknown" {
  if (error instanceof UnsafeHttpTargetError) return "network";
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? `${error.message} ${String(error.cause || "")}`.toLowerCase() : "";
  if (name === "AbortError" || /timed out|timeout/.test(message)) return "timeout";
  if (/enotfound|eai_again|dns/.test(message)) return "dns";
  if (/certificate|cert_|tls|ssl|hostname/.test(message)) return "tls";
  return error instanceof Error ? "network" : "unknown";
}
