import os from "node:os";
import { loadConfig, saveConfig } from "./config.js";
import { enroll, signedPost } from "./client.js";
import { collectCompose, collectDocker, collectGit, collectHttp, collectMongo, collectSystem } from "./inspectors.js";

async function maybeEnroll() {
  const config = loadConfig();
  const token = process.env.CONTROL_CENTER_ENROLLMENT_TOKEN;
  if (config.agentId && config.agentSecret) return config;
  if (!token) throw new Error("Agent is not enrolled. Set CONTROL_CENTER_ENROLLMENT_TOKEN for first run.");
  const result = await enroll(config.controlCenterUrl, token, os.hostname(), config.agentVersion);
  const nextConfig = { ...config, agentId: result.agentId, agentSecret: result.agentSecret, pollIntervalSeconds: result.pollIntervalSeconds };
  saveConfig(nextConfig);
  return nextConfig;
}

async function pollOnce() {
  const config = await maybeEnroll();
  const initial = {
    heartbeat: { collectedAt: new Date().toISOString(), agentVersion: config.agentVersion },
    metrics: await collectSystem(config.agentVersion)
  };
  const response = await signedPost(config, "/api/agent/poll", initial);
  const task = response.tasks?.[0];
  if (!task) return;
  const projects = task.config.projects || [];
  const payload = {
    heartbeat: { collectedAt: new Date().toISOString(), agentVersion: config.agentVersion },
    metrics: await collectSystem(config.agentVersion),
    docker: await collectDocker().catch(() => []),
    compose: await collectCompose(config, projects).catch(() => []),
    git: await collectGit(config, projects).catch(() => []),
    httpHealth: await collectHttp(task.config.httpHealthChecks || []).catch(() => []),
    mongo: await collectMongo(config, task.config.mongoChecks || []).catch(() => [])
  };
  await signedPost(config, "/api/agent/poll", payload);
}

async function main() {
  const config = await maybeEnroll();
  await pollOnce();
  setInterval(() => {
    void pollOnce().catch((error) => console.error(`[agent] poll failed: ${error.message}`));
  }, config.pollIntervalSeconds * 1000);
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { pollOnce };
