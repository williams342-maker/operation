import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const repository = path.resolve(root, "..");
const proposalFile = path.join(root, "release", "agent-bootstrap-v0.10.0-beta.1.json");
const proposal = JSON.parse(fs.readFileSync(proposalFile, "utf8"));
const version = process.env.BOOTSTRAP_VERSION || proposal.version;
if (version !== proposal.version || !/^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(version)) throw new Error("Bootstrap version must match the reviewed prerelease proposal");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Source commit is invalid");
const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: repository, encoding: "utf8" }).trim();
if (status && process.env.ALLOW_DIRTY_BOOTSTRAP_BUILD !== "true") throw new Error("Tracked worktree changes are not allowed in a release build");
const buildTimestamp = new Date(execFileSync("git", ["show", "-s", "--format=%cI", commit], { cwd: repository, encoding: "utf8" }).trim()).toISOString();
const epochSeconds = Math.floor(new Date(buildTimestamp).getTime() / 1000);
const output = path.resolve(process.env.BOOTSTRAP_OUTPUT_DIR || path.join(repository, "release-output", `agent-bootstrap-${version}`));
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "opsworkbench-agent-bootstrap-build-"));

function cleanOutput() { const resolved = path.resolve(output); const allowed = path.resolve(repository, "release-output"); if (resolved !== allowed && !resolved.startsWith(`${allowed}${path.sep}`) && !process.env.BOOTSTRAP_OUTPUT_DIR) throw new Error("Release output escaped the release-output directory"); fs.rmSync(resolved, { recursive: true, force: true }); fs.mkdirSync(resolved, { recursive: true, mode: 0o700 }); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); return value; }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(stable(value), null, 2)}\n`, { mode: 0o600 }); }
function tarOctal(value, length) { const text = value.toString(8); return `${"0".repeat(length - text.length - 1)}${text}\0`; }
function tarString(buffer, offset, length, value) { buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8"); }
function tarHeader(name, size, mode, type) { if (Buffer.byteLength(name) > 100) throw new Error(`Tar path is too long: ${name}`); const header = Buffer.alloc(512); tarString(header, 0, 100, name); tarString(header, 100, 8, tarOctal(mode, 8)); tarString(header, 108, 8, tarOctal(0, 8)); tarString(header, 116, 8, tarOctal(0, 8)); tarString(header, 124, 12, tarOctal(size, 12)); tarString(header, 136, 12, tarOctal(epochSeconds, 12)); header.fill(0x20, 148, 156); header.write(type, 156, 1, "ascii"); tarString(header, 257, 6, "ustar\0"); tarString(header, 263, 2, "00"); tarString(header, 265, 32, "root"); tarString(header, 297, 32, "root"); const checksum = [...header].reduce((total, byte) => total + byte, 0); tarString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `); return header; }
function walk(directory, prefix = "") { const rows = []; for (const name of fs.readdirSync(directory).sort()) { const absolute = path.join(directory, name); const relative = `${prefix}${name}`; const stat = fs.lstatSync(absolute); if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Unsupported package entry: ${relative}`); if (stat.isDirectory()) { rows.push({ absolute, relative: `${relative}/`, directory: true }); rows.push(...walk(absolute, `${relative}/`)); } else rows.push({ absolute, relative, directory: false }); } return rows; }
function createTarGz(source, destination) { const chunks = []; for (const entry of walk(source)) { const data = entry.directory ? Buffer.alloc(0) : fs.readFileSync(entry.absolute); const executable = /(?:\.sh|\/agent\.js|\/main\.js)$/.test(entry.relative); chunks.push(tarHeader(entry.relative, data.length, entry.directory ? 0o755 : executable ? 0o755 : 0o644, entry.directory ? "5" : "0")); if (!entry.directory) { chunks.push(data); const padding = (512 - (data.length % 512)) % 512; if (padding) chunks.push(Buffer.alloc(padding)); } } chunks.push(Buffer.alloc(1024)); fs.writeFileSync(destination, gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 }), { mode: 0o600 }); }
function artifact(role, filename) { const file = path.join(output, filename); return { role, filename, sizeBytes: fs.statSync(file).size, sha256: sha256(file) }; }

try {
  cleanOutput();
  const packageRoot = path.join(staging, "package");
  const agentOut = path.join(packageRoot, "control-center", "apps", "agent", "dist", "agent.js");
  const updaterOut = path.join(packageRoot, "control-center", "apps", "updater", "dist", "main.js");
  fs.mkdirSync(path.dirname(agentOut), { recursive: true }); fs.mkdirSync(path.dirname(updaterOut), { recursive: true });
  const agentMeta = await build({ entryPoints: [path.join(root, "apps", "agent", "src", "agent.ts")], outfile: agentOut, bundle: true, platform: "node", format: "esm", target: "node22", legalComments: "none", metafile: true, logLevel: "silent" });
  const updaterMeta = await build({ entryPoints: [path.join(root, "apps", "updater", "src", "main.ts")], outfile: updaterOut, bundle: true, platform: "node", format: "esm", target: "node22", legalComments: "none", metafile: true, logLevel: "silent" });
  fs.writeFileSync(path.join(packageRoot, "control-center", "package.json"), '{"private":true,"type":"module"}\n');
  const unitDirectory = path.join(packageRoot, "control-center", "deploy", "systemd"); fs.mkdirSync(unitDirectory, { recursive: true });
  for (const unit of ["opsworkbench-agent.service", "opsworkbench-agent-updater.service", "opsworkbench-agent-updater.path"]) fs.copyFileSync(path.join(root, "deploy", "systemd", unit), path.join(unitDirectory, unit));
  const packageScripts = path.join(packageRoot, "control-center", "scripts"); fs.mkdirSync(packageScripts, { recursive: true }); fs.copyFileSync(path.join(root, "scripts", "rollback-agent-bootstrap.sh"), path.join(packageScripts, "rollback-agent-bootstrap.sh"));
  const packageName = `opsworkbench-agent-${version}-linux-x64.tar.gz`; createTarGz(packageRoot, path.join(output, packageName));
  const manifestName = `opsworkbench-agent-bootstrap-${version}.manifest.json`;
  const installerName = `opsworkbench-agent-bootstrap-${version}.sh`;
  const installer = fs.readFileSync(path.join(root, "scripts", "bootstrap-agent-release.sh"), "utf8").replaceAll("@RELEASE_VERSION@", version).replaceAll("@MANIFEST_NAME@", manifestName); fs.writeFileSync(path.join(output, installerName), installer, { mode: 0o700 });
  const rollbackName = `opsworkbench-agent-rollback-${version}.sh`; fs.copyFileSync(path.join(root, "scripts", "rollback-agent-bootstrap.sh"), path.join(output, rollbackName)); fs.chmodSync(path.join(output, rollbackName), 0o700);
  for (const unit of ["opsworkbench-agent.service", "opsworkbench-agent-updater.service", "opsworkbench-agent-updater.path"]) fs.copyFileSync(path.join(root, "deploy", "systemd", unit), path.join(output, unit));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")); const bundledInputs = [...Object.keys(agentMeta.metafile.inputs), ...Object.keys(updaterMeta.metafile.inputs)].map((name) => name.replaceAll("\\", "/")); const bundledPackages = new Set(); for (const input of bundledInputs) { const marker = input.lastIndexOf("node_modules/"); if (marker < 0) continue; const parts = input.slice(marker + "node_modules/".length).split("/"); bundledPackages.add(parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]); } const components = []; for (const name of [...bundledPackages].sort()) { const value = lock.packages?.[`node_modules/${name}`] || {}; components.push({ type: "library", name, version: value.version || "unknown", hashes: value.integrity ? [{ alg: "SHA-512", content: value.integrity.replace(/^sha512-/, "") }] : undefined }); }
  const sbomName = `opsworkbench-agent-${version}.cdx.json`; writeJson(path.join(output, sbomName), { bomFormat: "CycloneDX", specVersion: "1.5", serialNumber: `urn:uuid:${crypto.createHash("sha256").update(`${commit}:${version}`).digest("hex").replace(/^(........)(....)(....)(....)(............).*/, "$1-$2-$3-$4-$5")}`, version: 1, metadata: { timestamp: buildTimestamp, component: { type: "application", name: "opsworkbench-agent-bootstrap", version, properties: [{ name: "opsworkbench:source-commit", value: commit }] } }, components: components.sort((a, b) => a.name.localeCompare(b.name)) });
  const metadataName = `opsworkbench-agent-bootstrap-${version}.build.json`; writeJson(path.join(output, metadataName), { ...proposal, schemaVersion: "opsworkbench-agent-bootstrap-build-v1", sourceCommit: commit, buildTimestamp, manifestName, packageName, installerName, rollbackName, sbomName, preliminaryArtifacts: [artifact("agent_package", packageName), artifact("bootstrap_installer", installerName), artifact("rollback_script", rollbackName), artifact("sbom", sbomName), ...["opsworkbench-agent.service", "opsworkbench-agent-updater.service", "opsworkbench-agent-updater.path"].map((name) => artifact("systemd_unit", name))] });
  process.stdout.write(`${output}\n`);
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
