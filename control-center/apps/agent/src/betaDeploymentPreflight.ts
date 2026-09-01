import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFixed, type ExecResult } from "./safeExec.js";
import { parseEnvironment } from "./configurationDeployment.js";
import { loadAndVerifyForgeEvidence, type ForgeEvidencePaths } from "./forgePreflightEvidence.js";

export const BETA_STARTUP_SAFETY_FLAGS = [
  "DEPLOY_WATCH_ENABLED",
  "STARTUP_DB_BOOTSTRAP_ENABLED",
  "SCHEDULER_ENABLED",
  "STARTUP_SEO_ENABLED",
  "EMAIL_JOBS_ENABLED",
  "PAYMENT_JOBS_ENABLED",
  "PAYOUT_JOBS_ENABLED",
  "WEBHOOK_JOBS_ENABLED",
  "CAMPAIGN_JOBS_ENABLED",
  "NOTIFICATION_JOBS_ENABLED",
  "EXTERNAL_SYNC_JOBS_ENABLED",
  "R2_SELF_CHECK_ON_STARTUP",
] as const;

export type BetaDeploymentPreflightInput = {
  targetEnvironment: string;
  composeWorkingDirectory: string;
  composeProjectName: string;
  composeFilePath: string;
  environmentFilePath: string;
  composeOverrideFilePath: string;
  // Option 1 rollback (docs/forge-manifest-spec.md §8.4): rollback is a SECOND reviewed override, not a
  // `docker image tag` retag. Retagging requires mutable tag references, and a mutable tag is the exact
  // hazard this preflight exists to prevent — it lets the bytes behind an approved name change between
  // approval and execution.
  //
  // OPTIONAL, and that is a correction. Making it required changed behaviour for every existing caller
  // even when no Forge evidence was supplied, so the change was not inert — an independent review
  // (2026-09-01) caught the claim. When it is absent the legacy retag command is emitted unchanged.
  // When Forge evidence IS supplied it becomes mandatory, because digest-pinned images cannot be
  // retagged at all.
  rollbackComposeOverrideFilePath?: string;
  serviceEnvironmentReferencePath?: string;
  authorizedBackendImage: string;
  authorizedFrontendImage: string;
  rollbackBackendImage: string;
  rollbackFrontendImage: string;
  authorizedServices: string[];
  allowedComposeServices: string[];
  allowedHostnames: string[];
  allowedDatabaseDestinations: Array<{ hostname: string; databaseName: string }>;
  /** Capabilities the target agent advertises. Only consulted when Forge evidence is supplied. */
  agentAdvertisedCapabilities?: string[];
  // The identity of the machine this preflight is ACTUALLY running against, read from the agent's own
  // configuration rather than typed by the operator. Signing a target id into a binding creates no
  // binding at all unless the verifier measures the target and compares — an independent review
  // (2026-09-01) found an authorization for server A passed on server B. Required whenever Forge
  // evidence is supplied.
  actualOrgId?: string;
  actualServerId?: string;
  /** Nonces already consumed on this host. Supplied by the CLI from a persistent store. */
  consumedNonces?: string[];
} & ForgeEvidencePaths;

export type ImageInspection = {
  id: string;
  repoTags: string[];
  repoDigests?: string[];
  revision?: string;
};

export type PreflightHooks = {
  composeConfig?: (args: string[], cwd: string) => Promise<ExecResult>;
  inspectImage?: (image: string, cwd: string) => Promise<ImageInspection | null>;
  now?: () => Date;
  // Test seam, same pattern as composeConfig/inspectImage above: a FUNCTION parameter, never a field of
  // the operator-supplied input JSON. Production callers (betaDeploymentPreflightCli.ts) pass no hooks,
  // so there is no path by which input data can substitute evidence verification. Real Sigstore
  // verification is proven separately in test/forgeAttestation.test.ts against a genuine published
  // bundle; this seam exists so the checks DOWNSTREAM of it can be proven without a live Fulcio.
  verifyEvidence?: (paths: ForgeEvidencePaths, context: { agentAdvertisedCapabilities: readonly string[]; consumedNonces?: ReadonlySet<string>; now?: number }) => ReturnType<typeof loadAndVerifyForgeEvidence>;
};

type Check = { name: string; passed: boolean; detail: string };
type ComposeService = {
  image?: string;
  environment?: Record<string, unknown> | string[];
  networks?: unknown;
  volumes?: unknown;
  healthcheck?: unknown;
  restart?: string;
  build?: { args?: Record<string, unknown> } | string;
};
type ComposeModel = { name?: string; services?: Record<string, ComposeService>; networks?: unknown; volumes?: unknown };

export type BetaDeploymentPreflightResult = {
  status: "PASS — awaiting operator approval" | "BLOCKED" | "ERROR";
  checks: Check[];
  report: {
    targetEnvironment: string;
    composeProjectName: string;
    composeFilePath: string;
    environmentFilePath: string;
    composeOverrideFilePath: string;
    environmentFileSha256?: string;
    composeOverrideFileSha256?: string;
    rollbackComposeOverrideFileSha256?: string;
    composeConfigSha256?: string;
    servicesAffected: string[];
    servicesExcluded: string[];
    mongoDbRecreation: "blocked";
    mongoDbServiceIncluded: "no" | "yes";
    volumeRecreation: "no";
    startupSafetyFlags: Record<string, "PASS" | "FAIL">;
    databaseDestination?: { sourceVariable: string; hostname: string; databaseName: string; classification: "approved-beta" | "blocked" };
    images?: Record<string, { reference: string; id: string; revision?: string }>;
    deploymentCommand?: string;
    rollbackCommand?: string;
    forge?: {
      state: "absent" | "verified" | "rejected";
      sourceCommit?: string;
      sourceTree?: string;
      buildDigest?: string;
      rollbackSourceCommit?: string;
      bindingDigest?: string;
      builderIdentity?: string;
      bindingNonce?: string;
      ownerNonce?: string;
    };
    preflightTimestamp: string;
    operatorApprovalStatus: "awaiting" | "not-available";
  };
};

const sha256 = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const serviceLooksStateful = (name: string) => /(^|[-_.])(mongo|mongodb|database|db|migration|migrate)([-_.]|$)/i.test(name);
const safeRef = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,511}$/.test(value);
const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

function environmentObject(raw: ComposeService["environment"]) {
  const result = new Map<string, string>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const split = entry.indexOf("=");
      const key = split < 0 ? entry : entry.slice(0, split);
      const value = split < 0 ? "" : entry.slice(split + 1);
      if (result.has(key) && result.get(key) !== value) throw new Error(`Conflicting resolved environment definition: ${key}`);
      result.set(key, value);
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) result.set(key, value == null ? "" : String(value));
  }
  return result;
}

function collectDestinations(value: unknown, found: Set<string>) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\/\/[^\s"',]+/gi)) {
      try { found.add(new URL(match[0]).hostname.toLowerCase()); } catch { found.add("<malformed>"); }
    }
    return;
  }
  if (Array.isArray(value)) for (const item of value) collectDestinations(item, found);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectDestinations(item, found);
}

// Parameterised over the expected pair so the deployment override and the rollback override are held to
// the SAME rule: exactly two services, exactly one `image` key each, exactly the expected references.
function validateImageOverride(raw: string, expected: { backend: string; frontend: string }) {
  const parsed = JSON.parse(raw) as { services?: Record<string, Record<string, unknown>> };
  const services = parsed.services || {};
  if (Object.keys(parsed).length !== 1 || Object.keys(services).sort().join(",") !== "backend,frontend") throw new Error("Image override must contain exactly backend and frontend services");
  for (const [name, image] of Object.entries(expected)) {
    const service = services[name];
    if (!service || Object.keys(service).join(",") !== "image" || service.image !== image) throw new Error(`Image override is invalid for ${name}`);
  }
}

export type BetaPreflightTemporaryFileHooks = {
  createReference?: (target: string, reference: string) => void;
  readReference?: (reference: string) => string;
  remove?: (target: string) => void;
};

export async function withBetaPreflightTemporaryFiles<T>(input: BetaDeploymentPreflightInput, action: () => Promise<T>, hooks: BetaPreflightTemporaryFileHooks = {}) {
  const reference = input.serviceEnvironmentReferencePath ? path.resolve(input.serviceEnvironmentReferencePath) : undefined;
  const override = path.resolve(input.composeOverrideFilePath);
  const rollbackOverride = input.rollbackComposeOverrideFilePath ? path.resolve(input.rollbackComposeOverrideFilePath) : undefined;
  const workingDirectory = path.resolve(input.composeWorkingDirectory);
  const created: string[] = [];
  let result: T | undefined;
  let failure: unknown;
  try {
    if (rollbackOverride && override === rollbackOverride) throw new Error("Rollback override must be a distinct path from the deployment override");
    // Both overrides get identical treatment: inside the working directory, exclusive creation, mode
    // 0600, never overwriting an existing path, and removed in the finally block below. The rollback
    // override is a deployment input too, and a weaker rule on it would be the weakest link.
    for (const [label, target, images] of [
      ["Image override", override, { backend: input.authorizedBackendImage, frontend: input.authorizedFrontendImage }],
      ...(rollbackOverride ? [["Rollback image override", rollbackOverride, { backend: input.rollbackBackendImage, frontend: input.rollbackFrontendImage }] as const] : [])
    ] as const) {
      if (!target.startsWith(`${workingDirectory}${path.sep}`)) throw new Error(`${label} must be inside the Compose working directory`);
      if (fs.existsSync(target)) throw new Error(`${label} path already exists`);
      fs.writeFileSync(target, `${JSON.stringify({ services: { backend: { image: images.backend }, frontend: { image: images.frontend } } }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      created.push(target);
    }
    if (reference) {
      if (!reference.startsWith(`${workingDirectory}${path.sep}`)) throw new Error("Service environment reference must be inside the Compose working directory");
      if (fs.existsSync(reference) || fs.lstatSync(path.dirname(reference)).isSymbolicLink()) throw new Error("Service environment reference path is unsafe or already exists");
      const expectedTarget = path.resolve(input.environmentFilePath);
      (hooks.createReference || ((target, destination) => fs.symlinkSync(target, destination, "file")))(expectedTarget, reference);
      created.push(reference);
      if ((hooks.readReference || fs.readlinkSync)(reference) !== expectedTarget) throw new Error("Service environment reference target does not match the authorized environment file");
    }
    result = await action();
  } catch (error) {
    failure = error;
  } finally {
    try {
      for (const target of created.reverse()) (hooks.remove || ((item) => fs.rmSync(item, { force: true })))(target);
      if (created.some((target) => fs.existsSync(target))) failure ||= new Error("Temporary preflight cleanup failed");
    } catch (error) {
      failure ||= error;
    }
  }
  if (failure) throw failure;
  return result as T;
}

async function defaultInspectImage(image: string, cwd: string): Promise<ImageInspection | null> {
  const result = await execFixed("docker", ["image", "inspect", image, "--format", "{{json .}}"], cwd, 15_000);
  if (result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as { Id?: string; RepoTags?: string[]; RepoDigests?: string[]; Config?: { Labels?: Record<string, string> } };
    return { id: parsed.Id || "", repoTags: parsed.RepoTags || [], repoDigests: parsed.RepoDigests || [], revision: parsed.Config?.Labels?.["org.opencontainers.image.revision"] };
  } catch { return null; }
}

export async function runBetaDeploymentPreflight(input: BetaDeploymentPreflightInput, hooks: PreflightHooks = {}): Promise<BetaDeploymentPreflightResult> {
  const checks: Check[] = [];
  const now = (hooks.now || (() => new Date()))();
  const normalizedEnvironment = input.targetEnvironment.trim().toLowerCase();
  const report: BetaDeploymentPreflightResult["report"] = {
    targetEnvironment: normalizedEnvironment || "<missing>",
    composeProjectName: input.composeProjectName,
    composeFilePath: input.composeFilePath,
    environmentFilePath: input.environmentFilePath,
    composeOverrideFilePath: input.composeOverrideFilePath,
    servicesAffected: [...input.authorizedServices],
    servicesExcluded: [],
    mongoDbRecreation: "blocked",
    mongoDbServiceIncluded: input.authorizedServices.some(serviceLooksStateful) ? "yes" : "no",
    volumeRecreation: "no",
    startupSafetyFlags: Object.fromEntries(BETA_STARTUP_SAFETY_FLAGS.map((flag) => [flag, "FAIL"])) as Record<string, "PASS" | "FAIL">,
    preflightTimestamp: now.toISOString(),
    operatorApprovalStatus: "not-available",
  };
  const block = (name: string, detail: string) => checks.push({ name, passed: false, detail });
  const pass = (name: string, detail: string) => checks.push({ name, passed: true, detail });

  // Forge evidence (docs/forge-manifest-spec.md §8.2). Runs first so that bad evidence blocks before
  // anything else is considered. INERT when no evidence is supplied: with no Forge paths the preflight
  // behaves exactly as it did before this existed.
  const forge = (hooks.verifyEvidence || loadAndVerifyForgeEvidence)(input, { agentAdvertisedCapabilities: input.agentAdvertisedCapabilities || [], consumedNonces: new Set(input.consumedNonces || []), now: now.getTime() });
  report.forge = { state: forge.state === "verified" ? "verified" : forge.state === "absent" ? "absent" : "rejected" };
  if (forge.state === "verified") {
    // The nonces are surfaced so the CLI can consume them persistently after a PASS. They are opaque
    // replay markers, not secrets.
    report.forge = { state: "verified", sourceCommit: forge.candidate.sourceCommit, sourceTree: forge.candidate.sourceTree, buildDigest: forge.binding.buildDigest, rollbackSourceCommit: forge.rollback.sourceCommit, bindingDigest: forge.bindingDigest, builderIdentity: forge.candidate.builderIdentity, bindingNonce: forge.nonces[0], ownerNonce: forge.nonces[1] };
  }

  try {
    if (forge.state === "incomplete") block("forge_evidence", `Incomplete Forge evidence: ${forge.missing.length} required document(s) missing`);
    if (forge.state === "unreadable") block("forge_evidence", "Forge evidence could not be read");
    if (forge.state === "rejected") block("forge_evidence", `Forge evidence rejected: ${forge.reason}`);
    if (forge.state === "verified") pass("forge_evidence", "Candidate and rollback builds attested; binding owner-authorized");
    if (normalizedEnvironment !== "beta") block("target_environment", "Target must resolve exactly to beta");
    else pass("target_environment", "Resolved target: beta");
    for (const [name, value] of Object.entries({ composeWorkingDirectory: input.composeWorkingDirectory, composeProjectName: input.composeProjectName, composeFilePath: input.composeFilePath, environmentFilePath: input.environmentFilePath, composeOverrideFilePath: input.composeOverrideFilePath })) {
      if (!value?.trim()) block(name, "Required operator input is missing");
    }
    for (const [name, value] of Object.entries({ authorizedBackendImage: input.authorizedBackendImage, authorizedFrontendImage: input.authorizedFrontendImage, rollbackBackendImage: input.rollbackBackendImage, rollbackFrontendImage: input.rollbackFrontendImage })) {
      if (!safeRef(value || "")) block(name, "Image reference is missing or unsafe");
    }
    if (!input.authorizedServices.length) block("authorized_services", "At least one service is required");
    if (input.authorizedServices.some(serviceLooksStateful)) block("mongodb_exclusion", "Database or migration service is included in the recreation list");
    else pass("mongodb_exclusion", "MongoDB recreation blocked; no database service authorized");
    if (new Set(input.authorizedServices).size !== input.authorizedServices.length) block("authorized_services", "Duplicate service authorization");

    const workingDirectory = path.resolve(input.composeWorkingDirectory);
    const composeFile = path.resolve(input.composeFilePath);
    const environmentFile = path.resolve(input.environmentFilePath);
    const composeOverrideFile = path.resolve(input.composeOverrideFilePath);
    const rollbackOverrideFile = input.rollbackComposeOverrideFilePath ? path.resolve(input.rollbackComposeOverrideFilePath) : undefined;
    if (!fs.existsSync(workingDirectory) || !fs.statSync(workingDirectory).isDirectory()) block("working_directory", "Compose working directory does not exist");
    if (!fs.existsSync(composeFile) || !fs.statSync(composeFile).isFile()) block("compose_file", "Compose file does not exist");
    if (!fs.existsSync(environmentFile) || !fs.statSync(environmentFile).isFile()) block("environment_file", "Environment file does not exist");
    if (!fs.existsSync(composeOverrideFile) || !fs.statSync(composeOverrideFile).isFile()) block("compose_override_file", "Compose image override file does not exist");
    if (forge.state === "verified" && !rollbackOverrideFile) block("rollback_override_file", "Forge evidence pins image digests, which cannot be retagged; a rollback override path is required");
    if (rollbackOverrideFile && (!fs.existsSync(rollbackOverrideFile) || !fs.statSync(rollbackOverrideFile).isFile())) block("rollback_override_file", "Rollback image override file does not exist");
    if (checks.some((check) => !check.passed)) return { status: "BLOCKED", checks, report };

    const envSource = fs.readFileSync(environmentFile);
    const overrideSource = fs.readFileSync(composeOverrideFile);
    const rollbackOverrideSource = rollbackOverrideFile ? fs.readFileSync(rollbackOverrideFile) : undefined;
    try { validateImageOverride(overrideSource.toString("utf8"), { backend: input.authorizedBackendImage, frontend: input.authorizedFrontendImage }); pass("compose_override", "Override contains only the authorized backend and frontend images"); }
    catch { block("compose_override", "Compose image override is not the exact authorized two-service plan"); }
    if (rollbackOverrideSource) {
      try { validateImageOverride(rollbackOverrideSource.toString("utf8"), { backend: input.rollbackBackendImage, frontend: input.rollbackFrontendImage }); pass("rollback_override", "Rollback override contains only the rollback backend and frontend images"); }
      catch { block("rollback_override", "Rollback image override is not the exact rollback two-service plan"); }
    }
    const envValues = parseEnvironment(envSource.toString("utf8"));
    report.environmentFileSha256 = sha256(envSource);
    report.composeOverrideFileSha256 = sha256(overrideSource);
    if (rollbackOverrideSource) report.rollbackComposeOverrideFileSha256 = sha256(rollbackOverrideSource);
    if (envValues.get("APP_ENV")?.trim().toLowerCase() !== "beta" || envValues.get("ENVIRONMENT")?.trim().toLowerCase() !== "beta") block("environment_file_identity", "Environment file must define APP_ENV=beta and ENVIRONMENT=beta exactly once");
    else pass("environment_file_identity", "APP_ENV and ENVIRONMENT originate from the supplied beta environment file");
    if (checks.some((check) => !check.passed)) return { status: "BLOCKED", checks, report };

    const composeArgs = ["compose", "--project-name", input.composeProjectName, "--env-file", environmentFile, "-f", composeFile, "-f", composeOverrideFile, "config", "--format", "json"];
    const compose = hooks.composeConfig || ((args: string[], cwd: string) => execFixed("docker", args, cwd, 30_000));
    const composeResult = await compose(composeArgs, workingDirectory);
    if (composeResult.code !== 0) return { status: "ERROR", checks: [...checks, { name: "compose_interpolation", passed: false, detail: "Compose config failed without changing containers" }], report };
    report.composeConfigSha256 = sha256(composeResult.stdout);
    let model: ComposeModel;
    try { model = JSON.parse(composeResult.stdout) as ComposeModel; }
    catch { return { status: "ERROR", checks: [...checks, { name: "compose_interpolation", passed: false, detail: "Compose config was not valid JSON" }], report }; }
    pass("compose_interpolation", "Resolved with the exact supplied --env-file; no activation command executed");
    if (model.name && model.name !== input.composeProjectName) block("compose_project", "Resolved project name differs from operator input");
    else pass("compose_project", `Resolved project: ${input.composeProjectName}`);
    if (forge.state === "verified") {
      // The binding says where this build may go; the resolved model says where it is actually going.
      // The shared verifier cannot make this comparison — it never sees the Compose model.
      const b = forge.binding;
      if (b.targetEnvironment !== normalizedEnvironment) block("forge_binding_target", "Binding target environment differs from the resolved environment");
      else if (b.composeProjectName !== input.composeProjectName) block("forge_binding_target", "Binding Compose project differs from the resolved project");
      else if ([...b.authorizedServices].sort().join(",") !== [...input.authorizedServices].sort().join(",")) block("forge_binding_target", "Binding authorized services differ from the operator plan");
      else pass("forge_binding_target", `Binding target matches the resolved plan: ${b.targetEnvironment}/${b.composeProjectName}`);
      // Blocker from the 2026-09-01 review: signing a target id creates no binding unless the verifier
      // MEASURES the target and compares. These come from the agent's own configuration, not operator
      // input, so a binding for server A cannot be presented on server B.
      if (!input.actualOrgId || !input.actualServerId) block("forge_binding_identity", "Forge evidence requires the agent's own organization and server identity");
      else if (b.targetOrgId !== input.actualOrgId || b.targetServerId !== input.actualServerId) block("forge_binding_identity", "Binding authorizes a different organization or server than this host");
      else pass("forge_binding_identity", "Binding target identity matches this host");
      if (forge.candidate.backendImageDigest !== input.authorizedBackendImage || forge.candidate.frontendImageDigest !== input.authorizedFrontendImage) block("forge_binding_images", "Candidate images differ from the attested build's pinned digests");
      else pass("forge_binding_images", "Candidate images are the attested build's pinned digests");
      if (forge.rollback.backendImageDigest !== input.rollbackBackendImage || forge.rollback.frontendImageDigest !== input.rollbackFrontendImage) block("forge_binding_rollback_images", "Rollback images differ from the attested rollback build's pinned digests");
      else pass("forge_binding_rollback_images", "Rollback images are the attested rollback build's pinned digests");
    }
    const services = model.services || {};
    const serviceNames = Object.keys(services);
    const unexpected = serviceNames.filter((name) => !input.allowedComposeServices.includes(name));
    if (unexpected.length) block("compose_services", `Unexpected service count: ${unexpected.length}`);
    else pass("compose_services", "Compose services match the approved plan allowlist");
    for (const service of input.authorizedServices) if (!services[service]) block("authorized_services", `Authorized service is absent: ${service}`);
    report.servicesExcluded = serviceNames.filter((name) => !input.authorizedServices.includes(name));

    const backendName = input.authorizedServices.find((name) => /backend/i.test(name));
    const frontendName = input.authorizedServices.find((name) => /frontend/i.test(name));
    if (!backendName || !frontendName) block("service_association", "Authorized services must identify one backend and one frontend");
    const backend = backendName ? services[backendName] : undefined;
    const frontend = frontendName ? services[frontendName] : undefined;
    if (backend?.image !== input.authorizedBackendImage) block("backend_image_plan", "Resolved backend image differs from the authorized candidate"); else pass("backend_image_plan", "Resolved backend image matches the authorized candidate");
    if (frontend?.image !== input.authorizedFrontendImage) block("frontend_image_plan", "Resolved frontend image differs from the authorized candidate"); else pass("frontend_image_plan", "Resolved frontend image matches the authorized candidate");
    const backendEnv = environmentObject(backend?.environment);
    for (const key of ["APP_ENV", "ENVIRONMENT"] as const) {
      const value = backendEnv.get(key)?.trim().toLowerCase();
      if (value !== "beta") block(`resolved_${key}`, `${key} did not resolve to beta`);
      else pass(`resolved_${key}`, `${key}=beta (supplied env file / explicit service interpolation)`);
    }
    for (const flag of BETA_STARTUP_SAFETY_FLAGS) {
      const safe = backendEnv.get(flag)?.trim().toLowerCase() === "false";
      report.startupSafetyFlags[flag] = safe ? "PASS" : "FAIL";
      if (safe) pass(flag, "false"); else block(flag, "Missing, malformed, or not false");
    }

    const mongoEntries = ["MONGO_URL", "MONGODB_URI"].map((name) => [name, backendEnv.get(name)] as const).filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
    if (mongoEntries.length !== 1) block("database_destination", "Exactly one MongoDB destination variable must resolve");
    else {
      try {
        const [sourceVariable, raw] = mongoEntries[0];
        const parsed = new URL(raw);
        const hostname = parsed.hostname.toLowerCase();
        const databaseName = parsed.pathname.replace(/^\//, "") || backendEnv.get("DB_NAME")?.trim() || "";
        const approved = input.allowedDatabaseDestinations.some((item) => item.hostname.trim().toLowerCase() === hostname && item.databaseName.trim() === databaseName);
        report.databaseDestination = { sourceVariable, hostname, databaseName: databaseName || "<missing>", classification: approved ? "approved-beta" : "blocked" };
        if (approved) pass("database_destination", "MongoDB hostname and database fingerprint are approved for beta");
        else block("database_destination", "MongoDB hostname and database fingerprint are not approved for beta");
      } catch { block("database_destination", "MongoDB destination is malformed"); }
    }
    const destinations = new Set<string>(); collectDestinations(model, destinations);
    const allowed = new Set(input.allowedHostnames.map((host) => host.trim().toLowerCase()).filter(Boolean));
    const forbidden = [...destinations].filter((host) => host === "craftersmarket.org" || host === "www.craftersmarket.org" || (!allowed.has(host) && !["backend", "frontend", "mongo", "localhost", "127.0.0.1"].includes(host)));
    const productionMode = [...backendEnv.entries()].some(([key, value]) => (/mode|environment/i.test(key) && /^live$/i.test(value.trim())) || /sk_live_/i.test(value));
    if (forbidden.length || productionMode) block("beta_destinations", "Production or non-allowlisted destination detected");
    else pass("beta_destinations", "All detected destinations are beta-approved or internal");

    const inspect = hooks.inspectImage || defaultInspectImage;
    const imageInputs = {
      candidateBackend: input.authorizedBackendImage,
      candidateFrontend: input.authorizedFrontendImage,
      rollbackBackend: input.rollbackBackendImage,
      rollbackFrontend: input.rollbackFrontendImage,
    };
    const inspected: Record<string, ImageInspection> = {};
    for (const [role, reference] of Object.entries(imageInputs)) {
      const image = await inspect(reference, workingDirectory);
      if (!image?.id) block(`image_${role}`, "Required image is missing or ambiguous");
      else { inspected[role] = image; pass(`image_${role}`, `Present: ${image.id}`); }
    }
    if (forge.state === "verified") {
      // PROOF 8 — the whole reason Forge exists. `revision` is the OCI label
      // org.opencontainers.image.revision, which this preflight has always read and, until now, never
      // compared to anything. An image whose label does not match the attested source commit is an
      // artifact nobody can account for.
      const expectedRevision = { candidateBackend: forge.candidate.sourceCommit, candidateFrontend: forge.candidate.sourceCommit, rollbackBackend: forge.rollback.sourceCommit, rollbackFrontend: forge.rollback.sourceCommit };
      const unbound = Object.entries(expectedRevision).filter(([role, commit]) => inspected[role]?.revision !== commit);
      if (unbound.length) block("forge_build_provenance", `Image revision label does not match the attested source commit: ${unbound.map(([role]) => role).sort().join(", ")}`);
      else pass("forge_build_provenance", "Every image is labelled with the source commit its build attests");
    }
    if (inspected.candidateBackend?.id === inspected.rollbackBackend?.id) block("backend_rollback_distinct", "Backend candidate and rollback images are identical");
    if (inspected.candidateFrontend?.id === inspected.rollbackFrontend?.id) block("frontend_rollback_distinct", "Frontend candidate and rollback images are identical");
    report.images = Object.fromEntries(Object.entries(inspected).map(([role, image]) => [role, { reference: imageInputs[role as keyof typeof imageInputs], id: image.id, ...(image.revision ? { revision: image.revision } : {}) }]));

    if (checks.some((check) => !check.passed)) return { status: "BLOCKED", checks, report };
    const base = `docker compose --project-name ${quote(input.composeProjectName)} --env-file ${quote(environmentFile)} -f ${quote(composeFile)} -f ${quote(composeOverrideFile)}`;
    const servicesArg = input.authorizedServices.map(quote).join(" ");
    report.deploymentCommand = `${base} up -d --no-build --no-deps --force-recreate ${servicesArg}`;
    // Option 1 (docs/forge-manifest-spec.md §8.4). Rollback selects the reviewed ROLLBACK OVERRIDE
    // instead of retagging. Retagging mutated a tag so the candidate name resolved to different bytes,
    // which is precisely the mutable-reference hazard this gate exists to prevent — and it left the
    // host with a tag that no longer meant what it said. Rolling back is itself a deployment: it needs
    // its own operator approval, and the reviewed way to obtain one is a second preflight run with the
    // candidate and rollback roles swapped.
    if (rollbackOverrideFile) {
      const rollbackBase = `docker compose --project-name ${quote(input.composeProjectName)} --env-file ${quote(environmentFile)} -f ${quote(composeFile)} -f ${quote(rollbackOverrideFile)}`;
      report.rollbackCommand = `${rollbackBase} up -d --no-build --no-deps --force-recreate ${servicesArg}`;
    } else {
      // Legacy retag form, preserved so that callers who supply no rollback override are unaffected.
      report.rollbackCommand = `docker image tag ${quote(input.rollbackBackendImage)} ${quote(input.authorizedBackendImage)} && docker image tag ${quote(input.rollbackFrontendImage)} ${quote(input.authorizedFrontendImage)} && ${base} up -d --no-build --no-deps --force-recreate ${servicesArg}`;
    }
    report.operatorApprovalStatus = "awaiting";
    return { status: "PASS — awaiting operator approval", checks, report };
  } catch (error) {
    const detail = error instanceof Error && /Duplicate environment variable/.test(error.message) ? "Conflicting duplicate environment values" : "Preflight validation error";
    return { status: "ERROR", checks: [...checks, { name: "preflight", passed: false, detail }], report };
  }
}

export function serializePreflightReport(result: BetaDeploymentPreflightResult) {
  return `${JSON.stringify(result, null, 2)}\n`;
}
