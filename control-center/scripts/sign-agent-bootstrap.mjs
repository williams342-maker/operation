import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const output = path.resolve(process.env.BOOTSTRAP_OUTPUT_DIR || "");
const privateKeyFile = process.env.BOOTSTRAP_SIGNING_PRIVATE_KEY_FILE;
const publicKeyFile = process.env.BOOTSTRAP_SIGNING_PUBLIC_KEY_FILE;
const artifactUrl = process.env.BOOTSTRAP_ARTIFACT_URL;
const publicationStatus = process.env.BOOTSTRAP_PUBLICATION_STATUS || "draft";
if (!output || !privateKeyFile || !publicKeyFile || !artifactUrl) throw new Error("Output directory, private/public key files, and artifact URL are required");
if (!fs.statSync(privateKeyFile).isFile() || !fs.statSync(publicKeyFile).isFile()) throw new Error("Signing key input is invalid");
if (!/^https:\/\//.test(artifactUrl)) throw new Error("Artifact URL must use HTTPS");
if (!/^(draft|published)$/.test(publicationStatus)) throw new Error("Publication status is invalid");
const metadataFile = fs.readdirSync(output).find((name) => /^opsworkbench-agent-bootstrap-.+\.build\.json$/.test(name));
if (!metadataFile) throw new Error("Bootstrap build metadata is missing");
const metadata = JSON.parse(fs.readFileSync(path.join(output, metadataFile), "utf8"));
const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyFile)); const publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyFile));
const probe = Buffer.from("opsworkbench-agent-signing-key-check"); const probeSignature = crypto.sign(null, probe, privateKey); if (!crypto.verify(null, probe, publicKey, probeSignature)) throw new Error("Private and public signing keys do not match");
if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 signing keys are required");
const publicDer = publicKey.export({ type: "spki", format: "der" }); const fingerprint = crypto.createHash("sha256").update(publicDer).digest("hex"); const signingKeyId = `ed25519-${fingerprint.slice(0, 24)}`;
const packageArtifact = metadata.preliminaryArtifacts.find((item) => item.role === "agent_package"); if (!packageArtifact) throw new Error("Agent package artifact is missing");
const packageFile = path.join(output, packageArtifact.filename); const artifactSignature = crypto.sign(null, fs.readFileSync(packageFile), privateKey).toString("base64"); const artifactSignatureName = `${packageArtifact.filename}.sig`; fs.writeFileSync(path.join(output, artifactSignatureName), `${artifactSignature}\n`, { mode: 0o600 });

function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); return value; }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(stable(value), null, 2)}\n`, { mode: 0o600 }); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function artifact(role, filename) { const file = path.join(output, filename); return { role, filename, sizeBytes: fs.statSync(file).size, sha256: sha256(file) }; }
function catalogDigest(release) { const canonical = { id: release.id, version: release.version, protocolVersion: release.protocolVersion, minimumSourceVersion: release.minimumSourceVersion, supportedOperatingSystems: [...release.supportedOperatingSystems].sort(), supportedArchitectures: [...release.supportedArchitectures].sort(), packageType: release.packageType, channel: release.channel, artifactUrl: release.artifactUrl, artifactSha256: release.artifactSha256, artifactSizeBytes: release.artifactSizeBytes, artifactSignature: release.artifactSignature, signatureKeyId: release.signatureKeyId, requiredCapabilities: [...release.requiredCapabilities].sort(), upgradeFrom: [...release.upgradeFrom].sort(), rollbackTo: [...release.rollbackTo].sort(), classification: release.classification }; return crypto.createHash("sha256").update(JSON.stringify(canonical, Object.keys(canonical).sort())).digest("hex"); }

const catalogBase = { id: metadata.releaseId, version: metadata.version, protocolVersion: metadata.protocolVersion, minimumSourceVersion: metadata.minimumSourceVersion, supportedOperatingSystems: metadata.supportedOperatingSystems, supportedArchitectures: metadata.supportedArchitectures, packageType: metadata.packageType, channel: metadata.channel, artifactUrl, artifactSha256: packageArtifact.sha256, artifactSizeBytes: packageArtifact.sizeBytes, artifactSignature, signatureKeyId: signingKeyId, requiredCapabilities: metadata.requiredCapabilities, upgradeFrom: metadata.upgradeFrom, rollbackTo: metadata.rollbackTo, classification: "mandatory" };
const manifestDigest = catalogDigest(catalogBase); const manifestSignature = crypto.sign(null, Buffer.from(manifestDigest, "hex"), privateKey).toString("base64");
const catalogEntry = { ...catalogBase, manifestDigest, manifestSignature, publicationStatus, revoked: false };
const catalogName = `opsworkbench-agent-${metadata.version}.release-catalog.json`; writeJson(path.join(output, catalogName), [catalogEntry]);
const publicKeyName = `opsworkbench-agent-${signingKeyId}.public.pem`; fs.writeFileSync(path.join(output, publicKeyName), publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
const artifacts = [...metadata.preliminaryArtifacts, artifact("artifact_signature", artifactSignatureName), artifact("release_catalog", catalogName), artifact("public_key", publicKeyName)].sort((a, b) => a.filename.localeCompare(b.filename));
const manifest = { schemaVersion: "opsworkbench-agent-bootstrap-v1", releaseId: metadata.releaseId, version: metadata.version, protocolVersion: metadata.protocolVersion, buildTimestamp: metadata.buildTimestamp, sourceCommit: metadata.sourceCommit, supportedOperatingSystems: metadata.supportedOperatingSystems, supportedDistributions: metadata.supportedDistributions, supportedArchitectures: metadata.supportedArchitectures, packageType: metadata.packageType, minimumSourceVersion: metadata.minimumSourceVersion, maximumSourceVersion: metadata.maximumSourceVersion, artifacts, requiredCapabilities: metadata.requiredCapabilities, channel: metadata.channel, upgradeFrom: metadata.upgradeFrom, rollbackTo: metadata.rollbackTo, publicationStatus, revoked: false, signingKeyId, nonProductionOnly: true };
const manifestFile = path.join(output, metadata.manifestName); writeJson(manifestFile, manifest); const manifestSignatureValue = crypto.sign(null, fs.readFileSync(manifestFile), privateKey).toString("base64"); fs.writeFileSync(`${manifestFile}.sig`, `${manifestSignatureValue}\n`, { mode: 0o600 });
const checksumFiles = fs.readdirSync(output).filter((name) => name !== "SHA256SUMS").sort(); fs.writeFileSync(path.join(output, "SHA256SUMS"), checksumFiles.map((name) => `${sha256(path.join(output, name))}  ${name}`).join("\n") + "\n", { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ signingKeyId, manifestDigest: sha256(manifestFile), catalogManifestDigest: manifestDigest, publicationStatus })}\n`);
