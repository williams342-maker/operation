import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { isSafeHttpCheckUrl } from "@control-center/shared";

export type HostnameResolver = (hostname: string) => Promise<string[]>;

// Reject any address that is not a routable public unicast address: loopback, private (RFC1918),
// link-local (incl. the 169.254.169.254 cloud-metadata endpoint), CGNAT (100.64/10, which also covers
// Alibaba's 100.100.100.200 metadata host), multicast, and the IPv6 equivalents (::, ::1, unique-local
// fc00::/7 — incl. fd00:ec2::254 — link-local fe80::/10, multicast ff00::/8).
export function publicAddress(address: string) {
  if (net.isIPv4(address)) { const [a, b] = address.split(".").map(Number); return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 || (a === 100 && b >= 64 && b <= 127)); }
  if (net.isIPv6(address)) { const value = address.toLowerCase(); return !(value === "::" || value === "::1" || /^(fc|fd|fe[89ab]|ff)/.test(value)); }
  return false;
}

export const defaultResolver: HostnameResolver = async (hostname: string) =>
  (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

// Validate that a URL is an http(s) target whose EVERY resolved address is public, and return the URL
// plus one validated address to pin the connection to. Because all resolved addresses must be public,
// pinning to any single one is safe and closes the DNS-rebinding TOCTOU (a second resolution at connect
// time cannot swap in a private address).
async function resolveValidated(raw: string, resolver: HostnameResolver) {
  if (!isSafeHttpCheckUrl(raw)) throw new Error("HTTP target rejected");
  const url = new URL(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname) ? [hostname] : await resolver(hostname);
  if (!addresses.length || addresses.some((address) => !publicAddress(address))) throw new Error("HTTP target rejected");
  const pinned = addresses[0];
  return { url, hostname, pinned, family: net.isIPv6(pinned) ? 6 : 4 as 4 | 6 };
}

// Backwards-compatible validation entry point (used by the deployment pre-flight). Throws if unsafe.
export async function validateHttpCheckUrl(raw: string, resolver: HostnameResolver = defaultResolver) {
  const { url } = await resolveValidated(raw, resolver);
  return url;
}

function requestPinned(url: URL, hostname: string, pinned: string, family: 4 | 6, timeoutMs: number): Promise<{ status: number; location: string | null }> {
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = lib.request({
      protocol: url.protocol,
      hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      // Pin DNS to the pre-validated address so undici/net cannot re-resolve to a private target.
      lookup: (_host: string, _options: unknown, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => callback(null, pinned, family),
      // Preserve TLS certificate validation and virtual-host routing against the real hostname.
      servername: net.isIP(hostname) ? undefined : hostname,
      headers: { host: url.host },
      timeout: timeoutMs
    }, (response) => {
      const status = response.statusCode || 0;
      const rawLocation = response.headers.location;
      const location = Array.isArray(rawLocation) ? rawLocation[0] ?? null : rawLocation ?? null;
      response.resume();
      resolve({ status, location });
    });
    request.on("timeout", () => request.destroy(Object.assign(new Error("Request timed out"), { name: "TimeoutError" })));
    request.on("error", reject);
    request.end();
  });
}

export type HttpProbeResult = { ok: boolean; statusCode: number };
// The request step is injectable so the redirect/revalidation loop can be tested without live sockets.
export type PinnedRequest = (url: URL, hostname: string, pinned: string, family: 4 | 6, timeoutMs: number) => Promise<{ status: number; location: string | null }>;

// GET a validated public URL, pinning each connection to a validated address and following redirects
// manually — re-resolving AND re-validating every hop so a redirect cannot bounce into a private target.
export async function probeHttp(raw: string, timeoutMs: number, resolver: HostnameResolver = defaultResolver, perform: PinnedRequest = requestPinned): Promise<HttpProbeResult> {
  let current = raw;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const { url, hostname, pinned, family } = await resolveValidated(current, resolver);
    const { status, location } = await perform(url, hostname, pinned, family, timeoutMs);
    if (status >= 300 && status < 400 && location) {
      if (redirects === 3) throw new Error("Too many redirects");
      current = new URL(location, current).toString();
      continue;
    }
    return { ok: status >= 200 && status < 300, statusCode: status };
  }
  throw new Error("Too many redirects");
}
