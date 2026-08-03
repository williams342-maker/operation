import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import { isFreshTimestamp, verifyRequestSignature, verifyAgentRequestV2, acceptedSchemes, describeAgentCredential } from "@control-center/shared";
import { audit } from "./audit.js";
import { collections } from "./db.js";
import { agentV2Enabled } from "./agentProtocolFlag.js";
import type { ServerDoc } from "./models.js";

declare global {
  namespace Express {
    interface Request {
      agentServer?: ServerDoc & { _id: ObjectId };
      rawBodyText?: string;
    }
  }
}

export function captureRawBody(req: Request, _res: Response, buf: Buffer) {
  req.rawBodyText = buf.toString("utf8");
}

export async function requireSignedAgent(req: Request, res: Response, next: NextFunction) {
  const agentId = req.header("x-agent-id") || "";
  const timestamp = req.header("x-agent-timestamp") || "";
  const nonce = req.header("x-agent-nonce") || "";
  const signature = req.header("x-agent-signature") || "";
  if (!agentId || !timestamp || !nonce || !signature) {
    await audit({ actorType: "anonymous", action: "authorization.failure", result: "denied", requestId: req.requestId, metadata: { reason: "unsigned-agent-request" } });
    return res.status(401).json({ error: "Signed agent request required" });
  }
  if (!isFreshTimestamp(timestamp)) {
    await audit({ actorType: "agent", actorId: agentId, action: "authorization.failure", result: "denied", requestId: req.requestId, metadata: { reason: "stale-signature" } });
    return res.status(401).json({ error: "Stale request" });
  }
  const server = await collections.servers.findOne({ agentId, revokedAt: { $exists: false } });
  if (!server?._id) {
    await audit({ actorType: "agent", actorId: agentId, action: "authorization.failure", result: "denied", requestId: req.requestId, metadata: { reason: "unknown-agent" } });
    return res.status(401).json({ error: "Unknown agent" });
  }
  // Verify the signature BEFORE consuming the nonce. Otherwise an attacker who knows a (non-secret)
  // agentId could write unbounded nonce rows with garbage signatures — a side effect on a request
  // that never authenticates. Replay is still blocked below by the unique {orgId,agentId,nonce} index.
  //
  // Scheme selection (dual-accept): with the flag OFF, only agent-v1 (legacy HMAC) is accepted. With
  // it ON, the per-agent migration state decides (legacy→v1, dual→v1|v2, v2→v2). The declared version
  // must be in the accepted set (no silent downgrade), and for v2 it is also bound into the signature.
  const parts = { method: req.method, path: req.originalUrl.split("?")[0], timestamp, nonce, body: req.rawBodyText || "" };
  const declaredVersion = req.header("x-agent-key-version") || "agent-v1";
  const schemes = agentV2Enabled() ? acceptedSchemes(describeAgentCredential(server).migrationState) : ["agent-v1"];
  let valid = false;
  if (schemes.includes(declaredVersion as "agent-v1" | "agent-v2")) {
    valid = declaredVersion === "agent-v2"
      ? Boolean(server.signingPublicKey) && verifyAgentRequestV2(server.signingPublicKey!, { ...parts, protocolVersion: "agent-v2" }, signature)
      : verifyRequestSignature(server.agentSecretHash, parts, signature);
  }
  if (!valid) {
    await audit({ orgId: server.orgId, actorType: "agent", actorId: agentId, action: "authorization.failure", result: "denied", requestId: req.requestId, metadata: { reason: "bad-signature" } });
    return res.status(401).json({ error: "Invalid signature" });
  }
  try {
    await collections.agentNonces.insertOne({
      orgId: server.orgId,
      agentId,
      nonce,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date()
    });
  } catch {
    await audit({ orgId: server.orgId, actorType: "agent", actorId: agentId, action: "authorization.failure", result: "denied", requestId: req.requestId, metadata: { reason: "duplicate-nonce" } });
    return res.status(401).json({ error: "Duplicate nonce" });
  }
  req.agentServer = server as ServerDoc & { _id: ObjectId };
  next();
}

