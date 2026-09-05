#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

install_root=/opt/opsworkbench-agent
config_root=/etc/opsworkbench-agent
unit_root=/etc/systemd/system
service=opsworkbench-agent.service
fail() { printf 'reviewed agent deployment refused: %s\n' "$*" >&2; exit 1; }
safe_stage() { case "$(readlink -f -- "$1")" in /opt/opsworkbench/releases/*|/var/lib/opsworkbench-deployer/*) ;; *) fail "staging path is outside the trusted deployment roots" ;; esac; }
[ "$(id -u)" -eq 0 ] || fail "root is required"
[ "$(uname -s)" = Linux ] || fail "Linux is required"
command="${1:-}"; shift || true

if [ "$command" = prepare ]; then
  candidate="${1:-}"; backup="${2:-}"; safe_stage "$candidate"; safe_stage "$(dirname "$backup")"
  [ -f "$candidate/control-center/agent-release.json" ] && [ -f "$candidate/control-center/apps/agent/dist/agent.js" ] || fail "verified agent candidate is incomplete"
  if [ -L "$install_root/current" ]; then prior="$(readlink -f -- "$install_root/current")"; elif [ -d "$install_root/source" ]; then prior="$install_root/source"; else fail "current agent release is unavailable"; fi
  [ -f "$config_root/agent.json" ] || fail "enrolled agent configuration is absent"
  [ ! -e "$backup" ] || fail "agent rollback snapshot already exists"
  mkdir -m 0700 "$backup"
  printf '%s\n' "$prior" > "$backup/current-target"
  [ -f "$prior/control-center/apps/agent/dist/agent.js" ] || fail "predecessor agent executable is absent"
  sha256sum "$prior/control-center/apps/agent/dist/agent.js" | cut -d' ' -f1 > "$backup/prior-agent.sha256"
  cp -a -- "$config_root/agent.json" "$backup/agent.json"
  mkdir -m 0700 "$backup/units"
  for unit in opsworkbench-agent.service opsworkbench-agent-updater.service opsworkbench-agent-updater.path; do [ ! -f "$unit_root/$unit" ] || cp -a -- "$unit_root/$unit" "$backup/units/$unit"; done
  sync -f "$backup/current-target" "$backup/prior-agent.sha256" "$backup/agent.json"
  exit 0
fi

if [ "$command" = activate ]; then
  candidate="${1:-}"; tag="${2:-}"; commit="${3:-}"; backup="${4:-}"; safe_stage "$candidate"; safe_stage "$(dirname "$backup")"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-operate$ ]] || fail "release tag is invalid"
  [[ "$commit" =~ ^[a-f0-9]{40}$ ]] || fail "release commit is invalid"
  [ -s "$backup/current-target" ] && [ -s "$backup/agent.json" ] || fail "agent rollback snapshot is absent"
  node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync(process.argv[1]));if(m.schemaVersion!=="opsworkbench-agent-release-v1"||m.tag!==process.argv[2]||m.commit!==process.argv[3])process.exit(1)' "$candidate/control-center/agent-release.json" "$tag" "$commit" || fail "agent candidate identity mismatch"
  version="${tag#v}"; target="$install_root/releases/$version"; pending="$target.pending"
  [ ! -e "$target" ] && [ ! -e "$pending" ] || fail "agent candidate target already exists"
  mkdir -p "$install_root/releases"; cp -a -- "$candidate" "$pending"; chown -R root:root "$pending"; mv -- "$pending" "$target"
  for unit in opsworkbench-agent.service opsworkbench-agent-updater.service opsworkbench-agent-updater.path; do install -o root -g root -m 0644 "$candidate/control-center/deploy/systemd/$unit" "$unit_root/$unit"; done
  digest="$(sha256sum "$candidate/control-center/apps/agent/dist/agent.js" | cut -d' ' -f1)"
  node -e 'const fs=require("fs");const p=process.argv[1],v=process.argv[2],d=process.argv[3],s=fs.statSync(p),c=JSON.parse(fs.readFileSync(p));c.agentVersion=v;c.binarySha256=d;const n=p+".reviewed-pending";fs.writeFileSync(n,JSON.stringify(c,null,2)+"\n",{mode:s.mode});fs.chownSync(n,s.uid,s.gid);fs.renameSync(n,p)' "$config_root/agent.json" "$version" "$digest"
  ln -s -- "$target" "$install_root/current.reviewed-pending"; mv -Tf -- "$install_root/current.reviewed-pending" "$install_root/current"
  systemctl daemon-reload; rm -f /var/lib/opsworkbench-agent/agent/heartbeat.json; systemctl restart "$service"
  for _ in $(seq 1 45); do systemctl is-active --quiet "$service" && node -e 'const fs=require("fs");const h=JSON.parse(fs.readFileSync(process.argv[1]));if(h.agentVersion!==process.argv[2])process.exit(1)' /var/lib/opsworkbench-agent/agent/heartbeat.json "$version" 2>/dev/null && exit 0; sleep 2; done
  fail "candidate agent did not produce its exact heartbeat"
fi

if [ "$command" = rollback ]; then
  backup="${1:-}"; safe_stage "$(dirname "$backup")"; prior="$(cat "$backup/current-target")"
  case "$prior" in "$install_root"/releases/*|"$install_root"/source) ;; *) fail "rollback target escaped the agent install root" ;; esac
  [ -d "$prior" ] && [ -s "$backup/agent.json" ] || fail "agent rollback target is unavailable"
  printf '%s  %s\n' "$(cat "$backup/prior-agent.sha256")" "$prior/control-center/apps/agent/dist/agent.js" | sha256sum -c - >/dev/null || fail "rollback agent identity changed"
  cp -a -- "$backup/agent.json" "$config_root/agent.json.rollback-pending"; mv -fT -- "$config_root/agent.json.rollback-pending" "$config_root/agent.json"
  for unit in opsworkbench-agent.service opsworkbench-agent-updater.service opsworkbench-agent-updater.path; do [ ! -f "$backup/units/$unit" ] || install -o root -g root -m 0644 "$backup/units/$unit" "$unit_root/$unit"; done
  ln -s -- "$prior" "$install_root/current.reviewed-rollback"; mv -Tf -- "$install_root/current.reviewed-rollback" "$install_root/current"
  systemctl daemon-reload; systemctl restart "$service"; systemctl is-active --quiet "$service" || fail "rollback agent did not return"
  exit 0
fi

fail "usage: install-reviewed-agent.sh <prepare|activate|rollback> ..."
