import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      admin?: { sub: string; role: string };
    }
  }
}

const csrfTokens = new Set<string>();

export function issueCsrfToken() {
  const token = crypto.randomBytes(32).toString("hex");
  csrfTokens.add(token);
  setTimeout(() => csrfTokens.delete(token), 1000 * 60 * 60);
  return token;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (process.env.DASHBOARD_AUTH_DISABLED === "true") {
    req.admin = { sub: "local-dev", role: "admin" };
    return next();
  }
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Missing bearer token" });
  const secret = process.env.DASHBOARD_JWT_SECRET;
  if (!secret) return res.status(500).json({ error: "DASHBOARD_JWT_SECRET is not configured" });
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (payload.role !== "admin") return res.status(403).json({ error: "Admin role required" });
    req.admin = { sub: String(payload.sub || "admin"), role: "admin" };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (process.env.DASHBOARD_AUTH_DISABLED === "true") return next();
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const token = req.header("x-csrf-token") || "";
  if (!token || !csrfTokens.has(token)) return res.status(403).json({ error: "Invalid CSRF token" });
  return next();
}

export function redact(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 24))}${value.slice(-2)}`;
}

export function isSecretKey(key: string) {
  return /(SECRET|TOKEN|KEY|PASSWORD|PRIVATE|WEBHOOK|URI|URL|DSN|SALT)/i.test(key);
}
