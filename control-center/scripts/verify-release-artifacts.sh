#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
tag="${RELEASE_TAG:-$(git describe --tags --exact-match HEAD)}"
first="$(mktemp -d)"
second="$(mktemp -d)"
trap 'rm -rf -- "$first" "$second"' EXIT

RELEASE_TAG="$tag" RELEASE_OUTPUT_DIR="$first" bash "$repository_root/control-center/scripts/build-release-artifacts.sh" >/dev/null
RELEASE_TAG="$tag" RELEASE_OUTPUT_DIR="$second" bash "$repository_root/control-center/scripts/build-release-artifacts.sh" >/dev/null

diff -u "$first/SHA256SUMS" "$second/SHA256SUMS"
cmp "$first/opsworkbench-control-center-${tag#v}.tar.gz" "$second/opsworkbench-control-center-${tag#v}.tar.gz"
cmp "$first/opsworkbench-control-center-${tag#v}.manifest.json" "$second/opsworkbench-control-center-${tag#v}.manifest.json"
cmp "$first/opsworkbench-control-center-${tag#v}-agent-linux-x64.tar.gz" "$second/opsworkbench-control-center-${tag#v}-agent-linux-x64.tar.gz"
(cd "$first" && sha256sum --check SHA256SUMS)
echo "Deterministic release artifact verification passed for $tag"
