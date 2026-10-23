#!/bin/sh
set -eu
prefix=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
[ "$(cat "$prefix/.reqora-install" 2>/dev/null)" = reqora-install-v1 ] || { echo 'Not a managed Reqora installation.' >&2; exit 1; }
bin_dir=$(sed -n '1p' "$prefix/install-paths")
platform=$(sed -n '2p' "$prefix/install-paths")
desktop_entry=$(sed -n '3p' "$prefix/install-paths")
if [ -x "$prefix/web/runtime/node" ]; then "$prefix/web/runtime/node" "$prefix/web/cli.mjs" stop; fi
for name in reqora reqora-web reqora-run reqora-uninstall; do
  if [ -f "$bin_dir/$name" ] && [ "$(sed -n '2p' "$bin_dir/$name")" = "# Reqora managed launcher: $prefix" ]; then rm "$bin_dir/$name"; fi
done
if [ "$platform" = linux ] && [ -f "$desktop_entry" ] && [ "$(sed -n '2p' "$desktop_entry")" = "# Reqora managed launcher: $prefix" ]; then rm "$desktop_entry"; fi
mac_link=$HOME/Applications/Reqora.app
if [ "$platform" = darwin ] && [ "$(readlink "$mac_link" 2>/dev/null || true)" = "$prefix/desktop/Reqora.app" ]; then rm "$mac_link"; fi
rm -rf -- "$prefix"
echo 'Reqora uninstalled. Browser and Electron workspace data were preserved.'
