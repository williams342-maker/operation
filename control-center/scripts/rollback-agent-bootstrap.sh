#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

INSTALL_ROOT="/opt/opsworkbench-agent"
CONFIG_ROOT="/etc/opsworkbench-agent"
STATE_ROOT="/var/lib/opsworkbench-agent"
BACKUP_ROOT="/var/backups/opsworkbench-agent"
UNIT_ROOT="/etc/systemd/system"
MARKER="$BACKUP_ROOT/latest-bootstrap-backup"

fail() { printf 'OpsWorkbench bootstrap rollback: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail "run from a root shell"
command -v flock >/dev/null 2>&1 || fail "flock is required"
install -d -m 0700 "$STATE_ROOT"
lock_file="$STATE_ROOT/bootstrap.lock"
if [ "${OPSWORKBENCH_BOOTSTRAP_LOCK_HELD:-}" = "1" ]; then
  [ -e "/proc/$$/fd/9" ] || fail "inherited bootstrap lock is unavailable"
  [ "$(readlink -f -- "/proc/$$/fd/9")" = "$(readlink -f -- "$lock_file")" ] || fail "inherited bootstrap lock is invalid"
  flock -n 9 || fail "inherited bootstrap lock is not owned"
else
  exec 9>"$lock_file"
  flock -n 9 || fail "another bootstrap or rollback is active"
fi
unset OPSWORKBENCH_BOOTSTRAP_LOCK_HELD
[ -s "$MARKER" ] || fail "no bootstrap backup marker exists"
backup="$(head -n 1 "$MARKER")"
resolved_backup="$(readlink -f -- "$backup")"
resolved_root="$(readlink -f -- "$BACKUP_ROOT")"
case "$resolved_backup" in "$resolved_root"/*) ;; *) fail "backup marker escaped the backup root" ;; esac
[ -d "$resolved_backup" ] || fail "bootstrap backup is unavailable"
[ -s "$resolved_backup/etc/agent.json" ] || fail "agent configuration backup is unavailable"

systemctl stop opsworkbench-agent-updater.path 2>/dev/null || true
systemctl stop opsworkbench-agent.service 2>/dev/null || true
cp -a -- "$resolved_backup/etc/agent.json" "$CONFIG_ROOT/agent.json.rollback-pending"
mv -fT -- "$CONFIG_ROOT/agent.json.rollback-pending" "$CONFIG_ROOT/agent.json"

for unit in opsworkbench-agent.service opsworkbench-agent-updater.service opsworkbench-agent-updater.path; do
  if [ -f "$resolved_backup/systemd/$unit" ]; then
    install -m 0644 "$resolved_backup/systemd/$unit" "$UNIT_ROOT/$unit"
  else
    rm -f -- "$UNIT_ROOT/$unit"
  fi
done

if [ -s "$resolved_backup/prior-current-target" ]; then
  prior_target="$(head -n 1 "$resolved_backup/prior-current-target")"
  case "$prior_target" in "$INSTALL_ROOT"/*) ;; *) fail "prior release target escaped the install root" ;; esac
  [ -d "$prior_target" ] || fail "prior release target is unavailable"
  ln -s -- "$prior_target" "$INSTALL_ROOT/current.rollback-pending"
  mv -Tf -- "$INSTALL_ROOT/current.rollback-pending" "$INSTALL_ROOT/current"
else
  rm -f -- "$INSTALL_ROOT/current"
fi

systemctl daemon-reload
systemctl enable opsworkbench-agent.service >/dev/null
systemctl restart opsworkbench-agent.service
systemctl is-active --quiet opsworkbench-agent.service || fail "prior agent did not return"
printf 'OpsWorkbench agent rollback completed and the prior service is active.\n'
