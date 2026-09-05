#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error("usage: generate-forge-owner-key.mjs <absolute-empty-output-directory>");
fs.mkdirSync(output, { recursive: false, mode: 0o700 });
if (fs.readdirSync(output).length !== 0) throw new Error("owner-key output directory is not empty");
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicDer = publicKey.export({ type: "spki", format: "der" });
fs.writeFileSync(path.join(output, "forge-owner-private.pem"), privatePem, { flag: "wx", mode: 0o600 });
fs.writeFileSync(path.join(output, "forge-owner-public.der"), publicDer, { flag: "wx", mode: 0o600 });
fs.writeFileSync(path.join(output, "forge-owner-public.json"), `${JSON.stringify({
  schemaVersion: "forge-owner-public-key-v1",
  algorithm: "ed25519",
  publicKey: Buffer.from(publicDer).toString("base64url"),
  sha256: crypto.createHash("sha256").update(publicDer).digest("hex"),
}, null, 2)}\n`, { flag: "wx", mode: 0o600 });
process.stdout.write(`${crypto.createHash("sha256").update(publicDer).digest("hex")}\n`);
