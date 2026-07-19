import path from "node:path";
import type { DiscoveredSetting } from "@control-center/shared";
import type { ServerDoc } from "./models.js";
import { audit } from "./audit.js";
import { collections } from "./db.js";

function isWithin(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export async function ingestConfigurationDiscovery(server: ServerDoc, settings: DiscoveredSetting[], requestId: string) {
  if (!server._id || settings.length === 0) return { received: settings.length, mapped: 0 };
  const projects = await collections.projects.find({ orgId: server.orgId, primaryServerId: server._id, archivedAt: { $exists: false } }).toArray();
  let mapped = 0;
  const now = new Date();
  for (const setting of settings) {
    const project = projects
      .filter((candidate) => candidate.repoPath && isWithin(candidate.repoPath, setting.applicationPath))
      .sort((left, right) => (right.repoPath?.length || 0) - (left.repoPath?.length || 0))[0];
    if (!project?._id) continue;
    await collections.configurationDefinitions.updateOne(
      { orgId: server.orgId, projectId: project._id, applicationPath: setting.applicationPath, name: setting.name },
      {
        $set: {
          services: setting.services,
          sources: setting.sources,
          sourcePaths: setting.sourcePaths,
          ...(setting.authoritativePath ? { authoritativePath: setting.authoritativePath } : {}),
          ...(setting.configured === true ? { status: "configured" as const } : {}),
          discovered: true,
          updatedAt: now
        },
        $setOnInsert: {
          orgId: server.orgId,
          projectId: project._id,
          applicationPath: setting.applicationPath,
          name: setting.name,
          type: setting.type,
          secret: setting.secret,
          required: setting.required,
          ...(setting.provider ? { provider: setting.provider } : {}),
          usage: setting.usage,
          status: setting.configured ? "configured" as const : "unverified" as const,
          createdAt: now
        }
      },
      { upsert: true }
    );
    mapped += 1;
  }
  await audit({
    orgId: server.orgId,
    actorType: "agent",
    actorId: server.agentId,
    action: "configuration.discovery.received",
    targetType: "server",
    targetId: server._id,
    result: "success",
    requestId,
    metadata: { received: settings.length, mapped }
  });
  return { received: settings.length, mapped };
}
