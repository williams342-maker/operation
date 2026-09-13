#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

install_root=/opt/opsworkbench-agent
config_root=/etc/opsworkbench-agent
unit_root=/etc/systemd/system
service=opsworkbench-agent.service
fail() { printf 'reviewed agent deployment refused: %s\n' "$*" >&2; exit 1; }
safe_stage() { case "$(readlink -f -- "$1")" in /opt/opsworkbench/releases/*|/var/lib/opsworkbench-deployer/*) ;; *) fail "staging path is outside the trusted deployment roots" ;; esac; }
[ "$(uname -s)" = Linux ] || fail "Linux is required"
command="${1:-}"; shift || true

# The credential set the activation probe would ask systemd's questions with, printed and nothing else.
#
# It exists because this script had no executable test at all: a reviewer showed that reverting the
# resolved group NAME back to a raw gid -- the defect that would have refused every activation -- passed
# every check in the repository. This verb runs the real construction and prints it, so a test can read
# what would actually be passed to runuser.
#
# Deliberately BEFORE the root check and deliberately read-only: it reads /etc/group through getent,
# mutates nothing, starts nothing, and touches no release. Everything that changes this host is below.
probe_credentials_for() {
  local user="$1" group="$2" supplementary name gids
  local built=(-u "$user" -g "$group")
  # CAPTURED FIRST, not enumerated in the loop header. A failing `id -G` there is not an error the
  # function can see: the expansion is empty, the loop runs zero times, and out comes a short credential
  # list that looks perfectly well formed with the account's supplementary groups silently dropped —
  # the difference between a probe that asks systemd's question and one that asks an easier one.
  gids="$(id -G "$user")" || fail "cannot enumerate the groups of $user"
  [ -n "$gids" ] || fail "$user reports no groups at all"
  for supplementary in $gids; do
    name="$(getent group "$supplementary" | cut -d: -f1)"
    [ -n "$name" ] || fail "the agent account is in group $supplementary, which this host cannot name"
    built+=(-G "$name")
  done
  printf '%s\n' "${built[@]}"
}

# THE IDENTITY HALF OF A ROLLBACK, as a function and a verb so a test can run the real thing.
#
# Security review made verifying it a condition: a rollback must not trust a snapshot that may predate the
# Forge provisioning. The LIVE configuration is passed in as a file, captured before the snapshot lands on
# top of it, because a review pointed out that round-tripping the two identifiers through argv as a
# space-delimited string both truncates a value containing whitespace and cannot distinguish "the live
# identity is empty" from "the live identity could not be read". A file can be absent, and absence is a
# refusal rather than a shrug.
#
# LIVE WINS ABSOLUTELY, including when it is empty. The live configuration is what the running host
# actually is; the snapshot is older by construction. A first version made an empty live value lose to the
# snapshot, so a deliberate `--rollback` of the organisation was undone by the next release rollback and
# the message said nothing had been carried forward. That was wrong twice.
reconcile_identity() {
  node -e '
    const crypto = require("crypto"), fs = require("fs");
    const [file, livePath] = [process.argv[1], process.argv[2]];
    // REFUSALS THROW; THEY DO NOT EXIT. `process.exit` inside a `try` skips its `finally`, so the first
    // version of this leaked the replacement it had just written — holding the credential, under a random
    // name nothing will ever list — every time the ownership restore failed. The test written for that
    // cleanup is what caught it. One handler at the bottom turns a refusal into a sentence and an exit.
    const refuse = (message) => { throw new Error(message); };
    const readConfiguration = (path, what) => {
      // A REGULAR FILE, NOT A LINK, BEFORE ANYTHING IS OPENED. Both of them, and this is not belt and
      // braces: the installer creates the configuration directory 0750 owned by the AGENT account, so
      // that account can plant siblings there, and a review used exactly that to have root write the
      // credential wherever it liked. Every rule here is enforced inline rather than inherited from the
      // directory, because the directory guarantees nothing. The full protection check in the
      // provisioning tool is deliberately NOT imported: this script changes which release is current,
      // and reaching into the release tree for a module at that moment makes the check depend on the
      // thing being swapped underneath it.
      const info = fs.lstatSync(path);
      if (!info.isFile()) refuse(what + " at " + path + " is not a regular file");
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(path, "utf8"));
      } catch (error) {
        // Labelled like every other refusal in this helper. Two files come through here, and at rollback
        // time which of them is unparseable is exactly what decides what the operator does next; an
        // unwrapped parse error named neither. The throw-based refusals surfaced this, because labelled
        // and incidental failures now leave by the same door and print in the same shape.
        refuse(what + " at " + path + " could not be read as JSON (" + (error && error.message ? error.message : error) + ")");
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || typeof parsed.controlCenterUrl !== "string") refuse(what + " at " + path + " is not an agent configuration");
      return { info, parsed };
    };
    try {
      const target = readConfiguration(file, "the restored configuration");
      const live = readConfiguration(livePath, "the captured live configuration");
      const next = { ...target.parsed, orgId: live.parsed.orgId || "", serverId: live.parsed.serverId || "" };
      const changed = ["orgId", "serverId"].filter((field) => (target.parsed[field] || "") !== next[field]);
      if (!changed.length) { console.log("reviewed agent rollback: the restored identity already matches what was live"); process.exit(0); }
      // Named from random bytes and created exclusively, and every property is set on the DESCRIPTOR
      // rather than on the name. A review planted a symlink at the fixed name this used to use and had
      // root write the configuration, credential included, to a path of its choosing.
      const pending = file + ".identity-" + crypto.randomBytes(8).toString("hex");
      let handle;
      try { handle = fs.openSync(pending, "wx", target.info.mode & 0o777); }
      catch (error) { refuse("cannot create the replacement at " + pending + " (" + (error.code || "unknown") + ")"); }
      let installed = false;
      try {
        fs.writeFileSync(handle, JSON.stringify(next, null, 2) + String.fromCharCode(10));
        fs.fsyncSync(handle);
        fs.fchmodSync(handle, target.info.mode & 0o777);
        try {
          fs.fchownSync(handle, target.info.uid, target.info.gid);
        } catch (error) {
          // WHICH CASE THIS IS FOR, because a review pointed out it reads as coverage without being
          // covered: `fchown` throws only when the owner differs from yours, and then `current` cannot
          // match `target` and it refuses anyway. The branch fires in a container or user namespace
          // WITHOUT CAP_CHOWN, where root chowning a file to the owner it already has fails harmlessly.
          // That is a real deployment shape, so the tolerance stays; anything else is an outage in
          // waiting and says so rather than throwing an errno at somebody.
          const current = fs.fstatSync(handle);
          if (current.uid !== target.info.uid || current.gid !== target.info.gid) refuse("cannot restore ownership " + target.info.uid + ":" + target.info.gid + " (" + (error.code || "unknown") + "); run as the account that owns the configuration, or the agent will be left unable to read it");
        }
        fs.closeSync(handle); handle = undefined;
        fs.renameSync(pending, file);
        installed = true;
      } finally {
        if (handle !== undefined) { try { fs.closeSync(handle); } catch { /* the failure above is the one worth reporting */ } }
        if (!installed) { try { fs.rmSync(pending, { force: true }); } catch { /* best effort */ } }
      }
      const after = readConfiguration(file, "the reconciled configuration").parsed;
      for (const field of ["orgId", "serverId"]) if ((after[field] || "") !== next[field]) refuse("could not set " + field);
      console.log("reviewed agent rollback: the snapshot disagreed about " + changed.join(" and ") + "; the live value stands");
      // AND ONE OF THE TWO IS NOT ROUTINE. An orgId disagreement is the ordinary case: the snapshot
      // predates the provisioning, which is the whole reason this reconciliation exists. A serverId
      // disagreement is not. The snapshot is taken after enrolment, and enrolment refuses to change an
      // established server id, so the two can differ only if this host re-enrolled from scratch or the
      // snapshot belongs to a different host. Both are worth stopping to look at.
      if (changed.includes("serverId")) console.log("reviewed agent rollback: NOTE - the server id disagreed, which is not the routine case. Either this host re-enrolled from scratch, or this snapshot is from another host. Confirm before relying on it.");
    } catch (error) {
      console.error("reviewed agent rollback: " + (error && error.message ? error.message : error));
      process.exit(1);
    }
  ' "$1" "$2"
}

if [ "$command" = probe-credentials ]; then
  probe_user="${1:-}"; probe_group="${2:-}"
  [ -n "$probe_user" ] && [ -n "$probe_group" ] || fail "usage: probe-credentials <user> <group>"
  id -u "$probe_user" >/dev/null 2>&1 || fail "no such account: $probe_user"
  getent group "$probe_group" >/dev/null || fail "no such group: $probe_group"
  probe_credentials_for "$probe_user" "$probe_group"
  exit 0
fi

if [ "$command" = reconcile-identity ]; then
  target_config="${1:-}"; live_config="${2:-}"
  [ -n "$target_config" ] && [ -n "$live_config" ] || fail "usage: reconcile-identity <restored config> <captured live config>"
  [ -f "$target_config" ] || fail "no configuration at $target_config"
  [ -f "$live_config" ] || fail "no captured live configuration at $live_config"
  reconcile_identity "$target_config" "$live_config"
  exit 0
fi

[ "$(id -u)" -eq 0 ] || fail "root is required"

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
  # Built by the same function the `probe-credentials` verb prints, so what a test reads is what runs.
  mapfile -t probe_credentials < <(probe_credentials_for "$agent_user" "$agent_group")
  [ "${#probe_credentials[@]}" -ge 4 ] || fail "the agent account has no usable credential set"
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
  # THE LIVE IDENTITY, READ BEFORE THE SNAPSHOT LANDS ON TOP OF IT. Security review made this a condition
  # of the Forge go-ahead: a rollback must VERIFY the restored identity rather than trust a snapshot that
  # may predate the provisioning. The snapshot is taken at activation; the Forge organisation is written
  # separately, afterwards, by scripts/provision-agent-organisation.mjs. A release rollback is about the
  # RELEASE, so an identifier that is live must survive it.
  # THE LIVE CONFIGURATION, CAPTURED AS A FILE BEFORE THE SNAPSHOT LANDS ON TOP OF IT. Not read into two
  # shell variables: a review pointed out that a corrupt or unreadable agent.json produced exactly the
  # same empty pair as a host with no identity, so "I could not tell" became "there is nothing to carry"
  # and the rollback then announced that it had verified the identity. A copy either exists or does not.
  live_config="$(mktemp "$config_root/.agent-live-XXXXXX")" || fail "cannot capture the live configuration; the rollback has not started"
  trap 'rm -f -- "$live_config"' EXIT
  # Plain `cp`, deliberately: `-a` implies --preserve=all, so the capture inherited agent.json's OWNERSHIP
  # and root handed the agent account a second readable copy of the enrolment credential — and, on a v2
  # runtime, the private keys — for the duration of the rollback, in a directory that account can write.
  # Copying into the file mktemp already created keeps it 0600 root-owned, which is all this needs.
  cp -- "$config_root/agent.json" "$live_config" || fail "cannot capture the live configuration; the rollback has not started"

  cp -a -- "$backup/agent.json" "$config_root/agent.json.rollback-pending"; mv -fT -- "$config_root/agent.json.rollback-pending" "$config_root/agent.json"

  # AND RECONCILED AGAINST IT, atomically and with the file's own owner and mode. The live identity wins,
  # including when it is empty, because the live configuration is what the running host actually is and
  # the snapshot is older by construction. This runs BEFORE the service is restarted, so a host that
  # cannot be made whole fails here rather than looking activated and refusing to start.
  reconcile_identity "$config_root/agent.json" "$live_config" || fail "rollback could not reconcile the agent identity; the service has NOT been restarted"
  rm -f -- "$live_config"; trap - EXIT
  for unit in opsworkbench-agent.service opsworkbench-agent-updater.service opsworkbench-agent-updater.path; do [ ! -f "$backup/units/$unit" ] || install -o root -g root -m 0644 "$backup/units/$unit" "$unit_root/$unit"; done
  pending="$install_root/current.reviewed-rollback-$$"; trap 'rm -f -- "$pending"' EXIT
  ln -s -- "$prior" "$pending"; mv -Tf -- "$pending" "$install_root/current"; trap - EXIT

  echo "reviewed agent rollback: agent.json was restored from the activation snapshot, and its Forge"
  echo "  identity reconciled against the configuration that was live. Confirm it before relying on this host."
  systemctl daemon-reload; systemctl restart "$service"; systemctl is-active --quiet "$service" || fail "rollback agent did not return"
  exit 0
fi

fail "usage: install-reviewed-agent.sh <prepare|activate|rollback> ..."
