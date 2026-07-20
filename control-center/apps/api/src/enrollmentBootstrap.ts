type BootstrapInput = {
  controlCenterUrl: string;
  serverSlug?: string;
  enrollmentToken: string;
  cloudflareClientId: string;
  cloudflareClientSecret: string;
  agentRevision: string;
  agentArchiveSha256: string;
};

function encoded(value: string) { return Buffer.from(value, "utf8").toString("base64"); }

export function enrollmentBootstrapScript(input: BootstrapInput) {
  if (!/^https:\/\//.test(input.controlCenterUrl)) throw new Error("Control Center URL must use HTTPS");
  if (!/^[0-9a-f]{40}$/.test(input.agentRevision)) throw new Error("Configured agent revision is invalid");
  if (!/^[0-9a-f]{64}$/.test(input.agentArchiveSha256)) throw new Error("Configured agent archive digest is invalid");
  const values: Record<string, string> = {
    "control-center-url": input.controlCenterUrl,
    "enrollment-token": input.enrollmentToken,
    "cf-access-client-id": input.cloudflareClientId,
    "cf-access-client-secret": input.cloudflareClientSecret,
    "agent-revision": input.agentRevision,
    "agent-archive-sha256": input.agentArchiveSha256,
    ...(input.serverSlug ? { "server-slug": input.serverSlug } : {})
  };
  const writes = Object.entries(values).map(([name, value]) => `printf '%s' '${encoded(value)}' | base64 -d >"$INPUT_DIR/${name}"`).join("\n");
  return `#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[ "$(id -u)" -eq 0 ] || { echo "Run this bootstrap from a root shell (sudo -i)." >&2; exit 1; }
BOOTSTRAP_FILE="${"${BASH_SOURCE[0]}"}"
[ -f "$BOOTSTRAP_FILE" ] || { echo "Save this bootstrap to a protected file before running it." >&2; exit 1; }
INPUT_DIR="$(mktemp -d)"
cleanup() { rm -rf -- "$INPUT_DIR"; rm -f -- "$BOOTSTRAP_FILE"; }
trap cleanup EXIT
${writes}
{
  printf 'url = "%s/install.sh"\n' "$(cat "$INPUT_DIR/control-center-url")"
  printf 'output = "%s/installer.sh"\n' "$INPUT_DIR"
  printf 'header = "CF-Access-Client-Id: %s"\n' "$(cat "$INPUT_DIR/cf-access-client-id")"
  printf 'header = "CF-Access-Client-Secret: %s"\n' "$(cat "$INPUT_DIR/cf-access-client-secret")"
  printf '%s\n' 'fail' 'silent' 'show-error' 'location' 'connect-timeout = 10' 'retry = 5' 'retry-all-errors'
} >"$INPUT_DIR/curl.conf"
curl --config "$INPUT_DIR/curl.conf"
head -n 1 "$INPUT_DIR/installer.sh" | grep -qx '#!/usr/bin/env bash'
bash -n "$INPUT_DIR/installer.sh"
OPSWORKBENCH_INSTALL_INPUT_DIR="$INPUT_DIR" bash "$INPUT_DIR/installer.sh"
`;
}
