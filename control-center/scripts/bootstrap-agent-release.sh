#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

RELEASE_VERSION="@RELEASE_VERSION@"
MANIFEST_NAME="@MANIFEST_NAME@"
MANIFEST_SIGNATURE_NAME="${MANIFEST_NAME}.sig"
INSTALL_ROOT="/opt/opsworkbench-agent"
CONFIG_ROOT="/etc/opsworkbench-agent"
STATE_ROOT="/var/lib/opsworkbench-agent"
BACKUP_ROOT="/var/backups/opsworkbench-agent"
UNIT_ROOT="/etc/systemd/system"
AGENT_SERVICE="opsworkbench-agent.service"
UPDATER_SERVICE="opsworkbench-agent-updater.service"
UPDATER_PATH="opsworkbench-agent-updater.path"

fail() { printf 'OpsWorkbench bootstrap: %s\n' "$*" >&2; exit 1; }
read_secret_file() { local file="$1"; [ -f "$file" ] || return 1; [ "$(wc -l <"$file")" -le 1 ] || fail "machine credential input must contain one line"; tr -d '\r\n' <"$file"; }
json() { node -e 'const fs=require("fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const path=process.argv[2].split(".");let current=value;for(const key of path)current=current?.[key];if(current===undefined||current===null)process.exit(2);process.stdout.write(typeof current==="string"?current:JSON.stringify(current));' "$1" "$2"; }
artifact_field() { node -e 'const fs=require("fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const item=value.artifacts.find((entry)=>entry.role===process.argv[2]);if(!item)process.exit(2);const field=item[process.argv[3]];if(field===undefined)process.exit(2);process.stdout.write(String(field));' "$manifest" "$1" "$2"; }
verify_file() { local file="$1" expected_size="$2" expected_sha="$3"; [ -f "$file" ] || fail "required artifact is missing"; [ "$(wc -c <"$file")" = "$expected_size" ] || fail "artifact size verification failed"; printf '%s  %s\n' "$expected_sha" "$file" | sha256sum -c - >/dev/null || fail "artifact digest verification failed"; }
cleanup() { [ -z "${work_dir:-}" ] || rm -rf -- "$work_dir"; unset CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET; }
trap cleanup EXIT

[ "$(id -u)" -eq 0 ] || fail "run from a root shell"
[ "$(uname -s)" = "Linux" ] || fail "Linux is required"
for command in awk base64 cp curl cut date df find grep install mv node openssl readlink seq sha256sum stat systemctl tar tr wc; do command -v "$command" >/dev/null 2>&1 || fail "$command is required"; done
[ -n "${OPSWORKBENCH_RELEASE_BASE_URL:-}" ] || fail "OPSWORKBENCH_RELEASE_BASE_URL is required"
case "$OPSWORKBENCH_RELEASE_BASE_URL" in https://*) ;; *) fail "release base URL must use HTTPS" ;; esac
[ -f "${OPSWORKBENCH_TRUSTED_PUBLIC_KEY:-}" ] || fail "OPSWORKBENCH_TRUSTED_PUBLIC_KEY must name the owner-approved public key"
[ "$(stat -c %a "$OPSWORKBENCH_TRUSTED_PUBLIC_KEY")" -le 644 ] || fail "trusted public key permissions are unsafe"
[ -s "$CONFIG_ROOT/agent.json" ] || fail "existing enrolled agent configuration is required"

install -d -o root -g root -m 0711 "$STATE_ROOT"
install -d -o root -g root -m 0700 "$BACKUP_ROOT"
exec 9>"$STATE_ROOT/bootstrap.lock"
flock -n 9 || fail "another bootstrap or rollback is active"
work_dir="$(mktemp -d "$STATE_ROOT/.bootstrap.XXXXXX")"
chmod 0700 "$work_dir"
manifest="$work_dir/$MANIFEST_NAME"
manifest_signature="$work_dir/$MANIFEST_SIGNATURE_NAME"

curl_config="$work_dir/curl.conf"
{
  printf '%s\n' 'silent' 'show-error' 'fail' 'location' 'max-redirs = 0' 'connect-timeout = 10' 'retry = 3' 'retry-all-errors' 'retry-delay = 2'
  if [ -n "${OPSWORKBENCH_CF_ACCESS_CLIENT_ID_FILE:-}" ] || [ -n "${OPSWORKBENCH_CF_ACCESS_CLIENT_SECRET_FILE:-}" ]; then
    [ -n "${OPSWORKBENCH_CF_ACCESS_CLIENT_ID_FILE:-}" ] && [ -n "${OPSWORKBENCH_CF_ACCESS_CLIENT_SECRET_FILE:-}" ] || fail "both Cloudflare service-token files are required"
    CF_ACCESS_CLIENT_ID="$(read_secret_file "$OPSWORKBENCH_CF_ACCESS_CLIENT_ID_FILE")" || fail "Cloudflare client ID file is invalid"
    CF_ACCESS_CLIENT_SECRET="$(read_secret_file "$OPSWORKBENCH_CF_ACCESS_CLIENT_SECRET_FILE")" || fail "Cloudflare client secret file is invalid"
    printf 'header = "CF-Access-Client-Id: %s"\n' "$CF_ACCESS_CLIENT_ID"
    printf 'header = "CF-Access-Client-Secret: %s"\n' "$CF_ACCESS_CLIENT_SECRET"
  fi
} >"$curl_config"
chmod 0600 "$curl_config"
download() { local filename="$1" destination="$2"; case "$filename" in *[!A-Za-z0-9._-]*|.*|*..*) fail "artifact filename rejected" ;; esac; curl --config "$curl_config" --output "$destination" "${OPSWORKBENCH_RELEASE_BASE_URL%/}/$filename"; }

download "$MANIFEST_NAME" "$manifest"
download "$MANIFEST_SIGNATURE_NAME" "$manifest_signature"
base64 -d "$manifest_signature" >"$work_dir/manifest.signature.bin" 2>/dev/null || fail "manifest signature encoding is invalid"
openssl pkeyutl -verify -pubin -inkey "$OPSWORKBENCH_TRUSTED_PUBLIC_KEY" -rawin -in "$manifest" -sigfile "$work_dir/manifest.signature.bin" >/dev/null 2>&1 || fail "manifest signature verification failed"

[ "$(json "$manifest" schemaVersion)" = "opsworkbench-agent-bootstrap-v1" ] || fail "unsupported manifest schema"
[ "$(json "$manifest" version)" = "$RELEASE_VERSION" ] || fail "manifest version mismatch"
publication_status="$(json "$manifest" publicationStatus)"
if [ "$publication_status" != "published" ]; then [ "$publication_status" = "draft" ] && [ "${OPSWORKBENCH_ALLOW_DRAFT_RELEASE:-}" = "true" ] || fail "release is not published"; fi
[ "$(json "$manifest" revoked)" = "false" ] || fail "release is revoked"
[ "$(json "$manifest" nonProductionOnly)" = "true" ] || fail "bootstrap release is not non-production-only"
key_id="$(json "$manifest" signingKeyId)"
public_fingerprint="$(openssl pkey -pubin -in "$OPSWORKBENCH_TRUSTED_PUBLIC_KEY" -outform DER 2>/dev/null | sha256sum | cut -d' ' -f1)"
[ "$key_id" = "ed25519-${public_fingerprint:0:24}" ] || fail "trusted key identifier mismatch"

installer_size="$(artifact_field bootstrap_installer sizeBytes)"; installer_sha="$(artifact_field bootstrap_installer sha256)"
verify_file "$0" "$installer_size" "$installer_sha"
package_name="$(artifact_field agent_package filename)"; package_size="$(artifact_field agent_package sizeBytes)"; package_sha="$(artifact_field agent_package sha256)"
package_signature_name="$(artifact_field artifact_signature filename)"; package_signature_size="$(artifact_field artifact_signature sizeBytes)"; package_signature_sha="$(artifact_field artifact_signature sha256)"
catalog_name="$(artifact_field release_catalog filename)"; catalog_size="$(artifact_field release_catalog sizeBytes)"; catalog_sha="$(artifact_field release_catalog sha256)"
rollback_name="$(artifact_field rollback_script filename)"; rollback_size="$(artifact_field rollback_script sizeBytes)"; rollback_sha="$(artifact_field rollback_script sha256)"
download "$package_name" "$work_dir/$package_name"; verify_file "$work_dir/$package_name" "$package_size" "$package_sha"
download "$package_signature_name" "$work_dir/$package_signature_name"; verify_file "$work_dir/$package_signature_name" "$package_signature_size" "$package_signature_sha"
base64 -d "$work_dir/$package_signature_name" >"$work_dir/package.signature.bin" 2>/dev/null || fail "artifact signature encoding is invalid"
openssl pkeyutl -verify -pubin -inkey "$OPSWORKBENCH_TRUSTED_PUBLIC_KEY" -rawin -in "$work_dir/$package_name" -sigfile "$work_dir/package.signature.bin" >/dev/null 2>&1 || fail "artifact signature verification failed"
download "$catalog_name" "$work_dir/$catalog_name"; verify_file "$work_dir/$catalog_name" "$catalog_size" "$catalog_sha"
download "$rollback_name" "$work_dir/$rollback_name"; verify_file "$work_dir/$rollback_name" "$rollback_size" "$rollback_sha"

current_version="$(json "$CONFIG_ROOT/agent.json" agentVersion)"
[ "$current_version" = "0.1.0" ] || { [ "$current_version" = "$RELEASE_VERSION" ] && systemctl is-active --quiet "$AGENT_SERVICE" && { printf 'OpsWorkbench agent bootstrap is already complete.\n'; exit 0; }; fail "current agent version is not eligible"; }
node -e 'const fs=require("fs");const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(!c.agentId||!c.agentSecret||!c.installationId)process.exit(1);' "$CONFIG_ROOT/agent.json" || fail "enrolled agent identity is incomplete"
. /etc/os-release
case "${ID:-}" in debian|ubuntu) ;; *) fail "unsupported Linux distribution" ;; esac
[ "$(uname -m)" = "x86_64" ] || fail "unsupported CPU architecture"
[ "$(df -Pk "$INSTALL_ROOT" | awk 'NR==2 {print $4}')" -gt $((package_size / 1024 * 4 + 102400)) ] || fail "insufficient disk space for bootstrap and rollback"

extract_root="$work_dir/extracted"; install -d -m 0700 "$extract_root"
tar -tzf "$work_dir/$package_name" >"$work_dir/archive.list"
[ -s "$work_dir/archive.list" ] || fail "agent package is empty"
grep -Eq '(^/|(^|/)\.\.(/|$))' "$work_dir/archive.list" && fail "agent package contains an unsafe path"
tar -xzf "$work_dir/$package_name" -C "$extract_root" --no-same-owner --no-same-permissions
[ -z "$(find "$extract_root" \( -type l -o -type b -o -type c -o -type p -o -type s \) -print -quit)" ] || fail "agent package contains a link or special file"
[ -f "$extract_root/control-center/apps/agent/dist/agent.js" ] || fail "agent executable is missing"
[ -f "$extract_root/control-center/apps/updater/dist/main.js" ] || fail "updater executable is missing"
[ -f "$extract_root/control-center/deploy/systemd/opsworkbench-agent.service" ] || fail "agent unit is missing"

backup="$BACKUP_ROOT/bootstrap-$(date -u +%Y%m%dT%H%M%SZ)-$RELEASE_VERSION"
install -d -m 0700 "$backup/etc" "$backup/systemd"
cp -a -- "$CONFIG_ROOT/agent.json" "$backup/etc/agent.json"
for unit in "$AGENT_SERVICE" "$UPDATER_SERVICE" "$UPDATER_PATH"; do [ ! -f "$UNIT_ROOT/$unit" ] || cp -a -- "$UNIT_ROOT/$unit" "$backup/systemd/$unit"; done
if [ -L "$INSTALL_ROOT/current" ]; then readlink -f -- "$INSTALL_ROOT/current" >"$backup/prior-current-target"; fi
if [ -d "$INSTALL_ROOT/source" ]; then cp -a -- "$INSTALL_ROOT/source" "$backup/legacy-source"; fi
printf '%s\n' "$backup" >"$BACKUP_ROOT/latest-bootstrap-backup"

target="$INSTALL_ROOT/releases/$RELEASE_VERSION"
if [ -e "$target" ]; then [ -f "$target/control-center/apps/agent/dist/agent.js" ] || fail "partial target release exists"; else install -d -m 0755 "$(dirname "$target")"; mv -- "$extract_root" "$target"; fi
chown -R root:root "$target"
find "$target" -type d -exec chmod 0755 {} +
find "$target" -type f -exec chmod 0644 {} +
chmod 0755 "$target/control-center/scripts/rollback-agent-bootstrap.sh"
install -d -m 0755 "$CONFIG_ROOT/trusted-release-keys"
install -m 0644 "$OPSWORKBENCH_TRUSTED_PUBLIC_KEY" "$CONFIG_ROOT/trusted-release-keys/$key_id.pem"
install -m 0600 "$work_dir/$catalog_name" "$CONFIG_ROOT/release-catalog.json"
node -e 'const fs=require("fs");const path=process.argv[1];const key=process.argv[2];const pem=fs.readFileSync(process.argv[3],"utf8");fs.writeFileSync(path,JSON.stringify({[key]:pem},null,2)+"\n",{mode:0o600});' "$CONFIG_ROOT/updater-trust.json.pending" "$key_id" "$OPSWORKBENCH_TRUSTED_PUBLIC_KEY"
mv -fT -- "$CONFIG_ROOT/updater-trust.json.pending" "$CONFIG_ROOT/updater-trust.json"
node -e 'const fs=require("fs");const file=process.argv[1];const version=process.argv[2];const digest=process.argv[3];const stat=fs.statSync(file);const c=JSON.parse(fs.readFileSync(file,"utf8"));c.agentVersion=version;c.protocolVersion="task-v1";c.packageType="tar";c.releaseChannel="candidate";c.binarySha256=digest;const pending=file+".bootstrap-pending";fs.writeFileSync(pending,JSON.stringify(c,null,2)+"\n",{mode:stat.mode});fs.chmodSync(pending,stat.mode);fs.chownSync(pending,stat.uid,stat.gid);fs.renameSync(pending,file);' "$CONFIG_ROOT/agent.json" "$RELEASE_VERSION" "$package_sha"

for unit in "$AGENT_SERVICE" "$UPDATER_SERVICE" "$UPDATER_PATH"; do install -m 0644 "$target/control-center/deploy/systemd/$unit" "$UNIT_ROOT/$unit"; done
install -m 0700 "$work_dir/$rollback_name" "$INSTALL_ROOT/rollback-agent-bootstrap"
ln -s -- "$target" "$INSTALL_ROOT/current.bootstrap-pending"
mv -Tf -- "$INSTALL_ROOT/current.bootstrap-pending" "$INSTALL_ROOT/current"
systemctl daemon-reload
systemctl enable "$AGENT_SERVICE" "$UPDATER_PATH" >/dev/null
heartbeat="$STATE_ROOT/agent/heartbeat.json"
rm -f -- "$heartbeat" "$heartbeat.pending"
systemctl restart "$AGENT_SERVICE"
systemctl start "$UPDATER_PATH"

validated=false
for _ in $(seq 1 60); do
  if [ -s "$heartbeat" ] && node -e 'const fs=require("fs");const h=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const required=["environmentDiscovery","agentUpgrade","upgradeManifestHandoff"];if(h.agentVersion!==process.argv[2]||h.discoveryComplete!==true||required.some((c)=>!h.capabilities?.includes(c)))process.exit(1);' "$heartbeat" "$RELEASE_VERSION"; then validated=true; break; fi
  sleep 2
done
if [ "$validated" != true ]; then
  OPSWORKBENCH_BOOTSTRAP_LOCK_HELD=1 "$target/control-center/scripts/rollback-agent-bootstrap.sh" >/dev/null 2>&1 || true
  fail "bootstrap validation failed and rollback was requested"
fi
printf 'OpsWorkbench agent bootstrap validated successfully for release %s.\n' "$RELEASE_VERSION"
