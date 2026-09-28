import { isIP } from "node:net";
import type { RequestHandler } from "express";
import proxyaddr from "proxy-addr";

// Trust identities, not a hop count: admin and public paths can differ.
export function parseTrustedProxies(value?: string): string[] {
  if (!value?.trim()) return [];
  const entries = value.split(",").map((entry) => entry.trim());
  for (const entry of entries) {
    if (entry === "loopback") continue;
    const [address, prefix, extra] = entry.split("/");
    const family = isIP(address);
    if (!family || extra !== undefined || (prefix !== undefined && prefix !== String(family === 4 ? 32 : 128))) {
      throw new Error("CONTROL_CENTER_TRUST_PROXY requires individual proxy IP addresses (/32 or /128), or loopback; booleans, hop counts and subnet trust are forbidden.");
    }
    if (address === "0.0.0.0" || address === "::") throw new Error("Unspecified proxy addresses are forbidden.");
  }
  return entries;
}

export function clientIdentityGuard(trusted: string[]): RequestHandler {
  const trust = proxyaddr.compile(trusted);
  return (req, res, next) => {
    const peer = req.socket.remoteAddress;
    if (!peer || !isIP(peer)) return res.status(400).json({ code: "INVALID_CLIENT_IP" });
    if (!trust(peer, 0)) {
      // Direct clients cannot select their identity using forwarding headers.
      for (const name of ["x-forwarded-for", "x-real-ip", "cf-connecting-ip", "forwarded"]) delete req.headers[name];
      return next();
    }
    const forwarded = req.headers["x-forwarded-for"];
    // Preserve local health checks for the existing loopback-only configuration.
    if (forwarded === undefined && trusted.length === 1 && trusted[0] === "loopback") return next();
    if (typeof forwarded !== "string" || forwarded.length > 2048 || !forwarded.split(",").every((ip) => Boolean(isIP(ip.trim())))) {
      return res.status(400).json({ code: "INVALID_CLIENT_IP" });
    }
    if (!req.ip || !isIP(req.ip)) return res.status(400).json({ code: "INVALID_CLIENT_IP" });
    next();
  };
}
