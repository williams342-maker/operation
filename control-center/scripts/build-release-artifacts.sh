#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
commit="$(git rev-parse HEAD)"
tag="${RELEASE_TAG:-$(git describe --tags --exact-match HEAD)}"
case "$tag" in
  v[0-9]*.[0-9]*.[0-9]*-*) ;;
  *) echo "Release tag must be an exact semantic-version prerelease tag" >&2; exit 1 ;;
esac

tag_type="$(git cat-file -t "$tag")"
test "$tag_type" = "tag" || { echo "Release tag must be annotated" >&2; exit 1; }
test "$(git rev-list -n 1 "$tag")" = "$commit" || { echo "Release tag does not resolve to HEAD" >&2; exit 1; }

version="${tag#v}"
prefix="opsworkbench-control-center-${version}"
output_dir="${RELEASE_OUTPUT_DIR:-${repository_root}/release-output}"
rm -rf -- "$output_dir"
mkdir -p "$output_dir"

bundle="${output_dir}/${prefix}.tar.gz"
manifest="${output_dir}/${prefix}.manifest.json"
checksums="${output_dir}/SHA256SUMS"
agent_bundle="${output_dir}/${prefix}-agent-linux-x64.tar.gz"

git -C "$repository_root" archive --format=tar --prefix="${prefix}/" "$commit" control-center | gzip -n -9 > "$bundle"
RELEASE_TAG="$tag" node "$repository_root/control-center/scripts/build-release-agent.mjs" "$agent_bundle" >/dev/null
node -e '
  const fs = require("node:fs");
  const [file, tag, commit, agentArtifact] = process.argv.slice(1);
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: "opsworkbench-release-v1",
    tag,
    commit,
    artifact: "opsworkbench-control-center-" + tag.slice(1) + ".tar.gz",
    agentArtifact,
    source: "git archive of the tracked control-center path at the tagged commit",
    reproducible: true
  }, null, 2) + "\n");
' "$manifest" "$tag" "$commit" "$(basename "$agent_bundle")"

(cd "$output_dir" && sha256sum "$(basename "$bundle")" "$(basename "$agent_bundle")" "$(basename "$manifest")" > "$(basename "$checksums")")
printf '%s\\n' "$bundle" "$manifest" "$checksums"
