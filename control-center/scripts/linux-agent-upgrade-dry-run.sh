#!/usr/bin/env bash
set -euo pipefail
test "$(uname -s)" = Linux
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
config="$tmp_dir/agent.json"
printf '%s\n' '{"controlCenterUrl":"https://example.invalid","installationId":"dry-run-installation","requestedSlug":"dry-run-server","agentId":"dry-run-agent","agentSecret":"non-production-placeholder","agentVersion":"0.1.0","allowedRoots":["/srv/dry-run"],"pollIntervalSeconds":30,"mongoChecks":{}}' >"$config"
chmod 600 "$config"
before="$(node -e 'const fs=require("fs");const c=JSON.parse(fs.readFileSync(process.argv[1]));process.stdout.write(JSON.stringify({installationId:c.installationId,agentId:c.agentId,agentSecret:c.agentSecret,controlCenterUrl:c.controlCenterUrl,allowedRoots:c.allowedRoots}))' "$config")"
CONTROL_CENTER_AGENT_CONFIG="$config" node --import tsx -e 'const {loadConfig,saveConfig}=await import("./apps/agent/src/config.ts");const c=loadConfig();saveConfig({...c,agentVersion:"hardened-dry-run"});'
after="$(node -e 'const fs=require("fs");const c=JSON.parse(fs.readFileSync(process.argv[1]));process.stdout.write(JSON.stringify({installationId:c.installationId,agentId:c.agentId,agentSecret:c.agentSecret,controlCenterUrl:c.controlCenterUrl,allowedRoots:c.allowedRoots}))' "$config")"
test "$before" = "$after"
test "$(stat -c %a "$config")" = 600
backup="$tmp_dir/agent.previous.json"
cp -p "$config" "$backup"
cp -p "$backup" "$config"
test "$(stat -c %a "$config")" = 600
echo "Linux agent configuration upgrade and rollback dry run passed"
