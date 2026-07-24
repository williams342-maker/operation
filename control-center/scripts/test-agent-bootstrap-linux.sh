#!/usr/bin/env bash
set -euo pipefail

repository="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_output="${BOOTSTRAP_OUTPUT_DIR:-}"
generated_output=""
if [ -z "$release_output" ]; then
  generated_output="$(mktemp -d)"
  release_output="$generated_output/release"
  BOOTSTRAP_OUTPUT_DIR="$release_output" node "$repository/scripts/build-disposable-agent-bootstrap.mjs"
fi
[ -d "$release_output" ] || { echo "BOOTSTRAP_OUTPUT_DIR must name a signed disposable bootstrap output directory" >&2; exit 2; }
release_output="$(cd "$release_output" && pwd)"
container="opsworkbench-bootstrap-test-$$"
image="opsworkbench-bootstrap-test:local"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  [ -z "$generated_output" ] || rm -rf -- "$generated_output"
}
trap cleanup EXIT

docker build -t "$image" "$repository/deploy/agent-bootstrap-linux"
docker run -d --name "$container" --privileged --cgroupns=host \
  --tmpfs /run --tmpfs /run/lock \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -v "$release_output:/release:ro" \
  "$image" >/dev/null

for _ in $(seq 1 30); do
  docker exec "$container" systemctl is-system-running --wait >/dev/null 2>&1 && break
  state="$(docker exec "$container" systemctl is-system-running 2>/dev/null || true)"
  [ "$state" = "degraded" ] && break
  sleep 1
done
docker exec "$container" /usr/local/lib/opsworkbench-bootstrap-fixture/prepare-fixture.sh

installer="$(find "$release_output" -maxdepth 1 -type f -name 'opsworkbench-agent-bootstrap-*.sh' -printf '%f\n')"
public_key="$(find "$release_output" -maxdepth 1 -type f -name 'opsworkbench-agent-ed25519-*.public.pem' -printf '%f\n')"
[ "$(printf '%s\n' "$installer" | grep -c .)" -eq 1 ] || { echo "Expected one bootstrap installer" >&2; exit 3; }
[ "$(printf '%s\n' "$public_key" | grep -c .)" -eq 1 ] || { echo "Expected one disposable public key" >&2; exit 3; }

run_bootstrap() {
  docker exec \
    -e OPSWORKBENCH_RELEASE_BASE_URL=https://127.0.0.1:8443 \
    -e OPSWORKBENCH_TRUSTED_PUBLIC_KEY="/release/$public_key" \
    -e OPSWORKBENCH_ALLOW_DRAFT_RELEASE=true \
    -e OPSWORKBENCH_BOOTSTRAP_VALIDATION_ATTEMPTS=10 \
    "$container" bash "/release/$installer"
}

run_bootstrap
docker exec "$container" node -e 'const c=JSON.parse(require("fs").readFileSync("/etc/opsworkbench-agent/agent.json","utf8"));if(c.agentVersion!=="0.10.0-beta.1")process.exit(1)'
docker exec "$container" sh -c 'test "$(stat -c %a /etc/opsworkbench-agent/agent.json)" = "640"'
docker exec "$container" systemctl is-active --quiet opsworkbench-agent.service
docker exec "$container" systemctl is-active --quiet opsworkbench-agent-updater.path

docker restart "$container" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$container" systemctl is-active --quiet opsworkbench-agent.service 2>/dev/null && break
  sleep 1
done
docker exec "$container" systemctl is-active --quiet opsworkbench-agent.service
docker exec "$container" node -e 'const h=JSON.parse(require("fs").readFileSync("/var/lib/opsworkbench-agent/agent/heartbeat.json","utf8"));if(h.agentVersion!=="0.10.0-beta.1"||h.discoveryComplete!==true||!h.capabilities.includes("upgradeManifestHandoff"))process.exit(1)'

run_bootstrap | grep -F "already complete"
docker exec "$container" /opt/opsworkbench-agent/rollback-agent-bootstrap
docker exec "$container" node -e 'const c=JSON.parse(require("fs").readFileSync("/etc/opsworkbench-agent/agent.json","utf8"));if(c.agentVersion!=="0.1.0")process.exit(1)'
docker exec "$container" systemctl is-active --quiet opsworkbench-agent.service
docker exec "$container" systemctl show opsworkbench-agent.service -p ExecStart --value | grep -F "/opt/opsworkbench-agent/source/"
docker exec "$container" test ! -e /opt/opsworkbench-agent/current

docker exec "$container" mkdir -p /run/opsworkbench-bootstrap-fixture
docker exec "$container" touch /run/opsworkbench-bootstrap-fixture/fail-control-plane
if failure_output="$(run_bootstrap 2>&1)"; then
  echo "Bootstrap unexpectedly passed with a failed control-plane poll" >&2
  exit 4
fi
printf '%s\n' "$failure_output" | grep -F "bootstrap validation failed and rollback was requested"
docker exec "$container" node -e 'const c=JSON.parse(require("fs").readFileSync("/etc/opsworkbench-agent/agent.json","utf8"));if(c.agentVersion!=="0.1.0")process.exit(1)'
docker exec "$container" systemctl is-active --quiet opsworkbench-agent.service
docker exec "$container" systemctl show opsworkbench-agent.service -p ExecStart --value | grep -F "/opt/opsworkbench-agent/source/"
docker exec "$container" test ! -e /opt/opsworkbench-agent/current

echo "Disposable Linux bootstrap install, reboot, idempotency, explicit rollback, and failure rollback validation passed"
