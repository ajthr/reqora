#!/bin/sh
# Install an extracted, platform-specific Reqora bundle without root privileges.
set -eu
bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mode=
prefix=${REQORA_INSTALL_DIR:-"$HOME/.local/share/reqora"}
bin_dir=${REQORA_BIN_DIR:-"$HOME/.local/bin"}
usage() {
  echo 'Usage: ./install.sh [--mode desktop|web|both] [--prefix ABSOLUTE_PATH] [--bin-dir ABSOLUTE_PATH]'
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode|--prefix|--bin-dir)
      [ "$#" -ge 2 ] || { usage >&2; exit 1; }
      case "$1" in --mode) mode=$2 ;; --prefix) prefix=$2 ;; --bin-dir) bin_dir=$2 ;; esac
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done
[ "$(id -u)" != 0 ] || { echo 'Run as your normal user, without sudo.' >&2; exit 1; }
case "$(uname -s)" in Linux) platform=linux ;; Darwin) platform=darwin ;; *) echo 'Unsupported OS.' >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) echo 'Unsupported CPU architecture.' >&2; exit 1 ;; esac
[ "$(cat "$bundle/platform")" = "$platform-$arch" ] || { echo 'Download the bundle matching this OS and CPU.' >&2; exit 1; }
available=$(cat "$bundle/mode")
if [ -z "$mode" ]; then
  if [ "$available" = both ] && [ -t 0 ]; then
    printf 'Install 1) Desktop only  2) Web UI only  3) Both [3]: '
    read -r choice
    case "$choice" in 1) mode=desktop ;; 2) mode=web ;; 3|'') mode=both ;; *) echo 'Invalid selection.' >&2; exit 1 ;; esac
  else mode=$available; fi
fi
case "$mode" in desktop|web|both) ;; *) usage >&2; exit 1 ;; esac
[ "$available" = both ] || [ "$available" = "$mode" ] || { echo 'This bundle does not contain the requested component.' >&2; exit 1; }
for path in "$prefix" "$bin_dir"; do
  case "$path" in /*) ;; *) echo 'Installation paths must be absolute.' >&2; exit 1 ;; esac
  case "$path" in *'
'*|*'"'*|*'`'*|*'$'*|*'\'*) echo 'Unsupported character in installation path.' >&2; exit 1 ;; esac
done
# Canonicalize parents to avoid trailing slashes and relative path segments.
mkdir -p "$prefix" "$bin_dir"
prefix=$(CDPATH= cd -- "$prefix" && pwd -P)
bin_dir=$(CDPATH= cd -- "$bin_dir" && pwd -P)
case "$prefix" in /|"$HOME"|"$bin_dir") echo 'Choose a dedicated installation directory.' >&2; exit 1 ;; esac
case "$bin_dir" in "$prefix"/*) echo 'The launcher directory must be outside the installation directory.' >&2; exit 1 ;; esac
if [ -n "$(ls -A "$prefix")" ] && [ "$(cat "$prefix/.reqora-install" 2>/dev/null || true)" != reqora-install-v1 ]; then
  echo 'The installation directory contains unrelated files; choose another --prefix.' >&2; exit 1
fi
for name in reqora reqora-web reqora-uninstall; do
  if [ -e "$bin_dir/$name" ] || [ -L "$bin_dir/$name" ]; then
    [ "$(sed -n '2p' "$bin_dir/$name")" = "# Reqora managed launcher: $prefix" ] || {
      echo "Refusing to replace an unrelated launcher: $bin_dir/$name" >&2; exit 1;
    }
  fi
done
desktop_entry=${XDG_DATA_HOME:-"$HOME/.local/share"}/applications/reqora.desktop
mac_link=$HOME/Applications/Reqora.app
if [ "$platform" = darwin ] && { [ -e "$mac_link" ] || [ -L "$mac_link" ]; }; then
  [ "$(readlink "$mac_link" || true)" = "$prefix/desktop/Reqora.app" ] || { echo "An unrelated $mac_link already exists." >&2; exit 1; }
fi
if [ "$platform" = linux ] && [ -e "$desktop_entry" ]; then
  [ "$(sed -n '2p' "$desktop_entry")" = "# Reqora managed launcher: $prefix" ] || { echo "An unrelated $desktop_entry already exists." >&2; exit 1; }
fi
stage=$(mktemp -d "${prefix}.new.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT HUP INT TERM
cp "$bundle/LICENSE" "$bundle/NOTICE.txt" "$stage/"
cp "$bundle/uninstall.sh" "$stage/"
printf '%s\n' reqora-install-v1 > "$stage/.reqora-install"
printf '%s\n' "$bin_dir" "$platform" "$desktop_entry" > "$stage/install-paths"
if [ "$mode" != web ]; then cp -R "$bundle/desktop" "$stage/desktop"; fi
if [ "$mode" != desktop ]; then cp -R "$bundle/web" "$stage/web"; fi
if [ -x "$prefix/web/runtime/node" ]; then "$prefix/web/runtime/node" "$prefix/web/cli.mjs" stop; fi
# Keep the old installation intact until the new payload is completely staged.
backup=$(mktemp -d "${prefix}.old.XXXXXX")
rmdir "$backup"
mv "$prefix" "$backup"
if ! mv "$stage" "$prefix"; then mv "$backup" "$prefix"; exit 1; fi
rm -rf -- "$backup"
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
launcher() {
  name=$1; shift
  { printf '#!/bin/sh\n# Reqora managed launcher: %s\nexec ' "$prefix"
    for arg in "$@"; do quote "$arg"; printf ' '; done
    printf '"$@"\n'
  } > "$bin_dir/$name"
  chmod 755 "$bin_dir/$name"
}
rm -f "$bin_dir/reqora" "$bin_dir/reqora-web"
if [ -f "$desktop_entry" ] && [ "$platform" = linux ]; then rm "$desktop_entry"; fi
if [ -L "$mac_link" ] && [ "$platform" = darwin ]; then rm "$mac_link"; fi
if [ "$mode" != web ]; then
  if [ "$platform" = linux ]; then
    launcher reqora "$prefix/desktop/reqora"
    mkdir -p "$(dirname "$desktop_entry")"
    cat > "$desktop_entry" <<EOF
[Desktop Entry]
# Reqora managed launcher: $prefix
Type=Application
Name=Reqora
Comment=REST API client
Exec="$prefix/desktop/reqora" %U
Icon=$prefix/desktop/resources/app/assets/logo-full.png
Terminal=false
Categories=Development;Network;
StartupWMClass=Reqora
EOF
  else
    launcher reqora /usr/bin/open -a "$prefix/desktop/Reqora.app" --args
    mkdir -p "$HOME/Applications"
    ln -s "$prefix/desktop/Reqora.app" "$mac_link"
  fi
fi
if [ "$mode" != desktop ]; then launcher reqora-web "$prefix/web/runtime/node" "$prefix/web/cli.mjs"; fi
launcher reqora-uninstall /bin/sh "$prefix/uninstall.sh"
printf 'Installed Reqora (%s) in %s\n' "$mode" "$prefix"
[ "$mode" = web ] || echo "Desktop: $bin_dir/reqora"
[ "$mode" = desktop ] || printf 'Web: %s/reqora-web open\nStop web: %s/reqora-web stop\n' "$bin_dir" "$bin_dir"
printf 'Uninstall: %s/reqora-uninstall\nAdd %s to PATH if needed.\n' "$bin_dir" "$bin_dir"
