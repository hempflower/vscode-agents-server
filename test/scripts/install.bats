#!/usr/bin/env bats

SCRIPT_NAME="install.sh"
SCRIPT="$BATS_TEST_DIRNAME/../../$SCRIPT_NAME"

# Override version so it doesn't have to curl and to avoid caching in case the
# user already has the latest version installed.
export VERSION="9999.99.9"

function should-reject-arch() {
  DISTRO=$1 ARCH=$2 OS=$3 run "$SCRIPT" --dry-run
  [ "$status" -eq 1 ]
  [ "${lines[1]}" = "There are no vscode-agents-server releases for $2." ]
}

function should-reject-distro() {
  DISTRO=$1 ARCH=$2 OS=$3 run "$SCRIPT" --dry-run
  [ "$status" -eq 1 ]
  [ "${lines[1]}" = "There are no vscode-agents-server builds for $1." ]
}

function should-use-standalone() {
  DISTRO=$1 ARCH=$2 OS=$3 run "$SCRIPT" --method standalone --dry-run
  [ "$status" -eq 0 ]
  [ "${lines[1]}" = "Installing v$VERSION of the $2 release from GitHub." ]
  [[ "${lines[-6]}" = "Standalone release has been installed"* ]]
}

function should-detect-standalone() {
  DISTRO=$1 ARCH=$2 OS=$3 run "$SCRIPT" --dry-run
  [ "$status" -eq 0 ]
  [ "${lines[1]}" = "Installing v$VERSION of the $2 release from GitHub." ]
  [[ "${lines[-6]}" = "Standalone release has been installed"* ]]
}

@test "$SCRIPT_NAME: usage with --help" {
  run "$SCRIPT" --help
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "Installs vscode-agents-server." ]
  [[ "${lines[-1]}" = "More installation docs are at"* ]]
}

# Supported glibc-based Linux distributions use standalone tarballs.
@test "$SCRIPT_NAME: debian arm64" {
  should-detect-standalone "debian" "arm64" "linux"
}
@test "$SCRIPT_NAME: debian amd64" {
  should-detect-standalone "debian" "amd64" "linux"
}
@test "$SCRIPT_NAME: debian i386" {
  should-reject-arch "debian" "i386" "linux"
}

@test "$SCRIPT_NAME: fedora arm64" {
  should-detect-standalone "fedora" "arm64" "linux"
}
@test "$SCRIPT_NAME: fedora amd64" {
  should-detect-standalone "fedora" "amd64" "linux"
}
@test "$SCRIPT_NAME: fedora i386" {
  should-reject-arch "fedora" "i386" "linux"
}

# Alpine and FreeBSD do not have compatible release builds.
@test "$SCRIPT_NAME: alpine arm64" {
  should-reject-distro "alpine" "arm64" "linux"
}
@test "$SCRIPT_NAME: alpine amd64" {
  should-reject-distro "alpine" "amd64" "linux"
}
@test "$SCRIPT_NAME: alpine i386" {
  should-reject-distro "alpine" "i386" "linux"
}

@test "$SCRIPT_NAME: freebsd arm64" {
  should-reject-distro "freebsd" "arm64" "freebsd"
}
@test "$SCRIPT_NAME: freebsd amd64" {
  should-reject-distro "freebsd" "amd64" "freebsd"
}
@test "$SCRIPT_NAME: freebsd i386" {
  should-reject-distro "freebsd" "i386" "freebsd"
}

# Arch Linux uses the standalone build.
@test "$SCRIPT_NAME: arch arm64" {
  should-detect-standalone "arch" "arm64" "linux"
}
@test "$SCRIPT_NAME: arch amd64" {
  should-detect-standalone "arch" "amd64" "linux"
}
@test "$SCRIPT_NAME: arch i386" {
  should-reject-arch "arch" "i386" "linux"
}

# macOS is not supported.
@test "$SCRIPT_NAME: macos amd64" {
  should-reject-distro "macos" "amd64" "macos"
}
@test "$SCRIPT_NAME: macos arm64" {
  should-reject-distro "macos" "arm64" "macos"
}
@test "$SCRIPT_NAME: macos i386" {
  should-reject-distro "macos" "i386" "macos"
}
@test "$SCRIPT_NAME: macos arm64 --method standalone" {
  DISTRO=macos ARCH=arm64 OS=macos run "$SCRIPT" --method standalone --dry-run
  [ "$status" -eq 1 ]
  [ "${lines[1]}" = "There are no standalone releases for arm64" ]
}

# Force standalone.
@test "$SCRIPT_NAME: debian amd64 --method standalone" {
  should-use-standalone "debian" "amd64" "linux"
}
