export function parseDockerPsLine(line: string) {
  const row = JSON.parse(line);
  return {
    name: row.Names || row.Name || "unknown",
    image: row.Image,
    state: row.State || row.Status || "unknown",
    status: row.Status
  };
}

export function parseDockerRestartLine(line: string) {
  const separator = line.lastIndexOf(" ");
  if (separator <= 0) throw new Error("Invalid Docker restart row");
  const name = JSON.parse(line.slice(0, separator));
  const restartCount = Number(line.slice(separator + 1));
  if (typeof name !== "string" || !Number.isInteger(restartCount) || restartCount < 0) throw new Error("Invalid Docker restart row");
  return { name: name.replace(/^\//, ""), restartCount };
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
