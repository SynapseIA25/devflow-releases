#!/bin/sh
# DevFlow terminal installer (macOS and Linux).
#   curl -fsSL https://raw.githubusercontent.com/SynapseIA25/devflow-releases/main/install.sh | sh
#
# Downloads the latest public release, installs it and — on macOS — avoids the Gatekeeper
# block (files downloaded via curl are not quarantined; we clear it anyway just in case).
# Windows: download the .exe installer from the releases page.
set -eu

REPO="SynapseIA25/devflow-releases"
API="https://api.github.com/repos/${REPO}/releases/latest"

say()  { printf '\033[36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required."

# Resolve an asset download URL by pattern (no version hardcoding, no jq needed).
asset_url() {
  curl -fsSL "$API" | grep -o "https://github.com/[^\"]*${1}\"" | tr -d '"' | head -1
}

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64)  PAT="aarch64.app.tar.gz" ;;
      x86_64) PAT="x64.app.tar.gz" ;;
      *) die "Unsupported macOS architecture: $ARCH" ;;
    esac
    URL="$(asset_url "$PAT")"
    [ -n "$URL" ] || die "Could not find the asset ($PAT) in the latest release."

    say "Downloading DevFlow for macOS ($ARCH)..."
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    curl -fSL# "$URL" -o "$TMP/devflow.app.tar.gz"
    tar -xzf "$TMP/devflow.app.tar.gz" -C "$TMP"
    APP="$(find "$TMP" -maxdepth 1 -name '*.app' | head -1)"
    [ -n "$APP" ] || die "No .app was found inside the package."

    # Pick a writable destination: /Applications if possible, otherwise ~/Applications.
    if [ -w /Applications ] || [ "$(id -u)" = "0" ]; then DEST="/Applications"; else DEST="$HOME/Applications"; mkdir -p "$DEST"; fi
    rm -rf "$DEST/DevFlow.app"
    mv "$APP" "$DEST/DevFlow.app"

    say "Enabling the app (Gatekeeper)..."
    xattr -dr com.apple.quarantine "$DEST/DevFlow.app" 2>/dev/null || true
    codesign --force --deep --sign - "$DEST/DevFlow.app" >/dev/null 2>&1 || true

    ok "✓ DevFlow installed at $DEST/DevFlow.app"
    ok "  Open it from Launchpad, or run:  open \"$DEST/DevFlow.app\""
    ;;

  Linux)
    URL="$(asset_url "amd64.AppImage")"
    [ -n "$URL" ] || die "Could not find the AppImage in the latest release."
    DEST="${XDG_BIN_HOME:-$HOME/.local/bin}"
    mkdir -p "$DEST"
    say "Downloading DevFlow (AppImage)..."
    curl -fSL# "$URL" -o "$DEST/DevFlow.AppImage"
    chmod +x "$DEST/DevFlow.AppImage"
    ok "✓ DevFlow installed at $DEST/DevFlow.AppImage"
    case ":$PATH:" in
      *":$DEST:"*) ok "  Run:  DevFlow.AppImage" ;;
      *) ok "  Run it with:  $DEST/DevFlow.AppImage   (or add $DEST to your PATH)" ;;
    esac
    ;;

  *)
    die "This script does not support $OS. On Windows, download the .exe from https://github.com/${REPO}/releases/latest"
    ;;
esac
