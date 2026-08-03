import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { sha256 } from "./deployment-archive-lib.mjs";

const requireBash = process.argv.includes("--require-bash");
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const rows = execFileSync("git", ["-C", root, "ls-tree", "-r", "-z", "--full-tree", commit]).toString("utf8").split("\0").filter(Boolean);
const scripts = [];
for (const row of rows) {
  const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
  if (!match) continue;
  const [, mode, oid, relative] = match;
  if (!relative.endsWith(".sh") && mode !== "100755") continue;
  const blob = execFileSync("git", ["-C", root, "cat-file", "blob", oid]);
  if (!relative.endsWith(".sh") && !/^#!.*\b(?:ba|z|k)?sh\b/m.test(blob.subarray(0, 256).toString("utf8"))) continue;
  if (blob.includes(Buffer.from("\r\n"))) throw new Error(`Committed shell script contains CRLF: ${relative}`);
  const checkout = fs.readFileSync(path.join(root, relative));
  if (sha256(checkout) !== sha256(blob)) throw new Error(`Checkout shell bytes differ from Git blob: ${relative}`);
  scripts.push({ relative, mode, sha256: sha256(blob) });
}
const bash = spawnSync("bash", ["--version"], { encoding: "utf8" });
if (requireBash && bash.status !== 0) throw new Error("Bash is required for shell syntax validation");
if (bash.status === 0) for (const script of scripts) {
  const result = spawnSync("bash", ["-n", path.join(root, script.relative)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Bash syntax failed for ${script.relative}: ${result.stderr.trim()}`);
}
process.stdout.write(`${JSON.stringify({ ok: true, commit, scripts: scripts.length, bashSyntaxChecked: bash.status === 0 })}\n`);
