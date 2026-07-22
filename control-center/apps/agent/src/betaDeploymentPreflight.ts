import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFixed, type ExecResult } from "./safeExec.js";
import { parseEnvironment } from "./configurationDeployment.js";

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
  authorizedBackendImage: string;
  authorizedFrontendImage: string;
  rollbackBackendImage: string;
  rollbackFrontendImage: string;
  authorizedServices: string[];
  allowedComposeServices: string[];
  allowedHostnames: string[];
};

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
    environmentFileSha256?: string;
    composeConfigSha256?: string;
    servicesAffected: string[];
    servicesExcluded: string[];
    mongoDbRecreation: "blocked";
    mongoDbServiceIncluded: "no" | "yes";
    volumeRecreation: "no";
    startupSafetyFlags: Record<string, "PASS" | "FAIL">;
    images?: Record<string, { reference: string; id: string; revision?: string }>;
    deploymentCommand?: string;
    rollbackCommand?: string;
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
    for (const match of value.matchAll(/(?:mongodb(?:\+srv)?|https?):\/\/[^\s"']+/gi)) {
      try { found.add(new URL(match[0]).hostname.toLowerCase()); } catch { /* malformed destinations are handled as unsafe below */ found.add("<malformed>"); }
    }
    return;
  }
  if (Array.isArray(value)) for (const item of value) collectDestinations(item, found);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectDestinations(item, found);
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

  try {
    if (normalizedEnvironment !== "beta") block("target_environment", "Target must resolve exactly to beta");
    else pass("target_environment", "Resolved target: beta");
    for (const [name, value] of Object.entries({ composeWorkingDirectory: input.composeWorkingDirectory, composeProjectName: input.composeProjectName, composeFilePath: input.composeFilePath, environmentFilePath: input.environmentFilePath })) {
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
    if (!fs.existsSync(workingDirectory) || !fs.statSync(workingDirectory).isDirectory()) block("working_directory", "Compose working directory does not exist");
    if (!fs.existsSync(composeFile) || !fs.statSync(composeFile).isFile()) block("compose_file", "Compose file does not exist");
    if (!fs.existsSync(environmentFile) || !fs.statSync(environmentFile).isFile()) block("environment_file", "Environment file does not exist");
    if (checks.some((check) => !check.passed)) return { status: "BLOCKED", checks, report };

    const envSource = fs.readFileSync(environmentFile);
    const envValues = parseEnvironment(envSource.toString("utf8"));
    report.environmentFileSha256 = sha256(envSource);
    if (envValues.get("APP_ENV")?.trim().toLowerCase() !== "beta" || envValues.get("ENVIRONMENT")?.trim().toLowerCase() !== "beta") block("environment_file_identity", "Environment file must define APP_ENV=beta and ENVIRONMENT=beta exactly once");
    else pass("environment_file_identity", "APP_ENV and ENVIRONMENT originate from the supplied beta environment file");
    if (checks.some((check) => !check.passed)) return { status: "BLOCKED", checks, report };

    const composeArgs = ["compose", "--project-name", input.composeProjectName, "--env-file", environmentFile, "-f", composeFile, "config", "--format", "json"];
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
    if (inspected.candidateBackend?.id === inspected.rollbackBackend?.id) block("backend_rollback_distinct", "Backend candidate and rollback images are identical");
    if (inspected.candidateFrontend?.id === inspected.rollbackFrontend?.id) block("frontend_rollback_distinct", "Frontend candidate and rollback images are identical");
    report.images = Object.fromEntries(Object.entries(inspected).map(([role, image]) => [role, { reference: imageInputs[role as keyof typeof imageInputs], id: image.id, ...(image.revision ? { revision: image.revision } : {}) }]));

    if (checks.some((check) => !check.passed)) return { status: "BLOCKED", checks, report };
    const base = `docker compose --project-name ${quote(input.composeProjectName)} --env-file ${quote(environmentFile)} -f ${quote(composeFile)}`;
    const servicesArg = input.authorizedServices.map(quote).join(" ");
    report.deploymentCommand = `${base} up -d --no-build --no-deps --force-recreate ${servicesArg}`;
    report.rollbackCommand = `docker image tag ${quote(input.rollbackBackendImage)} ${quote(input.authorizedBackendImage)} && docker image tag ${quote(input.rollbackFrontendImage)} ${quote(input.authorizedFrontendImage)} && ${base} up -d --no-build --no-deps --force-recreate ${servicesArg}`;
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
