#!/bin/bash
# Ubuntu 24.04 x64 setup/dev/release resource owner. See specs/guides/linux_build_guide.md.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="x86_64-unknown-linux-gnu"
MODE="release"
case "${1:-}" in
    ""|"$TARGET") ;;
    --debug) MODE="debug" ;;
    --prepare) MODE="prepare" ;;
    --install-deps) MODE="install-deps" ;;
    --check-system-deps) MODE="check-system-deps" ;;
    --help|-h)
        echo "Usage: ./build_linux.sh [x86_64-unknown-linux-gnu | --debug | --prepare | --install-deps | --check-system-deps]"
        echo "Ubuntu 24.04 x64 only. Default: .deb; --debug: runnable development binary."
        exit 0 ;;
    *) echo "Unsupported target/option: $1. Only Ubuntu 24.04 x64 is supported." >&2; exit 1 ;;
esac
if [ "$#" -gt 1 ]; then
    echo "Pass only one target or option; see --help." >&2
    exit 1
fi

# Reject wrong hosts before reading .env, installing tools or touching staging.
if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
    echo "Build on Ubuntu 24.04 x64 (Linux VM/container or GitHub Actions). Cross-compilation is not supported." >&2
    exit 1
fi
if [ ! -r /etc/os-release ]; then
    echo "Cannot identify Ubuntu: /etc/os-release is missing." >&2
    exit 1
fi
# shellcheck source=/dev/null
. /etc/os-release
if [ "${ID:-}" != "ubuntu" ] || [ "${VERSION_ID:-}" != "24.04" ]; then
    echo "This build targets Ubuntu 24.04; detected ${PRETTY_NAME:-unknown OS}." >&2
    exit 1
fi

# Shared by setup, local preflight and CI. cpal links PipeWire/ALSA;
# the desktop stack links xdo, and bindgen needs a discoverable libclang.
SYSTEM_PACKAGES=(
    build-essential cmake clang libclang-dev pkg-config curl ca-certificates
    git file xz-utils unzip libssl-dev libgtk-3-dev libayatana-appindicator3-dev
    librsvg2-dev libwebkit2gtk-4.1-dev libxdo-dev libpipewire-0.3-dev libasound2-dev
)
if [ "$MODE" = "install-deps" ]; then
    APT=(apt-get)
    if [ "$EUID" -ne 0 ]; then APT=(sudo apt-get); fi
    "${APT[@]}" update
    "${APT[@]}" install -y --no-install-recommends "${SYSTEM_PACKAGES[@]}"
fi
missing=()
for pkg in "${SYSTEM_PACKAGES[@]}"; do
    if [ "$(dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null || true)" != "install ok installed" ]; then
        missing+=("$pkg")
    fi
done
if [ "${#missing[@]}" -gt 0 ]; then
    echo "Missing build packages: ${missing[*]}" >&2
    echo "Run ./build_linux.sh --install-deps, then retry." >&2
    exit 1
fi
if [ "$MODE" = "install-deps" ] || [ "$MODE" = "check-system-deps" ]; then
    echo "Ubuntu 24.04 x64 system build dependencies are ready."
    exit 0
fi

cd "$PROJECT_DIR"
if [ -f "${PROJECT_DIR}/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    source "${PROJECT_DIR}/.env"
    set +a
fi
for cmd in node npm rustc cargo rustup; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Missing $cmd. Install Node.js 24 and Rust via rustup; see the Linux build guide." >&2
        exit 1
    fi
done
node --input-type=module -e '
    import fs from "node:fs";
    if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Build requires Node.js 24");
    const pkg = JSON.parse(fs.readFileSync("package.json"));
    const tauri = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json"));
    const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version = "([^"]+)"/m)?.[1];
    if (pkg.version !== tauri.version || pkg.version !== cargo) throw new Error("Version mismatch; run node scripts/sync-version.js");
'
PKG_VERSION=$(node -p 'require("./package.json").version')
"${PROJECT_DIR}/scripts/ensure_rust_toolchain.sh" "$TARGET"
node "${PROJECT_DIR}/scripts/prepare-native-inference.mjs" "$TARGET" --check-prerequisites
if [ "$MODE" != "prepare" ]; then npm run typecheck; fi

# Setup and both builds use real resources, never placeholders or another
# target's staging. The native preparation owner retains its verified cache.
npm run build:tsx-runtime -- linux x64
"${PROJECT_DIR}/scripts/download_nodejs.sh"
SDK_SOURCE="${PROJECT_DIR}/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude"
if [ ! -x "$SDK_SOURCE" ]; then
    echo "Missing Linux x64 Claude SDK executable; run npm ci on this host." >&2
    exit 1
fi
rm -rf "${PROJECT_DIR}/src-tauri/resources/claude-agent-sdk"
mkdir -p "${PROJECT_DIR}/src-tauri/resources/claude-agent-sdk"
cp "$SDK_SOURCE" "${PROJECT_DIR}/src-tauri/resources/claude-agent-sdk/claude"
chmod +x "${PROJECT_DIR}/src-tauri/resources/claude-agent-sdk/claude"

npm run build:sharp-runtime -- linux x64
# Keep the installed application's bundled-Node load check as well.
"${PROJECT_DIR}/src-tauri/resources/nodejs/bin/node" -e 'require(process.argv[1])' "${PROJECT_DIR}/src-tauri/resources/sharp-runtime/node_modules/sharp"

node "${PROJECT_DIR}/scripts/prepare-native-inference.mjs" "$TARGET"
node "${PROJECT_DIR}/scripts/prepare-cuse-bundle.mjs" "$TARGET"
# Native preparation uses private staging permissions. A system-installed deb
# is root-owned, so its resource manifests/models must be readable by app users.
# Only normalize the published projections; the native caches remain private.
chmod -R a+rX "${PROJECT_DIR}/src-tauri/resources/document-processing" \
    "${PROJECT_DIR}/src-tauri/resources/speech-inference"
if [ "$MODE" = "prepare" ]; then
    # tauri dev does not invoke beforeBuildCommand: prepare its resource paths now.
    npm run build:server
    npm run build:bridge
    npm run build:cli
    echo "Linux development resources ready; run ./build_dev_linux.sh or npm run tauri:dev."
    exit 0
fi
if [ "$MODE" = "debug" ]; then
    npm run tauri:build -- --target "$TARGET" --debug --no-bundle
    APP="${PROJECT_DIR}/src-tauri/target/${TARGET}/debug/myagents"
    test -x "$APP"
    echo "Development executable (keep this checkout): $APP"
    exit 0
fi
npm run tauri:build -- --target "$TARGET" --bundles deb
BUNDLE_DIR="${PROJECT_DIR}/src-tauri/target/${TARGET}/release/bundle/deb"
shopt -s nullglob
DEB_PATHS=("$BUNDLE_DIR"/*_"${PKG_VERSION}"_amd64.deb)
if [ "${#DEB_PATHS[@]}" -ne 1 ]; then
    echo "Expected exactly one ${PKG_VERSION} amd64 deb under $BUNDLE_DIR." >&2
    exit 1
fi
dpkg-deb --info "${DEB_PATHS[0]}"
sha256sum "${DEB_PATHS[0]}"
echo "Installer: ${DEB_PATHS[0]}"
echo "Install with: sudo apt install '${DEB_PATHS[0]}'"
