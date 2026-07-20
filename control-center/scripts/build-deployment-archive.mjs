import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readTarGz, sha256, verifyEntries, writeStableJson } from "./deployment-archive-lib.mjs";

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function git(root, args, options = {}) { return execFileSync("git", ["-C", root, ...args], { encoding: options.encoding === null ? null : options.encoding ?? "utf8", maxBuffer: 1024 * 1024 * 512 }); }

const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
const requested = argument("--commit");
const output = path.resolve(argument("--output") || path.join(root, "release-output", "deployment"));
if (!/^[a-f0-9]{40}$/.test(requested || "")) throw new Error("--commit must be one exact 40-character commit SHA");
const commit = git(root, ["rev-parse", `${requested}^{commit}`]).trim();
if (commit !== requested) throw new Error("Requested commit did not resolve exactly");
const origin = git(root, ["remote", "get-url", "origin"]).trim();
if (!/(?:github\.com[/:])williams342-maker\/operation(?:\.git)?$/i.test(origin)) throw new Error("Repository identity is not williams342-maker/operation");

const treeRows = git(root, ["ls-tree", "-r", "-z", "--full-tree", commit], { encoding: null }).toString("utf8").split("\0").filter(Boolean).map((row) => {
  const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
  if (!match) throw new Error(`Unsupported tracked entry: ${row.slice(0, 120)}`);
  return { mode: match[1], gitBlob: match[2], path: match[3] };
});
for (const file of treeRows) {
  const base = path.posix.basename(file.path);
  if (base === ".env" || /\.(?:pem|key|p12|pfx)$/i.test(base)) throw new Error(`Forbidden tracked deployment file: ${file.path}`);
}

fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const base = `opsworkbench-${commit.slice(0, 12)}`;
const archive = path.join(output, `${base}.tar.gz`);
const manifestFile = path.join(output, `${base}.integrity.json`);
const temporaryTar = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "opsworkbench-archive-")), `${base}.tar`);
try {
  execFileSync("git", ["-c", "core.autocrlf=false", "-C", root, "archive", "--format=tar", "--output", temporaryTar, commit], { stdio: "pipe" });
  fs.writeFileSync(archive, gzipSync(fs.readFileSync(temporaryTar), { level: 9, mtime: 0 }), { mode: 0o600 });
} finally { fs.rmSync(path.dirname(temporaryTar), { recursive: true, force: true }); }

const entries = readTarGz(archive);
const protectedShellFiles = [];
for (const file of treeRows.filter((item) => item.path.endsWith(".sh") || item.mode === "100755")) {
  const blob = execFileSync("git", ["-C", root, "cat-file", "blob", file.gitBlob], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
  const shell = file.path.endsWith(".sh") || /^#!.*\b(?:ba|z|k)?sh\b/m.test(blob.subarray(0, 256).toString("utf8"));
  if (!shell) continue;
  if (blob.includes(Buffer.from("\r\n"))) throw new Error(`Committed shell script contains CRLF: ${file.path}`);
  protectedShellFiles.push({ ...file, sha256: sha256(blob), lineEndings: "lf" });
}
const manifest = {
  schemaVersion: "opsworkbench-deployment-integrity-v1",
  repository: "williams342-maker/operation",
  commit,
  archive: path.basename(archive),
  archiveSha256: sha256(fs.readFileSync(archive)),
  trackedFiles: treeRows,
  protectedShellFiles
};
verifyEntries(manifest, entries);
writeStableJson(manifestFile, manifest);
process.stdout.write(`${JSON.stringify({ archive, manifest: manifestFile, commit, archiveSha256: manifest.archiveSha256, protectedShellFiles: protectedShellFiles.length })}\n`);
