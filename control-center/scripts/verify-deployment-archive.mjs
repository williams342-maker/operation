import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readTarGz, sha256, verifyEntries } from "./deployment-archive-lib.mjs";

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
const archive = path.resolve(argument("--archive") || "");
const manifestFile = path.resolve(argument("--manifest") || "");
if (!fs.existsSync(archive) || !fs.statSync(archive).isFile() || !fs.existsSync(manifestFile) || !fs.statSync(manifestFile).isFile()) throw new Error("--archive and --manifest must name existing files");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
if (manifest.schemaVersion !== "opsworkbench-deployment-integrity-v1") throw new Error("Unsupported integrity manifest");
if (manifest.repository !== "williams342-maker/operation") throw new Error("Repository identity mismatch");
if (path.basename(archive) !== manifest.archive) throw new Error("Archive filename mismatch");
if (sha256(fs.readFileSync(archive)) !== manifest.archiveSha256) throw new Error("Archive SHA-256 mismatch");
verifyEntries(manifest, readTarGz(archive));

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
if (execFileSync("git", ["-C", root, "rev-parse", `${manifest.commit}^{commit}`], { encoding: "utf8" }).trim() !== manifest.commit) throw new Error("Manifest commit is unavailable or not exact");
for (const file of manifest.protectedShellFiles) {
  const blob = execFileSync("git", ["-C", root, "cat-file", "blob", file.gitBlob]);
  if (sha256(blob) !== file.sha256) throw new Error(`Manifest shell hash differs from Git blob: ${file.path}`);
}
process.stdout.write(`${JSON.stringify({ ok: true, commit: manifest.commit, archiveSha256: manifest.archiveSha256, protectedShellFiles: manifest.protectedShellFiles.length })}\n`);
