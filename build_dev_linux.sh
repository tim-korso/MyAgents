#!/bin/bash
# Same resource/build owner as release; debug builds disable automatic updates.
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
    ""|--build-only) ;;
    --help|-h) echo "Usage: ./build_dev_linux.sh [--build-only]"; exit 0 ;;
    *) echo "Usage: ./build_dev_linux.sh [--build-only]" >&2; exit 1 ;;
esac
if [ "$#" -gt 1 ]; then
    echo "Usage: ./build_dev_linux.sh [--build-only]" >&2
    exit 1
fi
"${PROJECT_DIR}/build_linux.sh" --debug
if [ "${1:-}" = "--build-only" ]; then exit 0; fi
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    echo "Build succeeded. Start the development executable from an Ubuntu desktop session."
    exit 0
fi
# Do not kill installed apps or other development sessions. The app's existing
# single-instance owner decides whether a second process may run.
cd "$PROJECT_DIR"
exec "${PROJECT_DIR}/src-tauri/target/x86_64-unknown-linux-gnu/debug/myagents"
