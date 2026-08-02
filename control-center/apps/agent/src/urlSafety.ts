import dns from "node:dns/promises";
import net from "node:net";
import { isSafeHttpCheckUrl } from "@control-center/shared";

export type HostnameResolver = (hostname: string) => Promise<string[]>;

// Reject any address that is not a routable public unicast address: loopback, private (RFC1918),
// link-local (incl. the 169.254.169.254 cloud-metadata endpoint), CGNAT, multicast, and the IPv6
// equivalents (::, ::1, unique-local fc00::/7, link-local fe80::/10, multicast ff00::/8).
export function publicAddress(address: string) {
  if (net.isIPv4(address)) { const [a, b] = address.split(".").map(Number); return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 || (a === 100 && b >= 64 && b <= 127)); }
  if (net.isIPv6(address)) { const value = address.toLowerCase(); return !(value === "::" || value === "::1" || /^(fc|fd|fe[89ab]|ff)/.test(value)); }
  return false;
}

export const defaultResolver: HostnameResolver = async (hostname: string) =>
  (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

// Validate that a URL is an http(s) target whose every resolved address is public. Throws otherwise.
// NOTE: this resolves the hostname to validate it; the subsequent fetch resolves it again, leaving a
// narrow DNS-rebinding TOCTOU window (tracked separately) that would require pinning the validated IP
// on the socket to fully close. It still blocks all statically-private and metadata targets.
export async function validateHttpCheckUrl(raw: string, resolver: HostnameResolver = defaultResolver) {
  if (!isSafeHttpCheckUrl(raw)) throw new Error("HTTP target rejected");
  const url = new URL(raw); const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname) ? [hostname] : await resolver(hostname);
  if (!addresses.length || addresses.some((address) => !publicAddress(address))) throw new Error("HTTP target rejected");
  return url;
}

export type HttpProbeResult = { ok: boolean; statusCode: number };

// Perform a GET against a validated public URL, following redirects manually and re-validating every
// hop (so a redirect cannot bounce the request to an internal address). Throws on an unsafe target or
// too many redirects; the caller categorizes the failure.
export async function probeHttp(raw: string, timeoutMs: number, resolver: HostnameResolver = defaultResolver): Promise<HttpProbeResult> {
  let current = raw;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await validateHttpCheckUrl(current, resolver);
    const response = await fetch(current, { method: "GET", signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      if (redirects === 3) throw new Error("Too many redirects");
      current = new URL(location, current).toString();
      continue;
    }
    return { ok: response.ok, statusCode: response.status };
  }
  throw new Error("Too many redirects");
}
