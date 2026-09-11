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
  version="${tag#v}"; target="$install_root/releases/$version"; pending_tree="$target.pending"
  [ ! -e "$target" ] && [ ! -e "$pending_tree" ] || fail "agent candidate target already exists"
  # THE SERVICE DROPS PRIVILEGES, SO THE TREE IT RUNS FROM HAS TO BE READABLE BY THAT ACCOUNT.
  #
  # `cp -a` preserved the staging directory's 0700 root-only mode, and the unit runs as an unprivileged
  # user with its working directory inside the tree. systemd could not chdir into it, exited
  # 200/CHDIR nine times in ninety seconds, and the candidate agent could never heartbeat -- a
  # deployment that rolled itself back for a permission bit.
  #
  # The account is read from the unit the candidate itself ships, so this cannot drift from whoever the
  # service actually runs as, and an unknown account refuses rather than guessing root. Root owns the
  # tree and only root can write it; the agent's group may read and traverse; nobody else sees it.
  agent_unit="$candidate/control-center/deploy/systemd/opsworkbench-agent.service"
  [ -f "$agent_unit" ] || fail "candidate agent unit is absent"
  agent_user="$(sed -n 's/^[[:space:]]*User=[[:space:]]*//p' "$agent_unit" | head -n 1)"
  [ -n "$agent_user" ] || fail "candidate agent unit does not declare the user it runs as"
  id -u "$agent_user" >/dev/null 2>&1 || fail "candidate agent unit names an account this host does not have: $agent_user"
  # The unit's own Group= when it has one, because that is the group systemd will actually run under;
  # the account's primary group otherwise.
  agent_group="$(sed -n 's/^[[:space:]]*Group=[[:space:]]*//p' "$agent_unit" | head -n 1)"
  [ -n "$agent_group" ] || agent_group="$(id -gn "$agent_user")"
  getent group "$agent_group" >/dev/null || fail "candidate agent unit names a group this host does not have: $agent_group"
  # TRAVERSAL ONLY, AND PUT BACK IF THIS ACTIVATION REFUSES.
  #
  # `releases/` is shared with every release that came before, including whichever one a rollback
  # returns to, so re-owning it or narrowing it can strip access from a predecessor running under a
  # different account, with nothing in the rollback path to restore it. Read is never granted: older
  # trees here were created 0755/0644 by the bootstrap installer, so `+r` on the parent would expose
  # their names and reach to every local account, permanently.
  releases_dir="$install_root/releases"
  mkdir -p "$releases_dir"
  releases_mode_before="$(stat -c %a "$releases_dir")"
  activation_complete=0; installed_target=0; current_flipped=0
  # ONE trap, not a restore call on the two branches somebody remembered. `set -e` exits, a failed
  # `cp`, a refusal added later -- every one of them leaves through here, and a widening left behind by
  # a failed activation is exactly the residue nobody goes looking for.
  #
  # The installed tree is removed only while `current` still points somewhere else. Once the symlink has
  # been flipped, the `rollback` verb owns the pointer, and pulling the tree out from under it would be
  # this script tidying up into a live failure.
  # Written as plain `if`s: an `&&` chain whose test fails returns non-zero, and under `set -e` that
  # aborts the very cleanup being run.
  cleanup_activation() {
    if [ "$activation_complete" -eq 1 ]; then return 0; fi
    if [ -n "${pending_tree:-}" ]; then rm -rf -- "$pending_tree" 2>/dev/null || true; fi
    if [ "$installed_target" -eq 1 ] && [ "$current_flipped" -eq 0 ]; then rm -rf -- "$target" 2>/dev/null || true; fi
    if [ -n "${releases_mode_before:-}" ]; then chmod "$releases_mode_before" "$releases_dir" 2>/dev/null || true; fi
    return 0
  }
  trap cleanup_activation EXIT
  # Group AND other. Unix permissions do not fall back: an account that MATCHES the owning group is
  # judged by the group bits alone, so `o+x` on a directory owned by the agent's own group would have
  # granted it nothing. Never `+r` -- traversal is what is needed, listing is not.
  chmod go+x "$releases_dir"
  cp -a -- "$candidate" "$pending_tree"; chown -R root:"$agent_group" "$pending_tree"; chmod -R u=rwX,g=rX,o= "$pending_tree"
  # Asked of the account that will run it, before `current` moves or the service is touched, because a
  # failure here is otherwise a ninety-second heartbeat timeout and a full rollback.
  agent_work="$(sed -n 's/^[[:space:]]*WorkingDirectory=[[:space:]]*//p' "$agent_unit" | head -n 1)"
  [ -n "$agent_work" ] || fail "candidate agent unit does not declare a working directory"
  # The probe is only worth running if it tests the tree being installed. A unit whose working
  # directory is not under the `current` symlink would make the substitution below a no-op, and the
  # probe would then happily check some unrelated path -- a check that passes while the thing it guards
  # is broken, which is exactly the failure that produced this fix.
  case "$agent_work" in "$install_root"/current/*) ;; *) fail "candidate agent unit does not run from $install_root/current" ;; esac
  probe_work="$pending_tree/${agent_work#"$install_root"/current/}"
  probe_main="$pending_tree/control-center/apps/agent/dist/agent.js"
  # THE EXACT CREDENTIALS SYSTEMD WILL USE, reconstructed rather than approximated.
  #
  # `runuser -g` sets the primary group AND DROPS the account's supplementary groups, even when the
  # group given is already the primary one. systemd does neither: it applies `Group=` as the primary and
  # still initialises the account's supplementary groups. A host where traversal depends on a
  # supplementary membership -- an install root owned by an operations group, say -- would have failed a
  # probe that systemd itself would have passed, refusing a deployment that was fine.
  probe_credentials=(-u "$agent_user" -g "$agent_group")
  # NUMERIC gids. `id -Gn` output cannot be split safely -- a group named "domain users" becomes two
  # credentials, and an unquoted expansion would glob besides. Numbers have neither problem, and
  # runuser accepts them.
  for supplementary in $(id -G "$agent_user"); do probe_credentials+=(-G "$supplementary"); done
  # Asked of that account, before `current` moves or the service is touched: a failure here is otherwise
  # a ninety-second heartbeat timeout and a full rollback.
  if ! runuser "${probe_credentials[@]}" -- test -x "$probe_work" || ! runuser "${probe_credentials[@]}" -- test -r "$probe_main"; then
    fail "the agent account cannot read the candidate tree it would run from"
  fi
  mv -- "$pending_tree" "$target"; installed_target=1
  for unit in opsworkbench-agent.service opsworkbench-agent-updater.service opsworkbench-agent-updater.path; do install -o root -g root -m 0644 "$candidate/control-center/deploy/systemd/$unit" "$unit_root/$unit"; done
  digest="$(sha256sum "$candidate/control-center/apps/agent/dist/agent.js" | cut -d' ' -f1)"
  node -e 'const fs=require("fs");const p=process.argv[1],v=process.argv[2],d=process.argv[3],s=fs.statSync(p),c=JSON.parse(fs.readFileSync(p));c.agentVersion=v;c.binarySha256=d;const n=p+".reviewed-pending";fs.writeFileSync(n,JSON.stringify(c,null,2)+"\n",{mode:s.mode});fs.chownSync(n,s.uid,s.gid);fs.renameSync(n,p)' "$config_root/agent.json" "$version" "$digest"
  pending_link="$install_root/current.reviewed-pending-$$"; trap 'rm -f -- "$pending_link"; cleanup_activation' EXIT
  ln -s -- "$target" "$pending_link"; mv -Tf -- "$pending_link" "$install_root/current"; current_flipped=1; trap cleanup_activation EXIT
  systemctl daemon-reload; rm -f /var/lib/opsworkbench-agent/agent/heartbeat.json; systemctl restart "$service"
  for _ in $(seq 1 45); do systemctl is-active --quiet "$service" && node -e 'const fs=require("fs");const h=JSON.parse(fs.readFileSync(process.argv[1]));if(h.agentVersion!==process.argv[2])process.exit(1)' /var/lib/opsworkbench-agent/agent/heartbeat.json "$version" 2>/dev/null && { activation_complete=1; exit 0; }; sleep 2; done
  fail "candidate agent did not produce its exact heartbeat"
fi

if [ "$command" = rollback ]; then
  backup="${1:-}"; safe_stage "$(dirname "$backup")"; prior="$(cat "$backup/current-target")"
  case "$prior" in "$install_root"/releases/*|"$install_root"/source) ;; *) fail "rollback target escaped the agent install root" ;; esac
  [ -d "$prior" ] && [ -s "$backup/agent.json" ] || fail "agent rollback target is unavailable"
  printf '%s  %s\n' "$(cat "$backup/prior-agent.sha256")" "$prior/control-center/apps/agent/dist/agent.js" | sha256sum -c - >/dev/null || fail "rollback agent identity changed"
  cp -a -- "$backup/agent.json" "$config_root/agent.json.rollback-pending"; mv -fT -- "$config_root/agent.json.rollback-pending" "$config_root/agent.json"
  for unit in opsworkbench-agent.service opsworkbench-agent-updater.service opsworkbench-agent-updater.path; do [ ! -f "$backup/units/$unit" ] || install -o root -g root -m 0644 "$backup/units/$unit" "$unit_root/$unit"; done
  pending="$install_root/current.reviewed-rollback-$$"; trap 'rm -f -- "$pending"' EXIT
  ln -s -- "$prior" "$pending"; mv -Tf -- "$pending" "$install_root/current"; trap - EXIT
  systemctl daemon-reload; systemctl restart "$service"; systemctl is-active --quiet "$service" || fail "rollback agent did not return"
  exit 0
fi

fail "usage: install-reviewed-agent.sh <prepare|activate|rollback> ..."
