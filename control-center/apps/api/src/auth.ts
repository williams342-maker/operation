import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import { hasPermission, type Permission, type Role } from "@control-center/shared";
import { audit } from "./audit.js";
import { collections } from "./db.js";
import { hashCsrfToken, hashSecret, randomToken } from "./crypto.js";
import type { UserDoc } from "./models.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: UserDoc & { _id: ObjectId };
      orgId?: ObjectId;
      sessionId?: ObjectId;
      csrfToken?: string;
    }
  }
}

export function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const idx = part.indexOf("=");
    return [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))];
  }));
}

export function setSessionCookie(res: Response, sessionToken: string) {
  res.cookie("cc_session", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.CONTROL_CENTER_SECURE_COOKIES === "true",
    sameSite: "lax",
    maxAge: 1000 * 60 * 30,
    path: "/"
  });
}

export async function createSession(user: UserDoc & { _id: ObjectId }) {
  const csrfToken = randomToken(24);
  // The session credential is a 256-bit CSPRNG token; only its hash is persisted, so a read of the
  // sessions collection cannot reconstruct a usable cookie, and the value is not derivable/guessable
  // from any identifier the client sees (unlike the former ObjectId cookie).
  const sessionToken = randomToken(32);
  const now = new Date();
  const result = await collections.sessions.insertOne({
    orgId: user.orgId,
    userId: user._id,
    tokenHash: hashSecret(sessionToken),
    csrfTokenHash: hashCsrfToken(csrfToken),
    authenticatedAt: now,
    expiresAt: new Date(now.getTime() + 1000 * 60 * 30),
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now
  });
  return { sessionId: result.insertedId, sessionToken, csrfToken };
}

export function clearSessionCookie(res: Response) {
  res.clearCookie("cc_session", { path: "/" });
}

export async function allowExpiredLogout(req: Request, res: Response, next: NextFunction) {
  const sessionRaw = parseCookies(req.headers.cookie).cc_session;
  if (!sessionRaw) {
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }
  const session = await collections.sessions.findOne({ tokenHash: hashSecret(sessionRaw) });
  if (!session || session.expiresAt <= new Date()) {
    if (session?._id) await collections.sessions.deleteOne({ _id: session._id, orgId: session.orgId });
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }
  next();
}
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionRaw = cookies.cc_session;
  if (!sessionRaw) {
    await audit({ actorType: "anonymous", action: "auth.denied", result: "denied", requestId: req.requestId });
    return res.status(401).json({ error: "Authentication required" });
  }
  const session = await collections.sessions.findOne({ tokenHash: hashSecret(sessionRaw), expiresAt: { $gt: new Date() } });
  if (!session) return res.status(401).json({ error: "Session expired" });
  const user = await collections.users.findOne({ _id: session.userId, orgId: session.orgId, disabledAt: { $exists: false } });
  if (!user?._id) return res.status(401).json({ error: "User unavailable" });
  req.user = user as UserDoc & { _id: ObjectId };
  req.orgId = user.orgId;
  req.sessionId = session._id;
  req.csrfToken = req.header("x-csrf-token") || "";
  await collections.sessions.updateOne({ _id: session._id, orgId: session.orgId }, { $set: { lastSeenAt: new Date(), updatedAt: new Date() } });
  next();
}

export async function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!req.sessionId || !req.orgId) return res.status(401).json({ error: "Authentication required" });
  const session = await collections.sessions.findOne({ _id: req.sessionId, orgId: req.orgId });
  if (!session || hashCsrfToken(req.csrfToken || "") !== session.csrfTokenHash) {
    await audit({
      orgId: req.orgId,
      actorType: "user",
      actorId: req.user?._id,
      action: "authorization.failure",
      result: "denied",
      requestId: req.requestId,
      metadata: { reason: "csrf" }
    });
    return res.status(403).json({ error: "Invalid CSRF token" });
  }
  next();
}

export function requirePermission(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role as Role | undefined;
    if (!role || !hasPermission(role, permission)) {
      await audit({
        orgId: req.orgId,
        actorType: req.user ? "user" : "anonymous",
        actorId: req.user?._id,
        action: "authorization.failure",
        result: "denied",
        requestId: req.requestId,
        metadata: { permission }
      });
      return res.status(403).json({ error: "Insufficient permission" });
    }
    next();
  };
}

export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
  next();
}

export async function requireRecentAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.sessionId || !req.orgId) return res.status(401).json({ error: "Authentication required" });
  const session = await collections.sessions.findOne({ _id: req.sessionId, orgId: req.orgId });
  const authenticatedAt = session?.authenticatedAt || session?.createdAt;
  if (!authenticatedAt || Date.now() - authenticatedAt.getTime() > 10 * 60 * 1000) {
    await audit({
      orgId: req.orgId,
      actorType: req.user ? "user" : "anonymous",
      actorId: req.user?._id,
      action: "authorization.failure",
      result: "denied",
      requestId: req.requestId,
      metadata: { reason: "recent-auth-required" }
    });
    return res.status(403).json({ error: "Recent reauthentication required", code: "RECENT_AUTH_REQUIRED" });
  }
  next();
}
