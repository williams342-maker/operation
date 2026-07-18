export function enrollmentEnv(token: string, slug?: string, controlCenter = "https://opsworkbench.org") {
  return `CONTROL_CENTER_URL=${controlCenter}\nCONTROL_CENTER_ENROLLMENT_TOKEN=${token}\n${slug ? `CONTROL_CENTER_SERVER_SLUG=${slug}\n` : ""}`;
}

export function enrollmentInstallCommand(token: string, controlCenter = "https://opsworkbench.org", slug?: string) {
  const lines = [
    `curl -fsSL ${controlCenter}/install.sh | sudo env \\`,
    `  CONTROL_CENTER_URL="${controlCenter}" \\`,
    `  CONTROL_CENTER_ENROLLMENT_TOKEN="${token}" \\`,
    ...(slug ? [`  CONTROL_CENTER_SERVER_SLUG="${slug}" \\`] : []),
    "  bash"
  ];
  return lines.join("\n");
}
