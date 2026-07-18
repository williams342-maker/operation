import dns from "node:dns/promises";
import net from "node:net";
import { deriveWebsiteTarget } from "@control-center/shared";

export type WebsiteDiscovery = ReturnType<typeof deriveWebsiteTarget> & {
  addresses: string[];
  aRecords: string[];
  aaaaRecords: string[];
  httpsAvailable: boolean;
  httpStatus?: number;
  pageTitle?: string;
  responseHeaders?: Record<string, string>;
};

export function isPublicAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 || (a === 100 && b >= 64 && b <= 127));
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    return !(value === "::" || value === "::1" || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("ff"));
  }
  return false;
}

async function resolvePublic(hostname: string) {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("Local addresses are not allowed");
  const literal = net.isIP(hostname) ? [{ address: hostname, family: net.isIPv4(hostname) ? 4 : 6 }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!literal.length || literal.some((entry) => !isPublicAddress(entry.address))) throw new Error("URL resolves to a private or reserved address");
  return literal;
}

async function fetchBounded(initialUrl: string) {
  let current = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const parsed = new URL(current);
    await resolvePublic(parsed.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(current, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "OpsWorkbench-Discovery/1.0", accept: "text/html,*/*;q=0.1" } });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        if (redirects === 3) throw new Error("Too many redirects");
        current = new URL(response.headers.get("location")!, current).toString();
        continue;
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (reader && size < 256_000) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 256_000) break;
        chunks.push(part.value);
      }
      await reader?.cancel().catch(() => undefined);
      return { response, text: new TextDecoder().decode(Buffer.concat(chunks)) };
    } finally { clearTimeout(timer); }
  }
  throw new Error("Discovery failed");
}

export async function discoverWebsite(input: string): Promise<WebsiteDiscovery> {
  const derived = deriveWebsiteTarget(input);
  const resolved = await resolvePublic(derived.domain);
  const { response, text } = await fetchBounded(derived.normalizedUrl);
  const title = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(text)?.[1]?.replace(/\s+/g, " ").trim();
  const safeHeaders: Record<string, string> = {};
  for (const name of ["content-type", "content-length", "server", "cache-control", "strict-transport-security"]) {
    const value = response.headers.get(name); if (value) safeHeaders[name] = value.slice(0, 500);
  }
  return { ...derived, addresses: [...new Set(resolved.map((entry) => entry.address))], aRecords: resolved.filter((entry) => entry.family === 4).map((entry) => entry.address), aaaaRecords: resolved.filter((entry) => entry.family === 6).map((entry) => entry.address), httpsAvailable: response.url.startsWith("https://") || derived.normalizedUrl.startsWith("https://"), httpStatus: response.status, pageTitle: title, responseHeaders: safeHeaders };
}
