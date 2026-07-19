export function enrollmentEnv(token: string, slug?: string, controlCenter = "https://opsworkbench.org") {
  return `CONTROL_CENTER_URL=${controlCenter}\nCONTROL_CENTER_ENROLLMENT_TOKEN=${token}\n${slug ? `CONTROL_CENTER_SERVER_SLUG=${slug}\n` : ""}`;
}

export function enrollmentInstallCommand(token: string, controlCenter = "https://opsworkbench.org", slug?: string) {
  void token; // Tokens must never be embedded in clipboard text, shell history, or process arguments.
  const lines = [
    "# Run from an interactive root shell (use sudo -i once if needed).",
    "set +o history 2>/dev/null || true",
    "umask 077",
    "read -rsp 'Enrollment token: ' ENROLLMENT_TOKEN; printf '\\n'",
    "read -rp 'Cloudflare Access client ID: ' CF_CLIENT_ID",
    "read -rsp 'Cloudflare Access client secret: ' CF_CLIENT_SECRET; printf '\\n'",
    "INSTALL_INPUT_DIR=\"$(mktemp -d)\"",
    "trap 'rm -rf -- \"$INSTALL_INPUT_DIR\"; unset ENROLLMENT_TOKEN CF_CLIENT_ID CF_CLIENT_SECRET INSTALL_INPUT_DIR' EXIT",
    "printf '%s' \"$ENROLLMENT_TOKEN\" >\"$INSTALL_INPUT_DIR/enrollment-token\"",
    "printf '%s' \"$CF_CLIENT_ID\" >\"$INSTALL_INPUT_DIR/cf-access-client-id\"",
    "printf '%s' \"$CF_CLIENT_SECRET\" >\"$INSTALL_INPUT_DIR/cf-access-client-secret\"",
    `printf '%s' '${controlCenter}' >"$INSTALL_INPUT_DIR/control-center-url"`,
    ...(slug ? [`printf '%s' '${slug}' >"$INSTALL_INPUT_DIR/server-slug"`] : []),
    "cat >\"$INSTALL_INPUT_DIR/curl.conf\" <<EOF",
    `url = "${controlCenter}/install.sh"`,
    "output = \"installer.sh\"",
    "silent",
    "show-error",
    "connect-timeout = 10",
    "retry = 5",
    "retry-all-errors",
    "retry-delay = 2",
    "header = \"CF-Access-Client-Id: $CF_CLIENT_ID\"",
    "header = \"CF-Access-Client-Secret: $CF_CLIENT_SECRET\"",
    "write-out = \"%{http_code} %{content_type}\\n\"",
    "EOF",
    "cd \"$INSTALL_INPUT_DIR\"",
    "read -r HTTP_STATUS CONTENT_TYPE < <(curl --config curl.conf)",
    "[ \"$HTTP_STATUS\" = 200 ] || { echo \"Installer download failed: HTTP $HTTP_STATUS\" >&2; exit 1; }",
    "case \"$CONTENT_TYPE\" in text/x-shellscript*|text/plain*|application/octet-stream*) ;; *) echo \"Unexpected installer content type: $CONTENT_TYPE\" >&2; exit 1;; esac",
    "head -n 1 installer.sh | grep -qx '#!/usr/bin/env bash'",
    "bash -n installer.sh",
    "sed -n '1,240p' installer.sh # inspect before continuing",
    "read -rp 'Execute this installer? [y/N] ' CONFIRM",
    "[ \"$CONFIRM\" = y ] || [ \"$CONFIRM\" = Y ] || exit 1",
    "OPSWORKBENCH_INSTALL_INPUT_DIR=\"$INSTALL_INPUT_DIR\" bash installer.sh"
  ];
  return lines.join("\n");
}
