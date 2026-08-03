import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function tarString(header, offset, length) {
  return header.subarray(offset, offset + length).toString("utf8").replace(/\0.*$/s, "");
}

export function readTarGz(file) {
  const tar = gunzipSync(fs.readFileSync(file));
  const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const archivePath = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(tarString(header, 124, 12).trim() || "0", 8);
    const mode = Number.parseInt(tarString(header, 100, 8).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    if (type === "0" || type === "\0") entries.set(archivePath, { data: Buffer.from(tar.subarray(dataStart, dataStart + size)), mode });
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export function verifyEntries(manifest, entries) {
  const expectedPaths = new Set(manifest.trackedFiles.map((entry) => entry.path));
  const actualPaths = new Set(entries.keys());
  for (const file of manifest.trackedFiles) {
    const archived = entries.get(file.path);
    if (!archived) throw new Error(`Archive is missing tracked file: ${file.path}`);
    const executable = Boolean(archived.mode & 0o111);
    if (executable !== (file.mode === "100755")) throw new Error(`Executable mode differs: ${file.path}`);
  }
  for (const file of manifest.protectedShellFiles) {
    const archived = entries.get(file.path);
    if (!archived) throw new Error(`Archive is missing protected shell file: ${file.path}`);
    if (sha256(archived.data) !== file.sha256) throw new Error(`Protected shell bytes differ: ${file.path}`);
    if (archived.data.includes(Buffer.from("\r\n"))) throw new Error(`CRLF detected in protected shell file: ${file.path}`);
  }
  for (const actual of actualPaths) if (!expectedPaths.has(actual)) throw new Error(`Archive contains unexpected file: ${actual}`);
}

export function writeStableJson(file, value) {
  const stable = (item) => Array.isArray(item) ? item.map(stable) : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])])) : item;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(stable(value), null, 2)}\n`, { mode: 0o600 });
}
