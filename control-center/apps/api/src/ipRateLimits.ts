import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import ipaddr from "ipaddr.js";
import type { Request } from "express";

function keyGenerator(request: Request) {
  // Mapped IPv4 is IPv4, not the shared IPv6 ::/56 bucket.
  return ipKeyGenerator(ipaddr.process(request.ip!).toString());
}

export function createIpRateLimits(options: { globalLimit?: number; authLimit?: number; globalWindowMs?: number; authWindowMs?: number } = {}) {
  // v8's built-in ipKeyGenerator normalizes IPv6 and groups /56 prefixes.
  const global = rateLimit({ windowMs: options.globalWindowMs ?? 60_000, limit: options.globalLimit ?? 180, keyGenerator });
  const auth = rateLimit({
    windowMs: options.authWindowMs ?? 15 * 60_000,
    limit: options.authLimit ?? 20,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "staging",
    message: { error: "Too many authentication attempts. Try again later.", code: "RATE_LIMITED" }
  });
  return { global, auth };
}
