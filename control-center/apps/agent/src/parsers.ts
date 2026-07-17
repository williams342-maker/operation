export function parseDockerPsLine(line: string) {
  const row = JSON.parse(line);
  return {
    name: row.Names || row.Name || "unknown",
    image: row.Image,
    state: row.State || row.Status || "unknown",
    status: row.Status
  };
}

export function parseComposePsLine(line: string, fallbackProject: string, configPath?: string) {
  const row = JSON.parse(line);
  return {
    projectName: row.Project || fallbackProject,
    service: row.Service || row.Name || "unknown",
    state: row.State || "unknown",
    configPath
  };
}
