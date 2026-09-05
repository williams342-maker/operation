#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const repository = path.resolve(root, "..");
const output = path.resolve(process.argv[2] || "");
const tag = process.env.RELEASE_TAG;
if (!output || !tag || !/^v\d+\.\d+\.\d+-operate$/.test(tag)) throw new Error("output and exact operate release tag are required");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
if (execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: repository, encoding: "utf8" }).trim()) throw new Error("tracked worktree changes are not allowed in an agent release build");
if (execFileSync("git", ["rev-list", "-n", "1", tag], { cwd: repository, encoding: "utf8" }).trim() !== commit) throw new Error("agent release tag does not resolve to HEAD");
const epoch = Math.floor(Date.parse(execFileSync("git", ["show", "-s", "--format=%cI", commit], { cwd: repository, encoding: "utf8" }).trim()) / 1000);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "opsworkbench-release-agent-"));
const tarString = (buffer, offset, length, value) => buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
const octal = (value, length) => `${value.toString(8).padStart(length - 1, "0")}\0`;
function header(name, size, mode, type) { const value = Buffer.alloc(512); if (Buffer.byteLength(name) > 100) throw new Error(`agent release path too long: ${name}`); tarString(value, 0, 100, name); tarString(value, 100, 8, octal(mode, 8)); tarString(value, 108, 8, octal(0, 8)); tarString(value, 116, 8, octal(0, 8)); tarString(value, 124, 12, octal(size, 12)); tarString(value, 136, 12, octal(epoch, 12)); value.fill(0x20, 148, 156); value.write(type, 156); tarString(value, 257, 6, "ustar\0"); tarString(value, 263, 2, "00"); const checksum = [...value].reduce((total, byte) => total + byte, 0); tarString(value, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `); return value; }
function walk(directory, prefix = "") { return fs.readdirSync(directory).sort().flatMap((name) => { const absolute = path.join(directory, name); const relative = `${prefix}${name}`; const stat = fs.lstatSync(absolute); if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`unsupported agent release entry: ${relative}`); return stat.isDirectory() ? [{ absolute, relative: `${relative}/`, directory: true }, ...walk(absolute, `${relative}/`)] : [{ absolute, relative, directory: false }]; }); }
try {
  const packageRoot = path.join(staging, "package");
  const agentOut = path.join(packageRoot, "control-center", "apps", "agent", "dist", "agent.js");
  const updaterOut = path.join(packageRoot, "control-center", "apps", "updater", "dist", "main.js");
  fs.mkdirSync(path.dirname(agentOut), { recursive: true }); fs.mkdirSync(path.dirname(updaterOut), { recursive: true });
  await build({ entryPoints: [path.join(root, "apps", "agent", "src", "agent.ts")], outfile: agentOut, bundle: true, platform: "node", format: "cjs", target: "node22", legalComments: "none", logLevel: "silent" });
  await build({ entryPoints: [path.join(root, "apps", "updater", "src", "main.ts")], outfile: updaterOut, bundle: true, platform: "node", format: "esm", target: "node22", legalComments: "none", logLevel: "silent" });
  fs.writeFileSync(path.join(packageRoot, "control-center", "package.json"), '{"private":true,"type":"module"}\n');
  fs.writeFileSync(path.join(packageRoot, "control-center", "apps", "agent", "package.json"), '{"private":true,"type":"commonjs"}\n');
  const unitDir = path.join(packageRoot, "control-center", "deploy", "systemd"); fs.mkdirSync(unitDir, { recursive: true });
  for (const name of ["opsworkbench-agent.service", "opsworkbench-agent-updater.service", "opsworkbench-agent-updater.path"]) fs.copyFileSync(path.join(root, "deploy", "systemd", name), path.join(unitDir, name));
  const metadata = { schemaVersion: "opsworkbench-agent-release-v1", tag, commit, tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository, encoding: "utf8" }).trim() };
  fs.writeFileSync(path.join(packageRoot, "control-center", "agent-release.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  const chunks = [];
  for (const entry of walk(packageRoot)) { const bytes = entry.directory ? Buffer.alloc(0) : fs.readFileSync(entry.absolute); chunks.push(header(entry.relative, bytes.length, entry.directory ? 0o755 : /\/(agent|main)\.js$/.test(entry.relative) ? 0o755 : 0o644, entry.directory ? "5" : "0"), bytes); const padding = (512 - bytes.length % 512) % 512; if (padding) chunks.push(Buffer.alloc(padding)); }
  chunks.push(Buffer.alloc(1024)); fs.writeFileSync(output, gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 }), { flag: "wx", mode: 0o600 });
  process.stdout.write(`${crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex")}\n`);
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
