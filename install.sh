#!/bin/sh
set -eu

# vscode-agents-server's automatic install script.
# See https://github.com/hempflower/vscode-agents-server

usage() {
  arg0="$0"
  if [ "$0" = sh ]; then
    arg0="curl -fsSL https://raw.githubusercontent.com/hempflower/vscode-agents-server/main/install.sh | sh -s --"
  else
    not_curl_usage="The latest script is available at https://raw.githubusercontent.com/hempflower/vscode-agents-server/main/install.sh
"
  fi

  cath << EOF
Installs vscode-agents-server.
It tries to use the system package manager if possible.
After successful installation it explains how to start using vscode-agents-server.

Pass in user@host to install vscode-agents-server on user@host over ssh.
The remote host must have internet access.
${not_curl_usage-}
Usage:

  $arg0 [--dry-run] [--version X.X.X] [--edge] [--method detect] \
        [--prefix ~/.local] [--rsh ssh] [user@host]

  --dry-run
      Echo the commands for the install process without running them.

  --version X.X.X
      Install a specific version instead of the latest.

  --edge
      Install the latest edge version instead of the latest stable version.

  --method [detect | standalone]
      Choose the installation method. Defaults to detect.
      - detect detects the system package manager and tries to use it.
        Full reference on the process is further below.
      - standalone installs a standalone release archive into ~/.local
        Add ~/.local/bin to your \$PATH to use it.

  --prefix <dir>
      Sets the prefix used by standalone release archives. Defaults to ~/.local
      The release is unarchived into ~/.local/lib/code-server-X.X.X
      and the binary symlinked into ~/.local/bin/vscode-agents-server
      To install system wide pass --prefix=/usr/local

  --rsh <bin>
      Specifies the remote shell for remote installation. Defaults to ssh.

The detection method works as follows:
  - Debian, Ubuntu, Raspbian: install the deb package from GitHub.
  - Fedora, CentOS, RHEL, openSUSE: install the rpm package from GitHub.
  - Arch Linux and macOS: install the standalone release from GitHub.
  - FreeBSD and Alpine: report that no compatible build is available.
  - All others: install the release from GitHub.

We only build releases on GitHub for amd64 and arm64 on Linux and amd64 for
macOS. When the detection method tries to pull a release from GitHub it will
exit with an error when there is no matching release for the system's operating
system and architecture.

The standalone method will force installion using GitHub releases. It will not
fall back to npm so on architectures without pre-built releases this will error.

The installer will cache all downloaded assets into ~/.cache/code-server

More installation docs are at https://github.com/hempflower/vscode-agents-server
EOF
}

echo_latest_version() {
  if [ "${EDGE-}" ]; then
    version="$(curl -fsSL https://api.github.com/repos/hempflower/vscode-agents-server/releases | awk 'match($0,/.*"html_url": "(.*\/releases\/tag\/.*)".*/)' | head -n 1 | awk -F '"' '{print $4}')"
  else
    # https://gist.github.com/lukechilds/a83e1d7127b78fef38c2914c4ececc3c#gistcomment-2758860
    version="$(curl -fsSLI -o /dev/null -w "%{url_effective}" https://github.com/hempflower/vscode-agents-server/releases/latest)"
  fi
  version="${version#https://github.com/hempflower/vscode-agents-server/releases/tag/}"
  version="${version#v}"
  echo "$version"
}

echo_standalone_postinstall() {
  echoh
  cath << EOF
Standalone release has been installed into $STANDALONE_INSTALL_PREFIX/lib/code-server-$VERSION

Extend your path to use vscode-agents-server:
  PATH="$STANDALONE_INSTALL_PREFIX/bin:\$PATH"
Then run with:
  vscode-agents-server
EOF
}

echo_systemd_postinstall() {
  echoh
  cath << EOF
$1 package has been installed.

To have systemd start vscode-agents-server now and restart on boot:
  sudo systemctl enable --now vscode-agents-server@\$USER
Or, if you don't want/need a background service you can run:
  vscode-agents-server
EOF
}

echo_project_postinstall() {
  echoh
  echoh "Project documentation: https://github.com/hempflower/vscode-agents-server"
}

main() {
  if [ "${TRACE-}" ]; then
    set -x
  fi

  unset \
    DRY_RUN \
    METHOD \
    OPTIONAL \
    ALL_FLAGS \
    RSH_ARGS \
    EDGE \
    RSH

  ALL_FLAGS=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -*)
        ALL_FLAGS="${ALL_FLAGS} $1"
        ;;
    esac

    case "$1" in
      --dry-run)
        DRY_RUN=1
        ;;
      --method)
        METHOD="$(parse_arg "$@")"
        shift
        ;;
      --method=*)
        METHOD="$(parse_arg "$@")"
        ;;
      --prefix)
        STANDALONE_INSTALL_PREFIX="$(parse_arg "$@")"
        shift
        ;;
      --prefix=*)
        STANDALONE_INSTALL_PREFIX="$(parse_arg "$@")"
        ;;
      --version)
        VERSION="$(parse_arg "$@")"
        shift
        ;;
      --version=*)
        VERSION="$(parse_arg "$@")"
        ;;
      --edge)
        EDGE=1
        ;;
      --rsh)
        RSH="$(parse_arg "$@")"
        shift
        ;;
      --rsh=*)
        RSH="$(parse_arg "$@")"
        ;;
      -h | --h | -help | --help)
        usage
        exit 0
        ;;
      --)
        shift
        # We remove the -- added above.
        ALL_FLAGS="${ALL_FLAGS% --}"
        RSH_ARGS="$*"
        break
        ;;
      -*)
        echoerr "Unknown flag $1"
        echoerr "Run with --help to see usage."
        exit 1
        ;;
      *)
        RSH_ARGS="$*"
        break
        ;;
    esac

    shift
  done

  if [ "${RSH_ARGS-}" ]; then
    RSH="${RSH-ssh}"
    echoh "Installing remotely with $RSH $RSH_ARGS"
    curl -fsSL https://raw.githubusercontent.com/hempflower/vscode-agents-server/main/install.sh | prefix "$RSH_ARGS" "$RSH" "$RSH_ARGS" sh -s -- "$ALL_FLAGS"
    return
  fi

  METHOD="${METHOD-detect}"
  if [ "$METHOD" != detect ] && [ "$METHOD" != standalone ]; then
    echoerr "Unknown install method \"$METHOD\""
    echoerr "Run with --help to see usage."
    exit 1
  fi

  # These are used by the various install_* functions that make use of GitHub
  # releases in order to download and unpack the right release.
  CACHE_DIR=$(echo_cache_dir)
  STANDALONE_INSTALL_PREFIX=${STANDALONE_INSTALL_PREFIX:-$HOME/.local}
  VERSION=${VERSION:-$(echo_latest_version)}
  # These can be overridden for testing but shouldn't normally be used as it can
  # result in a broken code-server.
  OS=${OS:-$(os)}
  ARCH=${ARCH:-$(arch)}
  DISTRO=${DISTRO:-$(distro)}

  distro_name

  # Standalone installs by pulling pre-built releases from GitHub.
  if [ "$METHOD" = standalone ]; then
    if has_standalone; then
      install_standalone
      echo_project_postinstall
      exit 0
    else
      echoerr "There are no standalone releases for $ARCH"
      echoerr "Please try again without '--method standalone'"
      exit 1
    fi
  fi

  # DISTRO can be overridden for testing but shouldn't normally be used as it
  # can result in a broken code-server.
  case $DISTRO in
    macos | arch) standalone_or_error install_standalone ;;
    debian) standalone_or_error install_deb ;;
    fedora | opensuse) standalone_or_error install_rpm ;;
    alpine | freebsd)
      echoerr "There are no vscode-agents-server builds for $DISTRO."
      exit 1
      ;;
    *)
      echoh "Unsupported package manager."
      echoh "Falling back to standalone installation."
      standalone_or_error install_standalone
      ;;
  esac

  echo_project_postinstall
}

parse_arg() {
  case "$1" in
    *=*)
      # Remove everything after first equal sign.
      opt="${1%%=*}"
      # Remove everything before first equal sign.
      optarg="${1#*=}"
      if [ ! "$optarg" ] && [ ! "${OPTIONAL-}" ]; then
        echoerr "$opt requires an argument"
        echoerr "Run with --help to see usage."
        exit 1
      fi
      echo "$optarg"
      return
      ;;
  esac

  case "${2-}" in
    "" | -*)
      if [ ! "${OPTIONAL-}" ]; then
        echoerr "$1 requires an argument"
        echoerr "Run with --help to see usage."
        exit 1
      fi
      ;;
    *)
      echo "$2"
      return
      ;;
  esac
}

fetch() {
  URL="$1"
  FILE="$2"

  if [ -e "$FILE" ]; then
    echoh "+ Reusing $FILE"
    return
  fi

  sh_c mkdir -p "$CACHE_DIR"
  sh_c curl \
    -#fL \
    -o "$FILE.incomplete" \
    -C - \
    "$URL"
  sh_c mv "$FILE.incomplete" "$FILE"
}

install_deb() {
  echoh "Installing v$VERSION of the $ARCH deb package from GitHub."
  echoh

  fetch "https://github.com/hempflower/vscode-agents-server/releases/download/v$VERSION/code-server_${VERSION}_$ARCH.deb" \
    "$CACHE_DIR/code-server_${VERSION}_$ARCH.deb"
  sudo_sh_c dpkg -i "$CACHE_DIR/code-server_${VERSION}_$ARCH.deb"

  echo_systemd_postinstall deb
}

install_rpm() {
  echoh "Installing v$VERSION of the $ARCH rpm package from GitHub."
  echoh

  fetch "https://github.com/hempflower/vscode-agents-server/releases/download/v$VERSION/code-server-$VERSION-$ARCH.rpm" \
    "$CACHE_DIR/code-server-$VERSION-$ARCH.rpm"
  sudo_sh_c rpm -U "$CACHE_DIR/code-server-$VERSION-$ARCH.rpm"

  echo_systemd_postinstall rpm
}

install_standalone() {
  echoh "Installing v$VERSION of the $ARCH release from GitHub."
  echoh

  fetch "https://github.com/hempflower/vscode-agents-server/releases/download/v$VERSION/code-server-$VERSION-$OS-$ARCH.tar.gz" \
    "$CACHE_DIR/code-server-$VERSION-$OS-$ARCH.tar.gz"

  # -w only works if the directory exists so try creating it first. If this
  # fails we can ignore the error as the -w check will then swap us to sudo.
  sh_c mkdir -p "$STANDALONE_INSTALL_PREFIX" 2> /dev/null || true

  sh_c="sh_c"
  if [ ! -w "$STANDALONE_INSTALL_PREFIX" ]; then
    sh_c="sudo_sh_c"
  fi

  if [ -e "$STANDALONE_INSTALL_PREFIX/lib/code-server-$VERSION" ]; then
    echoh
    echoh "code-server-$VERSION is already installed at $STANDALONE_INSTALL_PREFIX/lib/code-server-$VERSION"
    echoh "Remove it to reinstall."
    exit 0
  fi

  "$sh_c" mkdir -p "$STANDALONE_INSTALL_PREFIX/lib" "$STANDALONE_INSTALL_PREFIX/bin"
  "$sh_c" tar -C "$STANDALONE_INSTALL_PREFIX/lib" -xzf "$CACHE_DIR/code-server-$VERSION-$OS-$ARCH.tar.gz"
  "$sh_c" mv -f "$STANDALONE_INSTALL_PREFIX/lib/code-server-$VERSION-$OS-$ARCH" "$STANDALONE_INSTALL_PREFIX/lib/code-server-$VERSION"
  "$sh_c" ln -fs "$STANDALONE_INSTALL_PREFIX/lib/code-server-$VERSION/bin/vscode-agents-server" "$STANDALONE_INSTALL_PREFIX/bin/vscode-agents-server"

  echo_standalone_postinstall
}

# Run $1 if a release exists, otherwise fail instead of installing the
# unrelated upstream code-server package.
standalone_or_error() {
  if has_standalone; then
    $1
  else
    echoerr "There are no vscode-agents-server releases for $ARCH."
    exit 1
  fi
}

# Determine if we have standalone releases on GitHub for the system's arch.
has_standalone() {
  case $DISTRO in
    alpine | freebsd) return 1 ;;
  esac

  case $ARCH in
    arm64 | amd64) return 0 ;;
    *) return 1 ;;
  esac
}

os() {
  uname="$(uname)"
  case $uname in
    Linux) echo linux ;;
    Darwin) echo macos ;;
    FreeBSD) echo freebsd ;;
    *) echo "$uname" ;;
  esac
}

# Print the detected Linux distro, otherwise print the OS name.
#
# Example outputs:
# - macos -> macos
# - freebsd -> freebsd
# - ubuntu, raspbian, debian ... -> debian
# - amzn, centos, rhel, fedora, ... -> fedora
# - opensuse-{leap,tumbleweed} -> opensuse
# - alpine -> alpine
# - arch, manjaro, endeavouros, ... -> arch
#
# Inspired by https://github.com/docker/docker-install/blob/26ff363bcf3b3f5a00498ac43694bf1c7d9ce16c/install.sh#L111-L120.
distro() {
  if [ "$OS" = "macos" ] || [ "$OS" = "freebsd" ]; then
    echo "$OS"
    return
  fi

  if [ -f /etc/os-release ]; then
    (
      . /etc/os-release
      if [ "${ID_LIKE-}" ]; then
        for id_like in $ID_LIKE; do
          case "$id_like" in debian | fedora | opensuse | arch)
            echo "$id_like"
            return
            ;;
          esac
        done
      fi

      echo "$ID"
    )
    return
  fi
}

# Print a human-readable name for the OS/distro.
distro_name() {
  if [ "$(uname)" = "Darwin" ]; then
    echo "macOS v$(sw_vers -productVersion)"
    return
  fi

  if [ -f /etc/os-release ]; then
    (
      . /etc/os-release
      echo "$PRETTY_NAME"
    )
    return
  fi

  # Prints something like: Linux 4.19.0-9-amd64
  uname -sr
}

arch() {
  uname_m=$(uname -m)
  case $uname_m in
    aarch64) echo arm64 ;;
    x86_64) echo amd64 ;;
    *) echo "$uname_m" ;;
  esac
}

command_exists() {
  if [ ! "$1" ]; then return 1; fi
  command -v "$@" > /dev/null
}

sh_c() {
  echoh "+ $*"
  if [ ! "${DRY_RUN-}" ]; then
    sh -c "$*"
  fi
}

sudo_sh_c() {
  if [ "$(id -u)" = 0 ]; then
    sh_c "$@"
  elif command_exists doas; then
    sh_c "doas $*"
  elif command_exists sudo; then
    sh_c "sudo $*"
  elif command_exists su; then
    sh_c "su root -c '$*'"
  else
    echoh
    echoerr "This script needs to run the following command as root."
    echoerr "  $*"
    echoerr "Please install doas, sudo, or su."
    exit 1
  fi
}

echo_cache_dir() {
  if [ "${XDG_CACHE_HOME-}" ]; then
    echo "$XDG_CACHE_HOME/code-server"
  elif [ "${HOME-}" ]; then
    echo "$HOME/.cache/code-server"
  else
    echo "/tmp/code-server-cache"
  fi
}

echoh() {
  echo "$@" | humanpath
}

cath() {
  humanpath
}

echoerr() {
  echoh "$@" >&2
}

# humanpath replaces all occurrences of " $HOME" with " ~"
# and all occurrences of '"$HOME' with the literal '"$HOME'.
humanpath() {
  sed "s# $HOME# ~#g; s#\"$HOME#\"\$HOME#g"
}

# We need to make sure we exit with a non zero exit if the command fails.
# /bin/sh does not support -o pipefail unfortunately.
prefix() {
  PREFIX="$1"
  shift
  fifo="$(mktemp -d)/fifo"
  mkfifo "$fifo"
  sed -e "s#^#$PREFIX: #" "$fifo" &
  "$@" > "$fifo" 2>&1
}

main "$@"
