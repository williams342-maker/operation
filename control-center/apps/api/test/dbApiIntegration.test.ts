import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { agentSigningKey, signRequest } from "@control-center/shared";
import { isolatedTestMongoUrl } from "../src/testDbGuard.js";

const enabled = process.env.CONTROL_CENTER_RUN_DB_TESTS === "true" && Boolean(process.env.MONGO_URL_TEST);

type TestResponse<T = Record<string, unknown>> = {
  status: number;
  headers: Headers;
  body: T;
};

type Session = {
  cookie: string;
  csrf: string;
};

type AgentCredentials = {
  agentId: string;
  agentSecret: string;
  serverId: string;
};

function jsonHeaders(session?: Session) {
  return {
    "content-type": "application/json",
    ...(session ? { cookie: session.cookie, "x-csrf-token": session.csrf } : {})
  };
}

function cookieFrom(headers: Headers) {
  const setCookie = headers.get("set-cookie");
  assert.ok(setCookie, "expected session cookie");
  return setCookie.split(";")[0];
}

function metricPayload(agentVersion = "fake-agent/1.0") {
  const collectedAt = new Date().toISOString();
  return {
    heartbeat: { collectedAt, agentVersion },
    metrics: {
      collectedAt,
      agentVersion,
      uptimeSeconds: 123,
      cpu: { loadPercent: 7, cores: 4 },
      memory: { totalBytes: 1024, usedBytes: 512 },
      disk: [{ mount: "/", totalBytes: 2048, usedBytes: 1024 }]
    },
    docker: [{ name: "web", image: "example/web:latest", state: "running", status: "Up" }],
    compose: [{ projectName: "demo", service: "web", state: "running", configPath: "/srv/demo/compose.yml" }],
    git: [] as unknown[],
    httpHealth: [] as unknown[],
    mongo: [] as unknown[]
  };
}

function signHeaders(credentials: AgentCredentials, requestPath: string, body: unknown, options: { timestamp?: string; nonce?: string; secret?: string; signature?: string } = {}) {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const nonce = options.nonce ?? crypto.randomUUID();
  const bodyText = JSON.stringify(body);
  const secret = agentSigningKey(options.secret ?? credentials.agentSecret);
  const signature = options.signature ?? signRequest(secret, { method: "POST", path: requestPath, timestamp, nonce, body: bodyText });
  return {
    "content-type": "application/json",
    "x-agent-id": credentials.agentId,
    "x-agent-timestamp": timestamp,
    "x-agent-nonce": nonce,
    "x-agent-signature": signature
  };
}

async function assertIndex(collection: { indexes(): Promise<Array<{ key: Record<string, number>; unique?: boolean; expireAfterSeconds?: number }>> }, key: Record<string, number>, options: { unique?: boolean; ttl?: number } = {}) {
  const indexes = await collection.indexes();
  const found = indexes.find((index) => JSON.stringify(index.key) === JSON.stringify(key));
  assert.ok(found, `missing index ${JSON.stringify(key)}`);
  if (options.unique !== undefined) assert.equal(found.unique, options.unique);
  if (options.ttl !== undefined) assert.equal(found.expireAfterSeconds, options.ttl);
}

test("database-backed Phase 1B API and fake-agent verification", { skip: !enabled }, async () => {
  process.env.NODE_ENV = "test";
  process.env.CONTROL_CENTER_ALLOW_INSECURE_COOKIES = "true";
  const isolated = isolatedTestMongoUrl();
  process.env.MONGO_URL = isolated.url;
  process.env.CONTROL_CENTER_DB = isolated.dbName;
  console.log(`Using disposable MongoDB database: ${isolated.dbName}`);

  const [{ app }, dbModule, cryptoModule] = await Promise.all([
    import("../src/server.js"),
    import("../src/db.js"),
    import("../src/crypto.js")
  ]);
  const { client, collections, connectDb } = dbModule;
  const { hashPassword, hashSecret } = cryptoModule;
  await connectDb();

  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const tempCredentialFile = path.join(os.tmpdir(), `control-center-fake-agent-${crypto.randomUUID()}.json`);

  async function request<T = Record<string, unknown>>(method: string, route: string, body?: unknown, headers?: Record<string, string>): Promise<TestResponse<T>> {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: headers ?? (body ? { "content-type": "application/json" } : undefined),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) as T : {} as T };
  }

  async function login(slug: string, email: string, password: string): Promise<Session> {
    const response = await request<{ csrfToken: string }>("POST", "/auth/login", { organizationSlug: slug, email, password }, { "content-type": "application/json" });
    assert.equal(response.status, 200);
    return { cookie: cookieFrom(response.headers), csrf: response.body.csrfToken };
  }

  async function createEnrollment(session: Session, expiresInMinutes = 60) {
    const response = await request<{ id: string; token: string; expiresAt: string }>("POST", "/enrollments", { expiresInMinutes }, jsonHeaders(session));
    assert.equal(response.status, 201);
    assert.ok(response.body.token);
    return response.body;
  }

  async function enroll(token: string, hostname = "fake-agent-host"): Promise<AgentCredentials> {
    const response = await request<AgentCredentials & { pollIntervalSeconds: number }>("POST", "/agent/enroll", {
      enrollmentToken: token,
      hostname,
      agentVersion: "fake-agent/1.0",
      capabilities: ["system", "docker", "compose", "git", "http", "mongo"]
    }, { "content-type": "application/json" });
    assert.equal(response.status, 201);
    const credentials = { agentId: response.body.agentId, agentSecret: response.body.agentSecret, serverId: response.body.serverId };
    await fs.writeFile(tempCredentialFile, JSON.stringify({ agentId: credentials.agentId, serverId: credentials.serverId }), { mode: 0o600 });
    return credentials;
  }

  async function poll(credentials: AgentCredentials, body: unknown, options: { timestamp?: string; nonce?: string; secret?: string; signature?: string; omitSignature?: boolean } = {}) {
    const signed = signHeaders(credentials, "/api/agent/poll", body, options);
    if (options.omitSignature) delete (signed as Partial<typeof signed>)["x-agent-signature"];
    return request("POST", "/agent/poll", body, signed);
  }

  async function ack(credentials: AgentCredentials, body: unknown, options: { timestamp?: string; nonce?: string; secret?: string; signature?: string; omitSignature?: boolean } = {}) {
    const signed = signHeaders(credentials, "/api/agent/tasks/ack", body, options);
    if (options.omitSignature) delete (signed as Partial<typeof signed>)["x-agent-signature"];
    return request("POST", "/agent/tasks/ack", body, signed);
  }

  try {
    await assertIndex(collections.enrollments, { orgId: 1, tokenHash: 1 }, { unique: true });
    await assertIndex(collections.agentNonces, { orgId: 1, agentId: 1, nonce: 1 }, { unique: true });
    await assertIndex(collections.telemetry, { expiresAt: 1 }, { ttl: 0 });
    await assertIndex(collections.telemetry, { orgId: 1, serverId: 1, collectedAt: -1 });
    await assertIndex(collections.servers, { orgId: 1, agentId: 1 }, { unique: true });
    await assertIndex(collections.agentTasks, { orgId: 1, agentId: 1, state: 1, availableAt: 1 });
    await assertIndex(collections.agentTasks, { orgId: 1, idempotencyKey: 1 }, { unique: true });
    await assertIndex(collections.agentTasks, { historyExpiresAt: 1 }, { ttl: 0 });
    await assertIndex(collections.agentTaskResults, { orgId: 1, taskId: 1 }, { unique: true });
    await assertIndex(collections.agentTaskResults, { expiresAt: 1 }, { ttl: 0 });

    const bootstrapStatus = await request<{ available: boolean }>("GET", "/auth/bootstrap");
    assert.equal(bootstrapStatus.status, 200);
    assert.equal(bootstrapStatus.body.available, true);
    assert.match(bootstrapStatus.headers.get("cache-control") || "", /no-store/);

    const protectedOverview = await request("GET", "/overview");
    assert.equal(protectedOverview.status, 401);

    const originalBootstrapMode = process.env.CONTROL_CENTER_BOOTSTRAP_MODE;
    process.env.CONTROL_CENTER_BOOTSTRAP_MODE = "disabled";
    const disabledBootstrap = await request("POST", "/auth/bootstrap", {
      organizationName: "Disabled Org",
      organizationSlug: "disabled-org",
      ownerEmail: "disabled@example.test",
      ownerName: "Disabled Owner",
      password: "disabled-password"
    }, { "content-type": "application/json" });
    assert.equal(disabledBootstrap.status, 403);
    process.env.CONTROL_CENTER_BOOTSTRAP_MODE = originalBootstrapMode || "manual";

    const invalidBootstrap = await request("POST", "/auth/bootstrap", {}, { "content-type": "application/json" });
    assert.equal(invalidBootstrap.status, 400);
    assert.match(invalidBootstrap.headers.get("cache-control") || "", /no-store/);
    assert.equal(await collections.organizations.countDocuments(), 0);

    const bootstrap = await request("POST", "/auth/bootstrap", {
      organizationName: "Phase 1B Org A",
      organizationSlug: "phase-1b-a",
      ownerEmail: "owner-a@example.test",
      ownerName: "Owner A",
      password: "owner-a-password"
    }, { "content-type": "application/json" });
    assert.equal(bootstrap.status, 201);
    assert.equal(await collections.organizations.countDocuments(), 1);
    assert.equal(await collections.users.countDocuments({ role: "Owner" }), 1);

    const duplicateBootstrap = await request("POST", "/auth/bootstrap", {
      organizationName: "Duplicate Org",
      organizationSlug: "duplicate-org",
      ownerEmail: "duplicate@example.test",
      ownerName: "Duplicate Owner",
      password: "duplicate-password"
    }, { "content-type": "application/json" });
    assert.equal(duplicateBootstrap.status, 409);
    assert.equal(await collections.organizations.countDocuments(), 1);
    assert.equal(await collections.users.countDocuments({ role: "Owner" }), 1);

    const auditSnapshot = JSON.stringify(await collections.auditEvents.find({}).toArray());
    assert.equal(auditSnapshot.includes("owner-a-password"), false);
    assert.equal(auditSnapshot.includes("disabled-password"), false);
    assert.equal(auditSnapshot.includes("duplicate-password"), false);

    const ownerA = await login("phase-1b-a", "owner-a@example.test", "owner-a-password");

    const createViewer = await request<{ id: string; oneTimePassword: string }>("POST", "/org/users", {
      email: "viewer-a@example.test",
      name: "Viewer A",
      role: "Viewer"
    }, jsonHeaders(ownerA));
    assert.equal(createViewer.status, 201);
    assert.ok(createViewer.headers.get("cache-control")?.includes("no-store"));
    assert.ok(createViewer.body.oneTimePassword);
    const viewerA = await login("phase-1b-a", "viewer-a@example.test", createViewer.body.oneTimePassword);
    const deniedEnrollment = await request("POST", "/enrollments", { expiresInMinutes: 60 }, jsonHeaders(viewerA));
    assert.equal(deniedEnrollment.status, 403);

    const generated = await request<{ id: string; token: string }>("POST", "/admin/enrollment/generate", { name: "CI enrollment", expiresInMinutes: 60, maxUses: 2, description: "integration" }, jsonHeaders(ownerA));
    assert.equal(generated.status, 201);
    assert.match(generated.body.token, /^owenr_/);
    const listed = await request<{ enrollments: Array<{ _id: string; tokenHash?: string; token?: string; usesRemaining: number }> }>("GET", "/admin/enrollment", undefined, jsonHeaders(ownerA));
    assert.equal(listed.status, 200);
    const listedGenerated = listed.body.enrollments.find((item) => String(item._id) === String(generated.body.id));
    assert.ok(listedGenerated);
    assert.equal(listedGenerated.tokenHash, undefined);
    assert.equal(listedGenerated.token, undefined);
    assert.equal(listedGenerated.usesRemaining, 2);
    const unavailableDownload = await request("GET", `/admin/enrollment/download/${generated.body.id}`, undefined, jsonHeaders(ownerA));
    assert.equal(unavailableDownload.status, 410);
    await enroll(generated.body.token, "multi-use-one");
    await enroll(generated.body.token, "multi-use-two");
    const maxUseRejected = await request("POST", "/agent/enroll", { enrollmentToken: generated.body.token, hostname: "multi-use-three", agentVersion: "fake-agent/1.0", capabilities: [] }, { "content-type": "application/json" });
    assert.equal(maxUseRejected.status, 401);

    const revocable = await request<{ id: string; token: string }>("POST", "/admin/enrollment/generate", { name: "Revocable", expiresInMinutes: null, maxUses: null }, jsonHeaders(ownerA));
    assert.equal(revocable.status, 201);
    const revokeEnrollment = await request("POST", "/admin/enrollment/revoke", { id: revocable.body.id }, jsonHeaders(ownerA));
    assert.equal(revokeEnrollment.status, 200);
    const revokedEnrollmentUse = await request("POST", "/agent/enroll", { enrollmentToken: revocable.body.token, hostname: "revoked-enrollment", agentVersion: "fake-agent/1.0", capabilities: [] }, { "content-type": "application/json" });
    assert.equal(revokedEnrollmentUse.status, 401);
    const deleteEnrollment = await request("DELETE", `/admin/enrollment/${revocable.body.id}`, undefined, jsonHeaders(ownerA));
    assert.equal(deleteEnrollment.status, 200);

    const enrollment = await createEnrollment(ownerA);
    const expiredToken = `expired-${crypto.randomBytes(32).toString("hex")}`;
    const orgA = await collections.organizations.findOne({ slug: "phase-1b-a" });
    assert.ok(orgA?._id);
    const ownerUserA = await collections.users.findOne({ orgId: orgA._id, email: "owner-a@example.test" });
    assert.ok(ownerUserA?._id);
    const legacyId = new ObjectId();
    const legacyCreatedAt = new Date(Date.now() - 86_400_000);
    await collections.servers.insertOne({ _id: legacyId, orgId: orgA._id, name: "Ops Workbench", slug: "ops-workbench", hostname: "opsworkbench", agentId: `manual-${legacyId}`, agentSecretHash: hashSecret("legacy-placeholder"), credentialVersion: 0, status: "offline", allowlistedRoots: ["/opt/opsworkbench"], createdAt: legacyCreatedAt, updatedAt: legacyCreatedAt });
    const mergeToken = await request<{ token: string; serverId: string; installCommand: string }>("POST", "/servers/onboard", { url: "https://opsworkbench.org", expiresInMinutes: 60 }, jsonHeaders(ownerA));
    assert.equal(mergeToken.status, 201);
    assert.equal(mergeToken.body.serverId, String(legacyId), "URL-first onboarding must bind to the existing compact slug match");
    assert.match(mergeToken.body.installCommand, /CONTROL_CENTER_SERVER_SLUG="ops-workbench"/);
    const mergedCredentials = await enroll(mergeToken.body.token, "opsworkbench");
    assert.equal(mergedCredentials.serverId, String(legacyId), "enrollment must preserve the existing ops-workbench server id");
    assert.equal(await collections.servers.countDocuments({ orgId: orgA._id, slug: "ops-workbench" }), 1, "enrollment must not create a duplicate server");
    const mergedServer = await collections.servers.findOne({ _id: legacyId });
    assert.equal(mergedServer?.name, "Ops Workbench");
    assert.deepEqual(mergedServer?.allowlistedRoots, ["/opt/opsworkbench"]);
    assert.equal(mergedServer?.createdAt.getTime(), legacyCreatedAt.getTime());
    const editedServer = await request<{ server: { _id: string; slug: string; primaryUrl: string; machineId?: string } }>("PATCH", `/servers/${legacyId}`, { name: "Ops Workbench", slug: "ops-workbench", primaryUrl: "https://opsworkbench.org/", notes: "integration", tags: ["production"], expectedUpdatedAt: mergedServer!.updatedAt.toISOString() }, jsonHeaders(ownerA));
    assert.equal(editedServer.status, 200);
    assert.equal(String(editedServer.body.server._id), String(legacyId));
    assert.equal(editedServer.body.server.primaryUrl, "https://opsworkbench.org");
    const statusChecked = await request<{ server_id: string; public_site_checked_at: string; agent_status: string; enrollment_status: string }>("POST", `/servers/${legacyId}/check-status`, {}, jsonHeaders(ownerA));
    assert.equal(statusChecked.status, 200);
    assert.equal(statusChecked.body.server_id, String(legacyId));
    assert.ok(statusChecked.body.public_site_checked_at);
    assert.equal(statusChecked.body.enrollment_status, "connected");
    const pendingDelete = await request<{ serverId: string; enrollmentId: string }>("POST", "/servers/onboard", { url: "https://pending-delete.example.test", displayName: "Pending delete", slug: "pending-delete", expiresInMinutes: 60 }, jsonHeaders(ownerA));
    assert.equal(pendingDelete.status, 201);
    const deletedPending = await request<{ deleted: boolean; tokens_revoked: number }>("DELETE", `/servers/${pendingDelete.body.serverId}`, { mode: "remove" }, jsonHeaders(ownerA));
    assert.equal(deletedPending.status, 200);
    assert.equal(deletedPending.body.deleted, true);
    assert.equal(deletedPending.body.tokens_revoked, 1);
    assert.equal(await collections.servers.countDocuments({ _id: new ObjectId(pendingDelete.body.serverId) }), 0);
    const revokedPendingToken = await collections.enrollments.findOne({ _id: new ObjectId(pendingDelete.body.enrollmentId) });
    assert.ok(revokedPendingToken?.revokedAt);
    await collections.enrollments.insertOne({
      orgId: orgA._id,
      tokenHash: hashSecret(expiredToken),
      name: "Expired test token",
      expiresAt: new Date(Date.now() - 60_000),
      maxUses: 1,
      uses: 0,
      usage: [],
      createdByUserId: ownerUserA._id,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const expiredEnroll = await request("POST", "/agent/enroll", { enrollmentToken: expiredToken, hostname: "expired", agentVersion: "fake-agent/1.0", capabilities: [] }, { "content-type": "application/json" });
    assert.equal(expiredEnroll.status, 401);

    const credentials = await enroll(enrollment.token);
    await collections.servers.updateOne({ _id: new ObjectId(credentials.serverId), orgId: orgA._id }, { $set: { allowlistedRoots: ["/srv"] } });
    const reuse = await request("POST", "/agent/enroll", { enrollmentToken: enrollment.token, hostname: "reuse", agentVersion: "fake-agent/1.0", capabilities: [] }, { "content-type": "application/json" });
    assert.equal(reuse.status, 401);

    const storedServer = await collections.servers.findOne({ _id: new ObjectId(credentials.serverId), orgId: orgA._id });
    assert.ok(storedServer);
    assert.notEqual(storedServer.agentSecretHash, credentials.agentSecret);
    assert.equal(Object.prototype.hasOwnProperty.call(storedServer, "agentSecret"), false);

    const project = await request<{ id: string }>("POST", "/projects", {
      name: "Phase 1B Project",
      slug: "phase-1b-project",
      primaryServerId: credentials.serverId,
      repoPath: "/srv/phase-1b",
      composePath: "/srv/phase-1b/compose.yml"
    }, jsonHeaders(ownerA));
    assert.equal(project.status, 201);

    const queuedTask = await request<{ task: { _id: string; state: string } }>("POST", "/tasks", {
      serverId: credentials.serverId,
      projectId: project.body.id,
      type: "collect.system",
      idempotencyKey: "phase-2b-system-task",
      payload: { projects: [], httpHealthChecks: [], mongoChecks: [] },
      expiresInSeconds: 600
    }, jsonHeaders(ownerA));
    assert.equal(queuedTask.status, 201);
    assert.equal(queuedTask.body.task.state, "queued");

    const duplicateTask = await request<{ task: { _id: string } }>("POST", "/tasks", {
      serverId: credentials.serverId,
      projectId: project.body.id,
      type: "collect.system",
      idempotencyKey: "phase-2b-system-task",
      payload: { projects: [], httpHealthChecks: [], mongoChecks: [] },
      expiresInSeconds: 600
    }, jsonHeaders(ownerA));
    assert.equal(duplicateTask.status, 201);
    assert.equal(duplicateTask.body.task._id, queuedTask.body.task._id);

    const claimedTask = await poll(credentials, { heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "fake-agent/1.0" } });
    assert.equal(claimedTask.status, 200);
    const claimedTasks = (claimedTask.body as { tasks: Array<{ envelope: { taskId: string; agentId: string; serverId: string }; payload: unknown }> }).tasks;
    assert.equal(claimedTasks.length, 1);
    assert.equal(claimedTasks[0].envelope.taskId, queuedTask.body.task._id);
    assert.equal(claimedTasks[0].envelope.agentId, credentials.agentId);
    assert.equal(claimedTasks[0].envelope.serverId, credentials.serverId);

    const duplicateClaim = await poll(credentials, { heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "fake-agent/1.0" } });
    assert.equal(duplicateClaim.status, 200);
    assert.equal(((duplicateClaim.body as { tasks: unknown[] }).tasks).length, 0);

    const startedTask = await ack(credentials, { taskId: queuedTask.body.task._id, event: "started" });
    assert.equal(startedTask.status, 200);
    const completedTask = await ack(credentials, { taskId: queuedTask.body.task._id, event: "succeeded", result: { metrics: { ok: true }, secret: "should-redact" } });
    assert.equal(completedTask.status, 200);
    const storedTask = await collections.agentTasks.findOne({ _id: new ObjectId(queuedTask.body.task._id), orgId: orgA._id });
    assert.equal(storedTask?.state, "succeeded");
    assert.equal(JSON.stringify(storedTask?.result).includes("should-redact"), false);

    const cancelDone = await request("POST", `/tasks/${queuedTask.body.task._id}/cancel`, {}, jsonHeaders(ownerA));
    assert.equal(cancelDone.status, 404);
    const health = await request<{ id: string }>("POST", `/projects/${project.body.id}/health-checks`, {
      name: "Web",
      url: "https://example.test/health",
      timeoutMs: 1000
    }, jsonHeaders(ownerA));
    assert.equal(health.status, 201);
    const mongo = await request<{ id: string }>("POST", `/projects/${project.body.id}/mongo-checks`, {
      name: "Mongo",
      databaseNameHint: "appdb",
      secretLocation: "agent"
    }, jsonHeaders(ownerA));
    assert.equal(mongo.status, 201);

    const heartbeat = await poll(credentials, { heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "fake-agent/1.0" } });
    assert.equal(heartbeat.status, 200);
    assert.equal(Array.isArray((heartbeat.body as { tasks?: unknown[] }).tasks), true);

    const telemetryPayload = metricPayload();
    telemetryPayload.git.push({ projectId: project.body.id, branch: "main", commit: "abc123", dirty: false, collectedAt: new Date().toISOString() });
    telemetryPayload.httpHealth.push({ healthCheckId: health.body.id, success: false, errorCategory: "timeout", checkedAt: new Date().toISOString() });
    telemetryPayload.mongo.push({ mongoCheckId: mongo.body.id, success: true, latencyMs: 12, databaseName: "appdb", checkedAt: new Date().toISOString() });
    const telemetry = await poll(credentials, telemetryPayload);
    assert.equal(telemetry.status, 200);
    assert.ok(await collections.telemetry.countDocuments({ orgId: orgA._id, serverId: new ObjectId(credentials.serverId) }) >= 2);

    const credentialRemote = `https://user:${["not", "a", "credential"].join("-")}@example.test/org/repo.git?access=redacted#fragment`;
    const discoveryPayload = { heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "fake-agent/1.1" }, discovery: { collectedAt: new Date().toISOString(), dockerInstalled: true, nginxInstalled: true, composeProjects: [], applications: [], warnings: ["unreadable_path"], discoveryTruncated: true, truncationCategories: ["applications"], repositories: [{ path: "/srv/demo", branch: "main", commit: "a".repeat(40), remote: credentialRemote, dirty: false }] } };
    const discoveryPoll = await poll(credentials, discoveryPayload); assert.equal(discoveryPoll.status, 200);
    const storedDiscovery = await collections.telemetry.findOne({ orgId: orgA._id, serverId: new ObjectId(credentials.serverId), discovery: { $exists: true } }, { sort: { collectedAt: -1 } });
    const storedRemote = ((storedDiscovery?.discovery as { repositories?: Array<{ remote?: string }> })?.repositories || [])[0]?.remote;
    assert.equal(storedRemote, "https://example.test/org/repo.git"); assert.equal(JSON.stringify(storedDiscovery?.discovery).includes("not-a-credential"), false);

    const oversized = { heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "fake-agent/1.1" }, padding: "x".repeat(1024 * 1024 + 1) };
    const oversizedResponse = await poll(credentials, oversized); assert.equal(oversizedResponse.status, 413);

    const serverList = await request<{ servers: unknown[] }>("GET", "/servers", undefined, jsonHeaders(ownerA));
    assert.equal(serverList.status, 200);
    assert.equal(JSON.stringify(serverList.body).includes(credentials.agentSecret), false);
    assert.equal(JSON.stringify(serverList.body).includes("agentSecretHash"), false);

    const invalidSignature = await poll(credentials, metricPayload(), { signature: "a".repeat(64) });
    assert.equal(invalidSignature.status, 401);
    const missingSignature = await poll(credentials, metricPayload(), { omitSignature: true });
    assert.equal(missingSignature.status, 401);
    const staleTimestamp = await poll(credentials, metricPayload(), { timestamp: new Date(Date.now() - 10 * 60_000).toISOString() });
    assert.equal(staleTimestamp.status, 401);
    const futureTimestamp = await poll(credentials, metricPayload(), { timestamp: new Date(Date.now() + 10 * 60_000).toISOString() });
    assert.equal(futureTimestamp.status, 401);
    const futurePayload = metricPayload();
    futurePayload.heartbeat.collectedAt = new Date(Date.now() + 2 * 60_000).toISOString();
    const futureTelemetry = await poll(credentials, futurePayload);
    assert.equal(futureTelemetry.status, 400);
    const duplicateNonce = crypto.randomUUID();
    const duplicateOne = await poll(credentials, metricPayload(), { nonce: duplicateNonce });
    assert.equal(duplicateOne.status, 200);
    const duplicateTwo = await poll(credentials, metricPayload(), { nonce: duplicateNonce });
    assert.equal(duplicateTwo.status, 401);

    const rotate = await request<{ agentSecret: string }>("POST", `/servers/${credentials.serverId}/rotate`, {}, jsonHeaders(ownerA));
    assert.equal(rotate.status, 200);
    assert.ok(rotate.headers.get("cache-control")?.includes("no-store"));
    assert.ok(rotate.body.agentSecret);
    const oldRejected = await poll(credentials, metricPayload());
    assert.equal(oldRejected.status, 401);
    const rotatedCredentials = { ...credentials, agentSecret: rotate.body.agentSecret };
    const newAccepted = await poll(rotatedCredentials, metricPayload());
    assert.equal(newAccepted.status, 200);

    const revoke = await request("POST", `/servers/${credentials.serverId}/revoke`, {}, jsonHeaders(ownerA));
    assert.equal(revoke.status, 200);
    const revokedRejected = await poll(rotatedCredentials, metricPayload());
    assert.equal(revokedRejected.status, 401);

    const orgBResult = await collections.organizations.insertOne({ name: "Phase 1B Org B", slug: "phase-1b-b", createdAt: new Date(), updatedAt: new Date() });
    await collections.users.insertOne({ orgId: orgBResult.insertedId, email: "owner-b@example.test", name: "Owner B", role: "Owner", passwordHash: hashPassword("owner-b-password"), createdAt: new Date(), updatedAt: new Date() });
    const ownerB = await login("phase-1b-b", "owner-b@example.test", "owner-b-password");
    const orgBServers = await request<{ servers: unknown[] }>("GET", "/servers", undefined, jsonHeaders(ownerB));
    assert.equal(orgBServers.status, 200);
    assert.equal(orgBServers.body.servers.length, 0);
    const orgBProjects = await request<{ projects: unknown[] }>("GET", "/projects", undefined, jsonHeaders(ownerB));
    assert.equal(orgBProjects.status, 200);
    assert.equal(orgBProjects.body.projects.length, 0);
    const crossProject = await request("GET", `/projects/${project.body.id}/status`, undefined, jsonHeaders(ownerB));
    assert.equal(crossProject.status, 404);
    const orgBAudit = await request<{ events: unknown[] }>("GET", "/org/audit", undefined, jsonHeaders(ownerB));
    assert.equal(orgBAudit.status, 200);
    assert.equal(JSON.stringify(orgBAudit.body).includes(project.body.id), false);

    await collections.servers.updateOne({ _id: new ObjectId(credentials.serverId), orgId: orgA._id }, { $set: { status: "online", lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) } });
    const overview = await request("GET", "/overview", undefined, jsonHeaders(ownerA));
    assert.equal(overview.status, 200);
    const staleServer = await collections.servers.findOne({ _id: new ObjectId(credentials.serverId), orgId: orgA._id });
    assert.equal(staleServer?.status, "offline");

    const auditFailure = await collections.auditEvents.findOne({ action: "authorization.failure", result: "denied" });
    assert.ok(auditFailure?.requestId);
    assert.equal(JSON.stringify(auditFailure).includes(credentials.agentSecret), false);
  } finally {
    await fs.rm(tempCredentialFile, { force: true });
    await client.db(isolated.dbName).dropDatabase();
    await client.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

