# Installing Reqora

Reqora has three installation modes. Each contains the compiled shared UI; development tools are not installed.

| Mode | What is installed | How it runs |
| --- | --- | --- |
| `desktop` | Electron desktop client and embedded request engine | Native application window |
| `web` | Web UI, request engine, and bundled Node.js runtime | Your browser and a local background process |
| `both` | Both components | Independent desktop and browser applications |

Node.js, npm, and Docker are **not required on the destination computer**. Both applications execute requests locally. Desktop listens on `127.0.0.1:43129`; web defaults to `http://127.0.0.1:5174`. The web port deliberately differs from the Docker/development port, 5173. Installers do not configure a public server or start anything at login.

The applications store separate workspaces in Electron/browser storage. Use Reqora's export/import to transfer collections. Changing the web port or using `localhost` instead of `127.0.0.1` changes its browser storage origin.

## Windows setup wizard

Choose the `win32` artifact matching your CPU (`x64` or `arm64`):

```text
reqora-VERSION-win32-ARCH-desktop-setup.exe
reqora-VERSION-win32-ARCH-web-setup.exe
reqora-VERSION-win32-ARCH-both-setup.exe
```

Run the setup executable and use **Next** through Welcome, License, installation folder, and installation. The `both` wizard also has a component page with **Desktop only**, **Web UI only**, and **Desktop and Web UI** choices. Finish can launch the installed application. The desktop-only and web-only setup files contain only their respective payloads.

Installation is per user and defaults to `%LOCALAPPDATA%\Programs\Reqora`, without administrator access. Start menu entries include **Reqora Desktop**, **Reqora Web**, **Stop Reqora Web**, and **Uninstall Reqora**, as applicable. Web opens the default browser and continues running until stopped, uninstalled, or the computer shuts down.

From a terminal, web commands are also available:

```powershell
$web = "$env:LOCALAPPDATA\Programs\Reqora\web"
& "$web\runtime\node.exe" "$web\cli.mjs" start
& "$web\runtime\node.exe" "$web\cli.mjs" status
& "$web\runtime\node.exe" "$web\cli.mjs" stop
# Change port before starting:
$env:REQORA_WEB_PORT = '8080'
& "$web\runtime\node.exe" "$web\cli.mjs" open
```

Uninstall through Windows Settings → Apps or the Start menu. Close desktop windows before installing an update, switching components, or uninstalling. Run the desired installer against the same installation folder to replace the installed components.

## Linux and macOS terminal installation

Choose `linux` or `darwin` and the correct CPU (`x64` for Intel/AMD, `arm64` for Apple Silicon or ARM Linux). For example:

```sh
tar -xzf reqora-0.1.0-linux-x64-both.tar.gz
cd reqora-0.1.0-linux-x64-both
./install.sh
```

The `both` bundle prompts for a mode in an interactive terminal. Single-component bundles install that component. Pass a mode explicitly for unattended installations:

```sh
./install.sh --mode desktop
./install.sh --mode web
./install.sh --mode both
```

A single-component archive can install only its component; the `both` archive supports all three choices. Run as your normal user, **without sudo**. Files go to `~/.local/share/reqora`, with executable launchers in `~/.local/bin`. Linux gets an applications-menu entry; macOS gets `~/Applications/Reqora.app` pointing to the installed application. Add `~/.local/bin` to your shell's `PATH` or use the full paths:

```sh
~/.local/bin/reqora                 # Desktop, if installed
~/.local/bin/reqora-web open         # Start web and open your browser
~/.local/bin/reqora-web start        # Start in background without opening a browser
~/.local/bin/reqora-web status
~/.local/bin/reqora-web stop
~/.local/bin/reqora-web run          # Foreground, suitable for a terminal or user service
~/.local/bin/reqora-uninstall
```

If a server is already running, `run` reports its URL and exits. Stop it first to run in the foreground. An already-running server retains its port; stop it before changing ports:

```sh
REQORA_WEB_PORT=8080 ~/.local/bin/reqora-web open
```

Custom paths are supported:

```sh
./install.sh --mode both --prefix "$HOME/Apps/reqora" --bin-dir "$HOME/bin"
```

Keep the same paths when upgrading or switching components. Close the desktop app first. The installer stages the new payload before replacing the old one, stops an installed web process, and updates launchers for the selected mode. It refuses to replace unrelated files. Installation paths may contain spaces and apostrophes; double quotes, dollar signs, backticks, backslashes, and newlines are rejected because they are incompatible with the generated launcher entries.

Uninstall removes managed application files and launchers, preserving browser and Electron workspace data. Export important collections before changing installations. Web startup failures are recorded in `web/web.log` below the installation directory.

### Platform prerequisites

- Linux release builds target glibc-based desktop distributions. The desktop app needs a graphical session, Electron's shared system libraries (GTK, NSS, X11/Wayland, and audio support), and working Chromium sandboxing. Minimal servers can install `web` without desktop libraries. Alpine/musl is not a native installer target; use the existing Docker web deployment there. Restricted user namespaces/AppArmor policies may need host administrator configuration for desktop Electron. The installer never disables the sandbox or changes host security policy.
- macOS builds are separate for Intel and Apple Silicon. Current builds are development artifacts, ad-hoc signed on macOS. Unsigned/unnotarized applications may need approval through System Settings → Privacy & Security. The installer does not remove quarantine attributes or bypass Gatekeeper.
- Windows development installers are unsigned and may trigger SmartScreen. Production releases should use an Authenticode certificate; macOS public releases should use Developer ID signing and notarization.

## Building installers from source

Build on the target OS and CPU with Node.js 24, npm, and internet access:

```sh
npm ci
npm run typecheck
npm test
npm run package:desktop
npm run package:web
npm run package:all
# Or build all three artifacts in one pass:
npm run package
# Verify the generated packages through actual installation/removal:
npm run test:packages
```

On Windows install [NSIS 3](https://nsis.sourceforge.io/) first. The build finds `makensis.exe` in the standard Program Files (x86) directory or on PATH. `MAKENSIS` can override its location. Windows also needs `tar` (included with current Windows), used to unpack the Node.js runtime.

Artifacts and platform-specific `SHA256SUMS-*.txt` files are written to `release/`, which is ignored by Git. Verify downloaded bundles before installation:

```sh
sha256sum -c SHA256SUMS-linux-x64.txt    # Linux
shasum -a 256 -c SHA256SUMS-darwin-arm64.txt # macOS
```

On Windows, compare `Get-FileHash .\reqora-...-setup.exe -Algorithm SHA256` with the corresponding checksum file. A checksum detects corruption; use a trusted channel for both the artifact and its checksum.

The build packages Electron using `@electron/packager`, downloads the matching official Node.js 24 distribution for web installs, verifies its SHA-256 against Node's HTTPS checksum list, and includes runtime/third-party licenses. The Node version matches the Node executable running the build. Generated ICO/ICNS files derive from `assets/logo-full.png`. Electron, Node, and compiled renderer files are inside each applicable artifact; there are no post-install network downloads.

For a Developer ID build, supply `REQORA_MAC_SIGN_IDENTITY` with a certificate identity already installed in the macOS build keychain. The packager signs with that identity; **notarization and Windows Authenticode signing are not automated in this workflow**. Add your own notarization/signing process before public distribution and regenerate checksums after signing. Keep credentials outside the repository.

The **Build installers** GitHub Actions workflow builds on native Linux, Windows, and macOS runners for x64 and arm64. Run it manually and choose a mode, or push a `vVERSION` tag matching `package.json` to build all modes. Download its artifacts from the workflow run. Each job silently/terminal-installs the packages, exercises the bundled web UI and engine, and uninstalls them. It uploads build artifacts only; it does not create or publish a GitHub Release. No repository URL or hosted download endpoint is assumed.

Native CI jobs and real-machine installation checks are required before declaring Windows/macOS installers verified. Local Linux builds do not validate Windows wizard interactions, macOS Gatekeeper, or every desktop distribution.
