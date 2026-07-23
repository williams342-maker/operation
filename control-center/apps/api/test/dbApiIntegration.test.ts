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
  const tempArtifactFile = path.join(os.tmpdir(), `control-center-agent-artifact-${crypto.randomUUID()}.tar.gz`);
  const artifactBytes = Buffer.from("synthetic-disposable-agent-artifact");
  await fs.writeFile(tempArtifactFile, artifactBytes, { mode: 0o600 });
  process.env.CONTROL_CENTER_AGENT_ARTIFACT_PATH = tempArtifactFile;
  process.env.CONTROL_CENTER_SOURCE_COMMIT = "a".repeat(40);
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

  async function requestBinary(method: string, route: string, body: unknown) {
    const response = await fetch(`${baseUrl}${route}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
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

    let ownerA = await login("phase-1b-a", "owner-a@example.test", "owner-a-password");
    const noSlugLogin = await request<{ csrfToken: string }>("POST", "/auth/login", { email: "owner-a@example.test", password: "owner-a-password" }, { "content-type": "application/json" });
    assert.equal(noSlugLogin.status, 200);
    assert.ok(noSlugLogin.body.csrfToken);
    const noSlugSessionCookie = cookieFrom(noSlugLogin.headers);
    await collections.sessions.deleteOne({ _id: new ObjectId(noSlugSessionCookie.replace("cc_session=", "")), orgId: orgA._id });

    const unknownReset = await request("POST", "/auth/password-reset/request", { email: "missing@example.test" }, { "content-type": "application/json" });
    assert.equal(unknownReset.status, 202);
    const resetRequest = await request("POST", "/auth/password-reset/request", { email: "owner-a@example.test" }, { "content-type": "application/json" });
    assert.equal(resetRequest.status, 202);
    assert.equal(JSON.stringify(resetRequest.body).includes("owner-a@example.test"), false);
    const storedReset = await collections.passwordResetTokens.findOne({ orgId: orgA._id, userId: ownerUserA._id });
    assert.ok(storedReset?._id);
    assert.equal(JSON.stringify(storedReset).includes("owner-a-password"), false);
    assert.equal(JSON.stringify(storedReset).includes("owner-a@example.test"), false);

    const manualResetToken = crypto.randomBytes(32).toString("base64url");
    await collections.passwordResetTokens.insertOne({ orgId: orgA._id, userId: ownerUserA._id, tokenHash: hashSecret(manualResetToken), expiresAt: new Date(Date.now() + 30 * 60_000), deliveryStatus: "sent", createdAt: new Date(), updatedAt: new Date() });
    const completeReset = await request("POST", "/auth/password-reset/complete", { token: manualResetToken, password: "owner-reset-password" }, { "content-type": "application/json" });
    assert.equal(completeReset.status, 200);
    assert.equal(await collections.sessions.countDocuments({ userId: ownerUserA._id }), 0);
    const reusedReset = await request("POST", "/auth/password-reset/complete", { token: manualResetToken, password: "owner-reset-password-2" }, { "content-type": "application/json" });
    assert.equal(reusedReset.status, 400);
    const oldOwnerRejected = await request("POST", "/auth/login", { email: "owner-a@example.test", password: "owner-a-password" }, { "content-type": "application/json" });
    assert.equal(oldOwnerRejected.status, 401);
    const ownerAAfterReset = await login("phase-1b-a", "owner-a@example.test", "owner-reset-password");
    const restoreOwnerPassword = await request("POST", "/auth/change-password", { currentPassword: "owner-reset-password", newPassword: "owner-a-password" }, jsonHeaders(ownerAAfterReset));
    assert.equal(restoreOwnerPassword.status, 200);
    ownerA = ownerAAfterReset;

    const createViewer = await request<{ id: string; oneTimePassword: string }>("POST", "/org/users", {
      email: "viewer-a@example.test",
      name: "Viewer A",
      role: "Viewer"
    }, jsonHeaders(ownerA));
    assert.equal(createViewer.status, 201);
    assert.ok(createViewer.headers.get("cache-control")?.includes("no-store"));
    assert.ok(createViewer.body.oneTimePassword);
    const viewerA = await login("phase-1b-a", "viewer-a@example.test", createViewer.body.oneTimePassword);
    const createAdministrator = await request<{ oneTimePassword: string }>("POST", "/org/users", {
      email: "administrator-a@example.test",
      name: "Administrator A",
      role: "Administrator"
    }, jsonHeaders(ownerA));
    assert.equal(createAdministrator.status, 201);
    const administratorA = await login("phase-1b-a", "administrator-a@example.test", createAdministrator.body.oneTimePassword);
    const deniedEnrollment = await request("POST", "/enrollments", { expiresInMinutes: 60 }, jsonHeaders(viewerA));
    assert.equal(deniedEnrollment.status, 403);

    const viewerLogout = await login("phase-1b-a", "viewer-a@example.test", createViewer.body.oneTimePassword);
    const viewerSessionId = new ObjectId(viewerLogout.cookie.match(/cc_session=([a-f0-9]{24})/)![1]);
    const logoutWithoutCsrf = await request("POST", "/auth/logout", {}, { "content-type": "application/json", cookie: viewerLogout.cookie });
    assert.equal(logoutWithoutCsrf.status, 403);
    assert.equal(await collections.sessions.countDocuments({ _id: viewerSessionId }), 1);

    const activeLogout = await request<{ ok: boolean }>("POST", "/auth/logout", {}, jsonHeaders(viewerLogout));
    assert.equal(activeLogout.status, 200);
    assert.equal(await collections.sessions.countDocuments({ _id: viewerSessionId }), 0);
    assert.match(activeLogout.headers.get("set-cookie") || "", /cc_session=;/);

    const expiredViewer = await login("phase-1b-a", "viewer-a@example.test", createViewer.body.oneTimePassword);
    const expiredViewerSessionId = new ObjectId(expiredViewer.cookie.match(/cc_session=([a-f0-9]{24})/)![1]);
    await collections.sessions.updateOne({ _id: expiredViewerSessionId }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
    const expiredLogout = await request<{ ok: boolean }>("POST", "/auth/logout", {}, jsonHeaders(expiredViewer));
    assert.equal(expiredLogout.status, 200);
    assert.equal(await collections.sessions.countDocuments({ _id: expiredViewerSessionId }), 0);
    assert.match(expiredLogout.headers.get("set-cookie") || "", /cc_session=;/);

    const ownerSessionId = new ObjectId(ownerA.cookie.match(/cc_session=([a-f0-9]{24})/)![1]);
    await collections.sessions.updateOne(
      { _id: ownerSessionId },
      { $set: { authenticatedAt: new Date(Date.now() - 11 * 60_000) } }
    );
    const recentAuthRequired = await request<{ error: string; code: string }>("POST", "/enrollments", { expiresInMinutes: 60 }, jsonHeaders(ownerA));
    assert.equal(recentAuthRequired.status, 403);
    assert.equal(recentAuthRequired.body.code, "RECENT_AUTH_REQUIRED");
    const adminRecentAuthRequired = await request<{ error: string; code: string }>("POST", "/admin/enrollment/generate", { name: "Stale enrollment", expiresInMinutes: 60, maxUses: 1 }, jsonHeaders(ownerA));
    assert.equal(adminRecentAuthRequired.status, 403);
    assert.equal(adminRecentAuthRequired.body.code, "RECENT_AUTH_REQUIRED");

    const failedReauthentication = await request<{ error: string; code: string }>("POST", "/auth/reauthenticate", { password: "incorrect-password" }, jsonHeaders(ownerA));
    assert.equal(failedReauthentication.status, 403);
    assert.equal(failedReauthentication.body.code, "REAUTHENTICATION_FAILED");

    const successfulReauthentication = await request<{ ok: boolean }>("POST", "/auth/reauthenticate", { password: "owner-a-password" }, jsonHeaders(ownerA));
    assert.equal(successfulReauthentication.status, 200);
    assert.equal(successfulReauthentication.body.ok, true);
    const refreshedSession = await collections.sessions.findOne({ _id: ownerSessionId });
    assert.ok(refreshedSession?.authenticatedAt);
    assert.ok(Date.now() - refreshedSession.authenticatedAt.getTime() < 10_000);

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
    const mergeToken = await request<{ token: string; serverId: string; installCommand: string; installScript: string }>("POST", "/servers/onboard", { url: "https://opsworkbench.org", expiresInMinutes: 60 }, jsonHeaders(ownerA));
    assert.equal(mergeToken.status, 201);
    assert.equal(mergeToken.body.serverId, String(legacyId), "URL-first onboarding must bind to the existing compact slug match");
    assert.match(mergeToken.body.installCommand, /printf '%s' 'ops-workbench' >"\$INSTALL_INPUT_DIR\/server-slug"/);
    assert.match(mergeToken.body.installScript, /^#!\/usr\/bin\/env bash\n/);
    assert.match(mergeToken.body.installScript, new RegExp(mergeToken.body.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(mergeToken.body.installScript, /read\s+-[^\n]*p/);
    assert.doesNotMatch(mergeToken.body.installScript, /CF-Access-Client-(?:Id|Secret)/);
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
    const syntheticTunnelToken = "synthetic-disposable-tunnel-token-value";
    const syntheticClientId = "synthetic-disposable-client-id";
    const syntheticClientSecret = "synthetic-disposable-client-secret-value";
    const connectivityOnboard = await request<{ serverId: string; token: string }>("POST", "/servers/onboard", { url: "https://connectivity-disposable.example.test", displayName: "Connectivity disposable", slug: "connectivity-disposable", expiresInMinutes: 60, cloudflare: { enabled: true, tunnel: { enabled: true, token: syntheticTunnelToken }, access: { enabled: true, clientId: syntheticClientId, clientSecret: syntheticClientSecret } } }, jsonHeaders(ownerA));
    assert.equal(connectivityOnboard.status, 201);
    const connectivityServerId = new ObjectId(connectivityOnboard.body.serverId);
    const encryptedConnectivity = await collections.connectivityConfigs.findOne({ orgId: orgA._id, serverId: connectivityServerId, provider: "cloudflare" });
    assert.ok(encryptedConnectivity?.tunnelToken && encryptedConnectivity.accessClientId && encryptedConnectivity.accessClientSecret);
    const storedConnectivity = JSON.stringify(encryptedConnectivity);
    for (const value of [syntheticTunnelToken, syntheticClientId, syntheticClientSecret]) assert.equal(storedConnectivity.includes(value), false, "connectivity values must be encrypted at rest");
    const safeConnectivity = await request<any>("GET", `/servers/${connectivityServerId}/connectivity`, undefined, jsonHeaders(ownerA));
    assert.equal(safeConnectivity.status, 200); assert.equal(safeConnectivity.body.configuration.secrets.tunnelToken, "configured");
    for (const value of [syntheticTunnelToken, syntheticClientId, syntheticClientSecret]) assert.equal(JSON.stringify(safeConnectivity.body).includes(value), false);
    const outOfOrderConnectivity = await request("POST", "/agent/bootstrap/connectivity", { enrollmentToken: connectivityOnboard.body.token }, { "content-type": "application/json" });
    assert.equal(outOfOrderConnectivity.status, 410);
    const artifact = await requestBinary("POST", "/agent/bootstrap/artifact", { enrollmentToken: connectivityOnboard.body.token });
    assert.equal(artifact.status, 200);
    assert.deepEqual(artifact.body, artifactBytes);
    assert.equal(artifact.headers.get("x-opsworkbench-artifact-sha256"), crypto.createHash("sha256").update(artifactBytes).digest("hex"));
    assert.equal(artifact.headers.get("x-opsworkbench-source-commit"), "a".repeat(40));
    const artifactReplay = await request("POST", "/agent/bootstrap/artifact", { enrollmentToken: connectivityOnboard.body.token }, { "content-type": "application/json" });
    assert.equal(artifactReplay.status, 410);
    const delivered = await request<any>("POST", "/agent/bootstrap/connectivity", { enrollmentToken: connectivityOnboard.body.token }, { "content-type": "application/json" });
    assert.equal(delivered.status, 200); assert.equal(delivered.body.providers[0].tunnel.token, syntheticTunnelToken); assert.equal(delivered.body.providers[0].access.clientSecret, syntheticClientSecret);
    const replayed = await request("POST", "/agent/bootstrap/connectivity", { enrollmentToken: connectivityOnboard.body.token }, { "content-type": "application/json" });
    assert.equal(replayed.status, 410);
    const replacement = await request<any>("PATCH", `/servers/${connectivityServerId}/connectivity/cloudflare`, { tunnelToken: "synthetic-disposable-replacement-token" }, jsonHeaders(ownerA));
    assert.equal(replacement.status, 200); assert.equal(replacement.body.configuration.secrets.tunnelToken, "configured"); assert.equal(JSON.stringify(replacement.body).includes("synthetic-disposable-replacement-token"), false);
    const deleteConnectivity = await request("DELETE", `/servers/${connectivityServerId}`, { mode: "remove" }, jsonHeaders(ownerA));
    assert.equal(deleteConnectivity.status, 200); assert.equal(await collections.connectivityConfigs.countDocuments({ serverId: connectivityServerId }), 0);
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

    const safeEnvironment = await request<{ id: string }>("POST", "/configuration/environments", { projectId: project.body.id, name: "Preview", kind: "preview", protected: false }, jsonHeaders(ownerA));
    assert.equal(safeEnvironment.status, 201);
    const productionEnvironment = await request("POST", "/configuration/environments", { projectId: project.body.id, name: "Production", kind: "production", protected: false }, jsonHeaders(ownerA));
    assert.equal(productionEnvironment.status, 403);
    const protectedEnvironment = await request("POST", "/configuration/environments", { projectId: project.body.id, name: "Protected staging", kind: "staging", protected: true }, jsonHeaders(ownerA));
    assert.equal(protectedEnvironment.status, 403);
    const editedEnvironment = await request("PATCH", `/configuration/environments/${safeEnvironment.body.id}`, { name: "Staging Preview", kind: "staging", protected: false }, jsonHeaders(ownerA));
    assert.equal(editedEnvironment.status, 200);
    const rejectedEnvironmentEdit = await request("PATCH", `/configuration/environments/${safeEnvironment.body.id}`, { name: "Protected Preview", kind: "preview", protected: true }, jsonHeaders(ownerA));
    assert.equal(rejectedEnvironmentEdit.status, 403);
    const productionScopedDefinition = await request("POST", "/configuration/definitions", { projectId: project.body.id, name: "PRODUCTION_ONLY_FLAG", description: "Production-only test flag", type: "text", secret: false, required: false, usage: "runtime", services: [], applicableEnvironments: ["production"], validation: { type: "text" }, restartRequirement: "restart", removalPermitted: true, browserDisplayPermitted: true, risk: "low" }, jsonHeaders(ownerA));
    assert.equal(productionScopedDefinition.status, 403);
    const safeDefinition = await request<{ id: string }>("POST", "/configuration/definitions", { projectId: project.body.id, name: "SAFE_PUBLIC_URL", description: "Safe public URL", type: "url", secret: false, required: false, usage: "runtime", services: [], applicableEnvironments: ["staging"], validation: { type: "url" }, restartRequirement: "reload", removalPermitted: true, browserDisplayPermitted: true, risk: "low" }, jsonHeaders(ownerA));
    assert.equal(safeDefinition.status, 201);
    const incompatibleDefinition = await request<{ id: string }>("POST", "/configuration/definitions", { projectId: project.body.id, name: "PREVIEW_ONLY_FLAG", description: "Preview-only flag", type: "text", secret: false, required: false, usage: "runtime", services: [], applicableEnvironments: ["preview"], validation: { type: "text" }, restartRequirement: "restart", removalPermitted: true, browserDisplayPermitted: true, risk: "low" }, jsonHeaders(ownerA));
    assert.equal(incompatibleDefinition.status, 201);
    const safeVersion = await request("POST", `/configuration/definitions/${safeDefinition.body.id}/versions`, { environmentId: safeEnvironment.body.id, operation: "add", value: "https://api.example.test", changeReason: "initial setup" }, jsonHeaders(ownerA));
    assert.equal(safeVersion.status, 201);
    const incompatibleVersion = await request("POST", `/configuration/definitions/${incompatibleDefinition.body.id}/versions`, { environmentId: safeEnvironment.body.id, operation: "add", value: "enabled", changeReason: "wrong environment" }, jsonHeaders(ownerA));
    assert.equal(incompatibleVersion.status, 400);

    const anonymousSystemHealth = await request("GET", "/system/health");
    assert.equal(anonymousSystemHealth.status, 401);
    for (const session of [ownerA, administratorA, viewerA]) {
      const systemHealth = await request<any>("GET", "/system/health", undefined, jsonHeaders(session));
      assert.equal(systemHealth.status, 200);
      assert.equal(systemHealth.body.mongo.connected, true);
      assert.equal(systemHealth.body.audit.status, "ready");
      assert.equal(systemHealth.body.ai.organizationState, "disabled");
    }
    const diagnosticsDenied = await request("GET", "/system/diagnostics", undefined, jsonHeaders(viewerA));
    assert.equal(diagnosticsDenied.status, 403);
    const diagnostics = await request<any>("GET", "/system/diagnostics", undefined, jsonHeaders(ownerA));
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.body.permissions.organizationScoped, true);
    assert.equal(JSON.stringify(diagnostics.body).includes("mongodb://"), false);

    process.env.AI_ASSISTANT_ENABLED = "true";
    process.env.AI_PROVIDER = "mock";
    process.env.AI_MODEL = "deterministic-v1";
    process.env.AI_ALLOWED_PROVIDERS = "mock";
    process.env.AI_ALLOWED_MODELS = "deterministic-v1";
    await collections.organizations.updateOne({ _id: orgA._id }, { $set: { aiAssistant: { enabled: true, provider: "mock", model: "deterministic-v1", maximumRequestsPerUserPerHour: 20, maximumRequestsPerOrganizationPerDay: 200, maximumConcurrentRequests: 3, allowedScopeTypes: ["server", "application"], dataRetentionMode: "provider-dependent", providerDataRetentionAcknowledgedAt: new Date(), providerDataRetentionAcknowledgedBy: ownerUserA._id, updatedAt: new Date(), updatedBy: ownerUserA._id } } });
    const aiAdminDenied = await request("GET", "/org/ai-assistant", undefined, jsonHeaders(viewerA));
    assert.equal(aiAdminDenied.status, 403);
    const aiSettings = await request("GET", "/org/ai-assistant", undefined, jsonHeaders(ownerA));
    assert.equal(aiSettings.status, 200);
    assert.equal(JSON.stringify(aiSettings.body).includes(process.env.AI_API_KEY || "impossible-secret"), false);
    const invalidProvider = await request("PUT", "/org/ai-assistant", { enabled: true, provider: "attacker", model: "deterministic-v1", monthlyRequestLimit: null, monthlyTokenLimit: null, maximumRequestsPerUserPerHour: 20, maximumRequestsPerOrganizationPerDay: 200, maximumConcurrentRequests: 3, allowedScopeTypes: ["server"], retentionAcknowledged: true }, jsonHeaders(ownerA));
    assert.equal(invalidProvider.status, 400);
    const serverAnalysis = await request<{ result: { executedActions: unknown[] }; metadata: { noActionsExecuted: boolean } }>("POST", "/ai-assistant/analyze", { scope: { type: "server", id: credentials.serverId }, question: "Explain this server status." }, jsonHeaders(ownerA));
    assert.equal(serverAnalysis.status, 200);
    assert.deepEqual(serverAnalysis.body.result.executedActions, []);
    assert.equal(serverAnalysis.body.metadata.noActionsExecuted, true);
    const appAnalysis = await request("POST", "/ai-assistant/analyze", { scope: { type: "application", id: project.body.id }, question: "Why is this application unhealthy?" }, jsonHeaders(ownerA));
    assert.equal(appAnalysis.status, 200);
    const unknownAnalysis = await request("POST", "/ai-assistant/analyze", { scope: { type: "server", id: new ObjectId().toHexString() }, question: "Explain status." }, jsonHeaders(ownerA));
    assert.equal(unknownAnalysis.status, 404);
    await collections.organizations.updateOne({ _id: orgA._id }, { $set: { "aiAssistant.maximumRequestsPerUserPerHour": 1 } });
    const limitedAnalysis = await request("POST", "/ai-assistant/analyze", { scope: { type: "server", id: credentials.serverId }, question: "Explain this server again." }, jsonHeaders(ownerA));
    assert.equal(limitedAnalysis.status, 429);
    assert.equal((await collections.auditEvents.findOne({ orgId: orgA._id, action: "ai.assistant.rate_limited" }))?.metadata?.reason, "user_hourly");
    await collections.organizations.updateOne({ _id: orgA._id }, { $set: { "aiAssistant.maximumRequestsPerUserPerHour": 20, "aiAssistant.monthlyRequestLimit": 2 } });
    const monthlyRequestLimited = await request("POST", "/ai-assistant/analyze", { scope: { type: "server", id: credentials.serverId }, question: "Monthly request limit check." }, jsonHeaders(ownerA));
    assert.equal(monthlyRequestLimited.status, 429);
    await collections.aiUsage.updateOne({ orgId: orgA._id, outcome: "success" }, { $set: { inputTokens: 10, outputTokens: 5 } });
    await collections.organizations.updateOne({ _id: orgA._id }, { $unset: { "aiAssistant.monthlyRequestLimit": "" }, $set: { "aiAssistant.monthlyTokenLimit": 5 } });
    const monthlyTokenLimited = await request("POST", "/ai-assistant/analyze", { scope: { type: "server", id: credentials.serverId }, question: "Monthly token limit check." }, jsonHeaders(ownerA));
    assert.equal(monthlyTokenLimited.status, 429);
    await collections.organizations.updateOne({ _id: orgA._id }, { $unset: { "aiAssistant.monthlyTokenLimit": "" }, $set: { "aiAssistant.maximumConcurrentRequests": 1 } });
    const occupied = await collections.aiUsage.insertOne({ orgId: orgA._id, userId: ownerUserA._id, provider: "mock", model: "deterministic-v1", scopeType: "server", contextBytes: 1, outcome: "pending", concurrencySlot: 0, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    const concurrentLimited = await request("POST", "/ai-assistant/analyze", { scope: { type: "server", id: credentials.serverId }, question: "Concurrent limit check." }, jsonHeaders(ownerA));
    assert.equal(concurrentLimited.status, 429);
    await collections.aiUsage.deleteOne({ _id: occupied.insertedId });
    await collections.organizations.updateOne({ _id: orgA._id }, { $set: { "aiAssistant.maximumConcurrentRequests": 3 } });
    assert.equal(await collections.aiUsage.countDocuments({ orgId: orgA._id, outcome: "success" }), 2);

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
    const discoveryPayload = { ...telemetryPayload, heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "fake-agent/1.1" }, discovery: { collectedAt: new Date().toISOString(), dockerInstalled: true, nginxInstalled: true, composeProjects: [], applications: [], warnings: ["unreadable_path"], discoveryTruncated: true, truncationCategories: ["applications"], repositories: [{ path: "/srv/phase-1b", branch: "main", commit: "a".repeat(40), remote: credentialRemote, dirty: false }] } };
    const discoveryPoll = await poll(credentials, discoveryPayload); assert.equal(discoveryPoll.status, 200);
    const storedDiscovery = await collections.telemetry.findOne({ orgId: orgA._id, serverId: new ObjectId(credentials.serverId), discovery: { $exists: true } }, { sort: { collectedAt: -1 } });
    const storedRemote = ((storedDiscovery?.discovery as { repositories?: Array<{ remote?: string }> })?.repositories || [])[0]?.remote;
    assert.equal(storedRemote, "https://example.test/org/repo.git"); assert.equal(JSON.stringify(storedDiscovery?.discovery).includes("not-a-credential"), false);

    const ownerProjectOverview = await request<any>("GET", `/projects/${project.body.id}/overview`, undefined, jsonHeaders(ownerA));
    assert.equal(ownerProjectOverview.status, 200);
    assert.equal(ownerProjectOverview.body.schemaVersion, "project-overview-v1");
    assert.equal(ownerProjectOverview.body.project.id, project.body.id);
    assert.equal(ownerProjectOverview.body.project.paths.repository, "/srv/phase-1b");
    assert.equal(ownerProjectOverview.body.revision.observedBranch, "main");
    assert.equal(ownerProjectOverview.body.revision.confidence, "conflicting");
    assert.ok(ownerProjectOverview.body.revision.conflicts.includes("revision-evidence-conflict"));
    assert.equal(ownerProjectOverview.body.services[0].name, "web");
    assert.equal(ownerProjectOverview.body.health[0].success, false);
    assert.ok(ownerProjectOverview.body.recent.tasks.length <= 5);
    assert.ok(ownerProjectOverview.body.recent.audit.length <= 5);
    assert.deepEqual(ownerProjectOverview.body.availability, { releases: "unavailable", deployments: "unavailable", rollbacks: "unavailable", logs: "unavailable" });
    const serializedOverview = JSON.stringify(ownerProjectOverview.body);
    for (const forbidden of [credentials.agentSecret, "not-a-credential", "mongodb://", "agentSecretHash", "encryptedConnectionString", "payload"]) assert.equal(serializedOverview.includes(forbidden), false);

    const overviewViewer = await login("phase-1b-a", "viewer-a@example.test", createViewer.body.oneTimePassword);
    const viewerProjectOverview = await request<any>("GET", `/projects/${project.body.id}/overview`, undefined, jsonHeaders(overviewViewer));
    assert.equal(viewerProjectOverview.status, 200, JSON.stringify(viewerProjectOverview.body));
    assert.equal(viewerProjectOverview.body.project.paths, undefined);
    assert.equal(viewerProjectOverview.body.recent.audit, null);
    assert.ok(Array.isArray(viewerProjectOverview.body.recent.tasks));
    const invalidProjectOverview = await request("GET", "/projects/not-an-object-id/overview", undefined, jsonHeaders(ownerA));
    assert.equal(invalidProjectOverview.status, 404);

    const historyNow = new Date();
    const olderDeploymentTaskId = new ObjectId();
    const olderDeployment = await collections.projectDeployments.insertOne({ orgId: orgA._id, projectId: new ObjectId(project.body.id), serverId: new ObjectId(credentials.serverId), environment: "staging", requestedRevision: "1".repeat(40), deployedRevision: "1".repeat(40), branch: "main", artifactDigest: "a".repeat(64), releaseId: "release-one", taskId: olderDeploymentTaskId, actorId: ownerUserA._id, status: "succeeded", validation: { health: "passed", readiness: "passed", checkedAt: historyNow }, rollbackAvailable: true, evidenceConfidence: "verified", auditEventIds: [], createdAt: new Date(historyNow.getTime() - 1000), updatedAt: historyNow });
    const newerDeployment = await collections.projectDeployments.insertOne({ orgId: orgA._id, projectId: new ObjectId(project.body.id), serverId: new ObjectId(credentials.serverId), environment: "staging", requestedRevision: "2".repeat(40), taskId: new ObjectId(), actorId: ownerUserA._id, status: "failed", validation: { health: "failed", readiness: "not_run", checkedAt: historyNow }, rollbackAvailable: false, evidenceConfidence: "reported", failureClassification: "health", auditEventIds: [], createdAt: historyNow, updatedAt: historyNow });
    await collections.projectRollbacks.insertOne({ orgId: orgA._id, projectId: new ObjectId(project.body.id), serverId: new ObjectId(credentials.serverId), sourceDeploymentId: olderDeployment.insertedId, restoredDeploymentId: newerDeployment.insertedId, restoredReleaseId: "release-two", taskId: new ObjectId(), actorId: ownerUserA._id, reasonClassification: "operator_requested", status: "succeeded", verification: { health: "passed", readiness: "passed", checkedAt: historyNow }, auditEventIds: [], createdAt: historyNow, updatedAt: historyNow });
    await collections.projectRollbacks.insertOne({ orgId: orgA._id, projectId: new ObjectId(project.body.id), serverId: new ObjectId(credentials.serverId), sourceDeploymentId: newerDeployment.insertedId, taskId: new ObjectId(), actorId: ownerUserA._id, reasonClassification: "validation_failed", status: "failed", verification: { health: "failed", readiness: "not_run", checkedAt: historyNow }, failureClassification: "health", auditEventIds: [], createdAt: new Date(historyNow.getTime() - 500), updatedAt: historyNow });
    await assert.rejects(() => collections.projectDeployments.insertOne({ orgId: orgA._id, projectId: new ObjectId(project.body.id), serverId: new ObjectId(credentials.serverId), environment: "staging", requestedRevision: "3".repeat(40), taskId: olderDeploymentTaskId, actorId: ownerUserA._id, status: "planned", validation: { health: "not_run", readiness: "not_run" }, rollbackAvailable: false, evidenceConfidence: "reported", auditEventIds: [], createdAt: historyNow, updatedAt: historyNow }));
    const deployments = await request<any>("GET", `/projects/${project.body.id}/deployments?limit=1`, undefined, jsonHeaders(ownerA));
    assert.equal(deployments.status, 200); assert.equal(deployments.body.records.length, 1); assert.equal(deployments.body.hasMore, true); assert.equal(deployments.body.records[0].status, "failed"); assert.ok(deployments.body.records[0].actor.id);
    const viewerDeployments = await request<any>("GET", `/projects/${project.body.id}/deployments`, undefined, jsonHeaders(overviewViewer));
    assert.equal(viewerDeployments.status, 200); assert.equal(viewerDeployments.body.records[0].actor, undefined);
    const rollbacks = await request<any>("GET", `/projects/${project.body.id}/rollbacks`, undefined, jsonHeaders(ownerA));
    assert.equal(rollbacks.status, 200); assert.equal(rollbacks.body.records.length, 2); assert.equal(rollbacks.body.records[0].sourceDeploymentId, olderDeployment.insertedId.toHexString()); assert.equal(rollbacks.body.records[1].status, "failed");
    const historyOverview = await request<any>("GET", `/projects/${project.body.id}/overview`, undefined, jsonHeaders(ownerA));
    assert.equal(historyOverview.body.availability.deployments, "available"); assert.equal(historyOverview.body.availability.rollbacks, "available"); assert.equal(historyOverview.body.recent.deployments.length, 2); assert.equal(historyOverview.body.recent.rollbacks.length, 2);
    assert.doesNotMatch(JSON.stringify({ deployments: deployments.body, rollbacks: rollbacks.body }), /password|token|bearer|mongodb:\/\//i);
    const missingHistoryId = new ObjectId().toHexString();
    assert.equal((await request("GET", `/projects/${missingHistoryId}/deployments`, undefined, jsonHeaders(ownerA))).status, 404);
    await collections.projects.updateOne({ _id: new ObjectId(project.body.id) }, { $set: { archivedAt: historyNow } });
    const archivedHistory = await request<any>("GET", `/projects/${project.body.id}/deployments`, undefined, jsonHeaders(ownerA));
    assert.equal(archivedHistory.status, 200); assert.equal(archivedHistory.body.project.archived, true);
    await collections.projects.updateOne({ _id: new ObjectId(project.body.id) }, { $unset: { archivedAt: "" } });

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
    const ownerBResult = await collections.users.insertOne({ orgId: orgBResult.insertedId, email: "owner-b@example.test", name: "Owner B", role: "Owner", passwordHash: hashPassword("owner-b-password"), createdAt: new Date(), updatedAt: new Date() });
    await collections.organizations.updateOne({ _id: orgBResult.insertedId }, { $set: { aiAssistant: { enabled: true, provider: "mock", model: "deterministic-v1", maximumRequestsPerUserPerHour: 20, maximumRequestsPerOrganizationPerDay: 200, maximumConcurrentRequests: 3, allowedScopeTypes: ["server", "application"], dataRetentionMode: "provider-dependent", providerDataRetentionAcknowledgedAt: new Date(), providerDataRetentionAcknowledgedBy: ownerBResult.insertedId, updatedAt: new Date(), updatedBy: ownerBResult.insertedId } } });
    const ownerB = await login("phase-1b-b", "owner-b@example.test", "owner-b-password");
    await collections.organizations.updateOne({ _id: orgA._id }, { $set: { "aiAssistant.enabled": false } });
    const [orgAHealth, orgBHealth] = await Promise.all([
      request<any>("GET", "/system/health", undefined, jsonHeaders(ownerA)),
      request<any>("GET", "/system/health", undefined, jsonHeaders(ownerB))
    ]);
    assert.equal(orgAHealth.body.ai.organizationState, "disabled");
    assert.equal(orgBHealth.body.ai.organizationState, "enabled");
    const crossOrgAnalysis = await request("POST", "/ai-assistant/analyze", { scope: { type: "application", id: project.body.id }, question: "Explain this application." }, jsonHeaders(ownerB));
    assert.equal(crossOrgAnalysis.status, 404);
    const orgBServers = await request<{ servers: unknown[] }>("GET", "/servers", undefined, jsonHeaders(ownerB));
    assert.equal(orgBServers.status, 200);
    assert.equal(orgBServers.body.servers.length, 0);
    const orgBProjects = await request<{ projects: unknown[] }>("GET", "/projects", undefined, jsonHeaders(ownerB));
    assert.equal(orgBProjects.status, 200);
    assert.equal(orgBProjects.body.projects.length, 0);
    const crossProject = await request("GET", `/projects/${project.body.id}/status`, undefined, jsonHeaders(ownerB));
    assert.equal(crossProject.status, 404);
    const crossProjectOverview = await request("GET", `/projects/${project.body.id}/overview`, undefined, jsonHeaders(ownerB));
    assert.equal(crossProjectOverview.status, 404);
    assert.equal((await request("GET", `/projects/${project.body.id}/deployments`, undefined, jsonHeaders(ownerB))).status, 404);
    assert.equal((await request("GET", `/projects/${project.body.id}/rollbacks`, undefined, jsonHeaders(ownerB))).status, 404);
    const orgBAudit = await request<{ events: unknown[] }>("GET", "/org/audit", undefined, jsonHeaders(ownerB));
    assert.equal(orgBAudit.status, 200);
    assert.equal(JSON.stringify(orgBAudit.body).includes(project.body.id), false);

    await collections.servers.updateOne({ _id: new ObjectId(credentials.serverId), orgId: orgA._id }, { $set: { status: "online", lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) } });
    const overview = await request("GET", "/overview", undefined, jsonHeaders(ownerA));
    assert.equal(overview.status, 200);
    const staleServer = await collections.servers.findOne({ _id: new ObjectId(credentials.serverId), orgId: orgA._id });
    assert.equal(staleServer?.status, "offline");

    const reauthForUserManagement = await request("POST", "/auth/reauthenticate", { password: "owner-a-password" }, jsonHeaders(ownerA));
    assert.equal(reauthForUserManagement.status, 200);
    const disposable = await request<{ id: string; oneTimePassword: string }>("POST", "/org/users", { email: "disposable@example.test", name: "Disposable User", role: "Viewer" }, jsonHeaders(ownerA));
    assert.equal(disposable.status, 201);
    await login("phase-1b-a", "disposable@example.test", disposable.body.oneTimePassword);
    const resetDisposable = await request<{ ok: boolean; delivery: string; oneTimePassword?: string }>("POST", `/org/users/${disposable.body.id}/reset-password`, {}, jsonHeaders(ownerA));
    assert.equal(resetDisposable.status, 200);
    assert.ok(resetDisposable.headers.get("cache-control")?.includes("no-store"));
    assert.equal(resetDisposable.body.ok, true);
    assert.equal(resetDisposable.body.oneTimePassword, undefined);
    assert.ok(await collections.passwordResetTokens.findOne({ orgId: orgA._id, userId: new ObjectId(disposable.body.id) }));
    assert.ok(await collections.sessions.countDocuments({ userId: new ObjectId(disposable.body.id) }) >= 1);
    await login("phase-1b-a", "disposable@example.test", disposable.body.oneTimePassword);
    const disposableResetToken = crypto.randomBytes(32).toString("base64url");
    await collections.passwordResetTokens.insertOne({ orgId: orgA._id, userId: new ObjectId(disposable.body.id), tokenHash: hashSecret(disposableResetToken), expiresAt: new Date(Date.now() + 30 * 60_000), deliveryStatus: "sent", createdAt: new Date(), updatedAt: new Date() });
    const completeDisposableReset = await request("POST", "/auth/password-reset/complete", { token: disposableResetToken, password: "replacement-password-long" }, { "content-type": "application/json" });
    assert.equal(completeDisposableReset.status, 200);
    assert.equal(await collections.sessions.countDocuments({ userId: new ObjectId(disposable.body.id) }), 0);
    const oldPasswordRejected = await request("POST", "/auth/login", { organizationSlug: "phase-1b-a", email: "disposable@example.test", password: disposable.body.oneTimePassword }, { "content-type": "application/json" });
    assert.equal(oldPasswordRejected.status, 401);
    const resetLogin = await login("phase-1b-a", "disposable@example.test", "replacement-password-long");
    const badPasswordChange = await request("POST", "/auth/change-password", { currentPassword: "wrong-current-password", newPassword: "replacement-password-long" }, jsonHeaders(resetLogin));
    assert.equal(badPasswordChange.status, 403);
    const changedPassword = await request("POST", "/auth/change-password", { currentPassword: "replacement-password-long", newPassword: "replacement-password-final" }, jsonHeaders(resetLogin));
    assert.equal(changedPassword.status, 200);
    const changedUser = await collections.users.findOne({ _id: new ObjectId(disposable.body.id) });
    assert.equal(changedUser?.mustChangePassword, undefined);
    assert.equal(changedUser?.inviteIssuedAt, undefined);
    const resetPasswordRejected = await request("POST", "/auth/login", { organizationSlug: "phase-1b-a", email: "disposable@example.test", password: "replacement-password-long" }, { "content-type": "application/json" });
    assert.equal(resetPasswordRejected.status, 401);
    await login("phase-1b-a", "disposable@example.test", "replacement-password-final");
    const selfDeleteDenied = await request("DELETE", `/org/users/${ownerUserA._id}`, undefined, jsonHeaders(ownerA));
    assert.equal(selfDeleteDenied.status, 403);
    const deleteDisposable = await request("DELETE", `/org/users/${disposable.body.id}`, undefined, jsonHeaders(ownerA));
    assert.equal(deleteDisposable.status, 200);
    assert.equal(await collections.users.countDocuments({ _id: new ObjectId(disposable.body.id) }), 0);
    assert.equal(await collections.sessions.countDocuments({ userId: new ObjectId(disposable.body.id) }), 0);
    const sensitiveAuditSnapshot = JSON.stringify(await collections.auditEvents.find({ action: { $in: ["user.password.change", "user.password.reset", "user.delete"] } }).toArray());
    assert.equal(sensitiveAuditSnapshot.includes("replacement-password-long"), false);
    assert.equal(sensitiveAuditSnapshot.includes(disposableResetToken), false);

    const auditFailure = await collections.auditEvents.findOne({ action: "authorization.failure", result: "denied" });
    assert.ok(auditFailure?.requestId);
    assert.equal(JSON.stringify(auditFailure).includes(credentials.agentSecret), false);
  } finally {
    await fs.rm(tempCredentialFile, { force: true });
    await fs.rm(tempArtifactFile, { force: true });
    await client.db(isolated.dbName).dropDatabase();
    await client.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
