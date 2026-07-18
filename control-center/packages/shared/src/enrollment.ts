export function enrollmentEnv(token: string) {
  return `CONTROL_CENTER_ENROLLMENT_TOKEN=${token}\n`;
}

export function enrollmentInstallCommand(token: string, controlCenter = "https://opsworkbench.org") {
  return `curl -fsSL ${controlCenter}/install.sh | \\\n+CONTROL_CENTER=${controlCenter} \\\n+TOKEN=${token} \\\n+sudo -E bash`;
}
