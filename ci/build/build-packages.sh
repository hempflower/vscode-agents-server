#!/usr/bin/env bash
set -euo pipefail

# Given a Linux release found in $RELEASE_PATH, generate a tarball named after
# $ARCH (derived from uname -m but can be overridden for cross-compilation) and
# place it in ./release-packages.

main() {
  cd "$(dirname "${0}")/../.."
  source ./ci/lib.sh

  VERSION=$(jq -r .version "$RELEASE_PATH/package.json")

  if [[ $OS != "linux" ]]; then
    echo "Packaging is only supported for Linux" >&2
    exit 1
  fi

  mkdir -p release-packages

  release_archive
}

release_archive() {
  local release_name="vscode-agents-server-$VERSION-linux-$ARCH"
  tar -czf "release-packages/$release_name.tar.gz" --owner=0 --group=0 --transform "s/^$RELEASE_PATH/$release_name/" "$RELEASE_PATH"

  echo "done (release-packages/$release_name)"
}

main "$@"
