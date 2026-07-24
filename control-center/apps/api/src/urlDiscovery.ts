import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { deriveWebsiteTarget, isPublicIpAddress, isSafeHttpCheckUrl } from "@control-center/shared";

export type WebsiteDiscovery = ReturnType<typeof deriveWebsiteTarget> & {
  addresses: string[];
  aRecords: string[];
  aaaaRecords: string[];
  httpsAvailable: boolean;
  httpStatus?: number;
  pageTitle?: string;
  responseHeaders?: Record<string, string>;
  redirected: boolean;
};

export type WebsiteFailureStatus = "dns_error" | "tls_error" | "unreachable";
export function websiteFailureStatus(error: unknown): WebsiteFailureStatus {
  const message = `${error instanceof Error ? error.message : error} ${error instanceof Error && error.cause ? String(error.cause) : ""}`.toLowerCase();
  if (/enotfound|eai_again|dns|name.*not.*resolved/.test(message)) return "dns_error";
  if (/certificate|cert_|tls|ssl|hostname.*match|unable_to_verify/.test(message)) return "tls_error";
  return "unreachable";
}

export const isPublicAddress = isPublicIpAddress;

export type AddressResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export async function resolvePublic(hostname: string, resolver: AddressResolver = (value) => dns.lookup(value, { all: true, verbatim: true })) {
  hostname = hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("Local addresses are not allowed");
  const literal = net.isIP(hostname) ? [{ address: hostname, family: net.isIPv4(hostname) ? 4 : 6 }] : await resolver(hostname);
  if (!literal.length || literal.some((entry) => !isPublicAddress(entry.address))) throw new Error("URL resolves to a private or reserved address");
  return literal;
}

export async function validatePublicHealthCheckUrl(raw: string, resolver?: AddressResolver) {
  if (!isSafeHttpCheckUrl(raw)) throw new Error("Health check URL is not an approved public HTTP target");
  const url = new URL(raw);
  await resolvePublic(url.hostname, resolver);
  return url.toString();
}

type PublicWebsiteResponse = { status: number; url: string; headers: Record<string, string>; text: string };
export type PublicWebsiteHooks = {
  resolve?: AddressResolver;
  request?: (url: URL, address: string) => Promise<PublicWebsiteResponse>;
};

function requestPinnedWebsite(url: URL, address: string): Promise<PublicWebsiteResponse> {
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
      headers: { "user-agent": "OpsWorkbench-Discovery/1.0", accept: "text/html,*/*;q=0.1" },
      lookup: (_hostname, _options, callback) => callback(null, address, net.isIPv6(address) ? 6 : 4)
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const complete = () => {
        const headers = Object.fromEntries(Object.entries(response.headers).flatMap(([name, value]) => typeof value === "string" ? [[name, value]] : Array.isArray(value) ? [[name, value.join(", ")]] : []));
        finish(() => resolve({ status: response.statusCode || 0, url: url.toString(), headers, text: Buffer.concat(chunks).toString("utf8") }));
      };
      response.on("data", (chunk: Buffer) => {
        if (size >= 256_000) return;
        const remaining = 256_000 - size;
        const bounded = chunk.subarray(0, remaining);
        chunks.push(bounded);
        size += bounded.length;
        if (size >= 256_000) { response.destroy(); complete(); }
      });
      response.once("end", complete);
      response.once("error", (error) => finish(() => reject(error)));
    });
    request.setTimeout(5000, () => request.destroy(new Error("Website discovery timed out")));
    request.once("error", (error) => finish(() => reject(error)));
    request.end();
  });
}

export async function fetchPublicWebsite(initialUrl: string, hooks: PublicWebsiteHooks = {}) {
  let current = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const parsed = new URL(current);
    const addresses = await resolvePublic(parsed.hostname, hooks.resolve);
    const response = await (hooks.request || requestPinnedWebsite)(parsed, addresses[0].address);
    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      if (redirects === 3) throw new Error("Too many redirects");
      current = new URL(location, current).toString();
      continue;
    }
    return { response, redirected: redirects > 0 };
  }
  throw new Error("Discovery failed");
}

export async function discoverWebsite(input: string): Promise<WebsiteDiscovery> {
  const derived = deriveWebsiteTarget(input);
  const resolved = await resolvePublic(derived.domain);
  const { response, redirected } = await fetchPublicWebsite(derived.normalizedUrl);
  const title = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(response.text)?.[1]?.replace(/\s+/g, " ").trim();
  const safeHeaders: Record<string, string> = {};
  for (const name of ["content-type", "content-length", "server", "cache-control", "strict-transport-security"]) {
    const value = response.headers[name]; if (value) safeHeaders[name] = value.slice(0, 500);
  }
  return { ...derived, addresses: [...new Set(resolved.map((entry) => entry.address))], aRecords: resolved.filter((entry) => entry.family === 4).map((entry) => entry.address), aaaaRecords: resolved.filter((entry) => entry.family === 6).map((entry) => entry.address), httpsAvailable: response.url.startsWith("https://") || derived.normalizedUrl.startsWith("https://"), httpStatus: response.status, pageTitle: title, responseHeaders: safeHeaders, redirected };
}
