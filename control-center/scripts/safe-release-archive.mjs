import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

const BLOCK = 512;
const text = (buffer, start, length) => buffer.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
const octal = (buffer, start, length) => {
  const value = text(buffer, start, length).trim();
  if (!/^[0-7]*$/.test(value)) throw new Error("tar header contains a non-octal numeric field");
  return value ? Number.parseInt(value, 8) : 0;
};

function safeName(raw) {
  if (!raw || raw.includes("\0") || raw.includes("\\") || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    throw new Error(`unsafe archive member name: ${JSON.stringify(raw)}`);
  }
  const normalized = path.posix.normalize(raw).replace(/\/$/, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized !== raw.replace(/\/$/, "")) {
    throw new Error(`unsafe or non-canonical archive member name: ${JSON.stringify(raw)}`);
  }
  return normalized;
}

export function inspectReleaseTarGz(file, { expectedPrefix, maxBytes = 256 * 1024 * 1024, maxMembers = 20_000 } = {}) {
  const compressed = fs.readFileSync(file);
  const archive = zlib.gunzipSync(compressed, { maxOutputLength: maxBytes });
  const members = new Map();
  let archiveCommit;
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1; offset += BLOCK;
      if (zeroBlocks === 2) break;
      continue;
    }
    if (zeroBlocks) throw new Error("tar has data after an end marker");
    const storedChecksum = octal(header, 148, 8);
    const checksumHeader = Buffer.from(header); checksumHeader.fill(0x20, 148, 156);
    const checksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (checksum !== storedChecksum) throw new Error("tar header checksum mismatch");
    const prefix = text(header, 345, 155);
    const name = safeName(`${prefix ? `${prefix}/` : ""}${text(header, 0, 100)}`);
    const size = octal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] || 0);
    if (typeFlag === "g") {
      if (name !== "pax_global_header" || archiveCommit !== undefined) throw new Error("unexpected or duplicate global PAX header");
      const body = archive.subarray(offset + BLOCK, offset + BLOCK + size).toString("utf8");
      const match = body.match(/^\d+ comment=([0-9a-f]{40})\n$/);
      if (!match || Number.parseInt(body, 10) !== Buffer.byteLength(body)) throw new Error("global PAX header is not the exact Git commit comment");
      archiveCommit = match[1];
      offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    if (expectedPrefix && name !== expectedPrefix && !name.startsWith(`${expectedPrefix}/`)) {
      throw new Error(`archive member escapes expected top-level directory: ${JSON.stringify(name)}`);
    }
    const type = typeFlag === "5" ? "directory" : (typeFlag === "0" || typeFlag === "\0") ? "file" : null;
    if (!type) throw new Error(`archive member has forbidden type ${JSON.stringify(typeFlag)}: ${JSON.stringify(name)}`);
    if (type === "directory" && size !== 0) throw new Error(`archive directory has content bytes: ${JSON.stringify(name)}`);
    if (members.has(name)) throw new Error(`archive member is duplicated: ${JSON.stringify(name)}`);
    const body = archive.subarray(offset + BLOCK, offset + BLOCK + size);
    members.set(name, type === "file"
      ? { type, size, sha256: crypto.createHash("sha256").update(body).digest("hex") }
      : { type, size });
    if (members.size > maxMembers) throw new Error("archive has too many members");
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (offset > archive.length) throw new Error(`archive member is truncated: ${JSON.stringify(name)}`);
  }
  if (zeroBlocks !== 2) throw new Error("tar is missing its two-block end marker");
  if (members.size === 0) throw new Error("archive contains no members");
  if (archive.subarray(offset).some((byte) => byte !== 0)) throw new Error("tar contains non-zero trailing data");
  return { compressedBytes: compressed.length, extractedBytes: archive.length, archiveCommit, members };
}
