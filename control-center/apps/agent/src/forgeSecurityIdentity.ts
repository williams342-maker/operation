import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { FORGE_OWNER_PUBLIC_KEY, FORGE_OWNER_PUBLIC_KEY_SHA256 } from "./forgeOwnerTrust.js";

export const FORGE_SECURITY_DIR = "/etc/opsworkbench-forge";
export const FORGE_IDENTITY_PATH = `${FORGE_SECURITY_DIR}/identity.json`;
export const FORGE_TRUSTED_ROOT_PATH = `${FORGE_SECURITY_DIR}/trusted-root.json`;
export const FORGE_REVIEW_GATE_CA_PATH = `${FORGE_SECURITY_DIR}/review-gate-ca.pem`;

const sha256 = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");

export const forgeSecurityIdentitySchema = z.object({
  schemaVersion: z.literal("forge-security-identity-v1"),
  orgId: z.string().min(1), serverId: z.string().min(1), ownerPublicKey: z.string().min(1),
  trustedRootSha256: z.string().regex(/^[a-f0-9]{64}$/), reviewGateCaSha256: z.string().regex(/^[a-f0-9]{64}$/), hostname: z.string().min(1),
  machineIdSha256: z.string().regex(/^[a-f0-9]{64}$/), validFrom: z.string().datetime(), validUntil: z.string().datetime(),
  ownerSignature: z.string().min(64).max(256).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
export type ForgeSecurityIdentity = z.infer<typeof forgeSecurityIdentitySchema>;

export type SecurityPathPolicy = {
  directory: string; identityPath: string; trustedRootPath: string; reviewGateCaPath: string; expectedUid: number; expectedGid: number;
  directoryMode: number; fileMode: number; hostname: string; machineId: string; now?: Date; mountInfoPath?: string;
  ancestorBoundary?: string;
  expectedOwnerPublicKey?: string; expectedOwnerPublicKeySha256?: string;
};

export function forgeSecurityIdentityStatement(identity: Omit<ForgeSecurityIdentity, "ownerSignature">): Buffer {
  return Buffer.from([identity.schemaVersion, identity.orgId, identity.serverId, identity.ownerPublicKey,
    identity.trustedRootSha256, identity.reviewGateCaSha256, identity.hostname, identity.machineIdSha256, identity.validFrom,
    identity.validUntil].join("\n"), "utf8");
}

const permissions = (stat: fs.Stats) => stat.mode & 0o777;

function assertTrustedNode(candidate: string, kind: "directory" | "file", policy: SecurityPathPolicy): fs.Stats {
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink()) throw new Error(`Forge security path is a symlink: ${candidate}`);
  if (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) throw new Error(`Forge security path is not a regular ${kind}: ${candidate}`);
  if (stat.uid !== policy.expectedUid || stat.gid !== policy.expectedGid) throw new Error(`Forge security path has wrong owner/group: ${candidate}`);
  const expected = kind === "directory" ? policy.directoryMode : policy.fileMode;
  if (permissions(stat) !== expected) throw new Error(`Forge security path has wrong mode: ${candidate}`);
  return stat;
}

const decodeMountPath = (value: string) => value.replace(/\\040/g, " ").replace(/\\011/g, "\t").replace(/\\012/g, "\n").replace(/\\134/g, "\\");

function assertNotSubstitutedMount(candidates: string[], mountInfoPath: string): void {
  if (!fs.existsSync(mountInfoPath)) throw new Error("Linux mount information is unavailable");
  const forbidden = new Set(candidates.map((candidate) => path.resolve(candidate)));
  const mounted = fs.readFileSync(mountInfoPath, "utf8").split("\n").filter(Boolean).map((line) => {
    const fields = line.split(" ");
    return fields.length > 4 ? path.resolve(decodeMountPath(fields[4])) : "";
  }).find((mountPoint) => forbidden.has(mountPoint));
  if (mounted) throw new Error(`Forge security material must not be a separate or bind mount: ${mounted}`);
}

function readStableRegularFile(file: string, policy: SecurityPathPolicy): Buffer {
  const before = assertTrustedNode(file, "file", policy);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error(`Forge security file changed while opening: ${file}`);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      throw new Error(`Forge security file changed while reading: ${file}`);
    }
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

export function readMachineId(paths = ["/etc/machine-id", "/var/lib/dbus/machine-id"]): string {
  for (const candidate of paths) {
    try { const value = fs.readFileSync(candidate, "utf8").trim(); if (value) return value; } catch { /* next fixed path */ }
  }
  throw new Error("machine identity is unavailable");
}

export function loadForgeSecurityMaterial(policy: SecurityPathPolicy = {
  directory: FORGE_SECURITY_DIR, identityPath: FORGE_IDENTITY_PATH, trustedRootPath: FORGE_TRUSTED_ROOT_PATH,
  reviewGateCaPath: FORGE_REVIEW_GATE_CA_PATH,
  expectedUid: 0, expectedGid: 0, directoryMode: 0o755, fileMode: 0o444,
  hostname: os.hostname(), machineId: readMachineId(), mountInfoPath: "/proc/self/mountinfo",
}): { identity: ForgeSecurityIdentity; trustedRoot: unknown; reviewGateCaPath: string; reviewGateCa: Buffer } {
  const directory = path.resolve(policy.directory);
  const boundary = path.resolve(policy.ancestorBoundary ?? path.parse(directory).root);
  if (directory !== boundary && !directory.startsWith(`${boundary}${path.sep}`)) throw new Error("Forge security directory escapes its trusted boundary");
  if ([policy.identityPath, policy.trustedRootPath, policy.reviewGateCaPath].some((file) => path.dirname(path.resolve(file)) !== directory)) {
    throw new Error("Forge security files must be direct children of the fixed security directory");
  }
  const ancestors: string[] = [];
  for (let cursor = directory; ; cursor = path.dirname(cursor)) {
    ancestors.push(cursor);
    if (cursor === boundary) break;
    if (cursor === path.dirname(cursor)) throw new Error("Forge security directory does not reach its trusted boundary");
  }
  for (const ancestor of ancestors.reverse()) assertTrustedNode(ancestor, "directory", policy);
  if (policy.mountInfoPath) assertNotSubstitutedMount([directory, policy.identityPath, policy.trustedRootPath, policy.reviewGateCaPath], policy.mountInfoPath);
  const identityBytes = readStableRegularFile(policy.identityPath, policy);
  const trustedRootBytes = readStableRegularFile(policy.trustedRootPath, policy);
  const reviewGateCaBytes = readStableRegularFile(policy.reviewGateCaPath, policy);
  const identity = forgeSecurityIdentitySchema.parse(JSON.parse(identityBytes.toString("utf8")));
  const trustedRoot = JSON.parse(trustedRootBytes.toString("utf8")) as unknown;
  if (sha256(trustedRootBytes) !== identity.trustedRootSha256) throw new Error("trusted root digest does not match the security identity");
  if (sha256(reviewGateCaBytes) !== identity.reviewGateCaSha256 || !reviewGateCaBytes.toString("utf8").includes("BEGIN CERTIFICATE")) throw new Error("Review Gate CA does not match the security identity");
  const expectedOwnerPublicKey = policy.expectedOwnerPublicKey ?? FORGE_OWNER_PUBLIC_KEY;
  const expectedOwnerPublicKeySha256 = policy.expectedOwnerPublicKeySha256 ?? FORGE_OWNER_PUBLIC_KEY_SHA256;
  const publicKeyBytes = Buffer.from(identity.ownerPublicKey, "base64url");
  if (identity.ownerPublicKey !== expectedOwnerPublicKey || sha256(publicKeyBytes) !== expectedOwnerPublicKeySha256) throw new Error("owner public key does not match the reviewed release trust anchor");
  const { ownerSignature: _signature, ...unsigned } = identity;
  const key = crypto.createPublicKey({ key: publicKeyBytes, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519" || !crypto.verify(null, forgeSecurityIdentityStatement(unsigned), key, Buffer.from(identity.ownerSignature, "base64url"))) throw new Error("Forge security identity owner signature is invalid");
  if (identity.hostname !== policy.hostname) throw new Error("Forge security identity is bound to a different hostname");
  if (identity.machineIdSha256 !== sha256(policy.machineId)) throw new Error("Forge security identity is bound to a different machine");
  const now = (policy.now ?? new Date()).getTime();
  if (Date.parse(identity.validFrom) > now || Date.parse(identity.validUntil) <= now) throw new Error("Forge security identity is not currently valid");
  return { identity, trustedRoot, reviewGateCaPath: policy.reviewGateCaPath, reviewGateCa: reviewGateCaBytes };
}
