#!/bin/bash
# Ensure local Rust matches rust-toolchain.toml and optional build targets exist.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN_FILE="${PROJECT_DIR}/rust-toolchain.toml"

if [ ! -f "$TOOLCHAIN_FILE" ]; then
    echo "rust-toolchain.toml not found: $TOOLCHAIN_FILE" >&2
    exit 1
fi

if ! command -v rustup >/dev/null 2>&1; then
    echo "rustup is required. Install Rust via https://rustup.rs, then rerun setup/build." >&2
    exit 1
fi

RUST_TOOLCHAIN="$(sed -nE 's/^channel[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$TOOLCHAIN_FILE" | head -1)"
if [ -z "$RUST_TOOLCHAIN" ]; then
    echo "Cannot parse Rust channel from rust-toolchain.toml" >&2
    exit 1
fi

COMPONENTS_LINE="$(sed -nE 's/^components[[:space:]]*=[[:space:]]*\[(.*)\].*/\1/p' "$TOOLCHAIN_FILE" | head -1)"
if [ -n "$COMPONENTS_LINE" ]; then
    COMPONENTS=()
    while IFS= read -r component; do
        [ -n "$component" ] && COMPONENTS+=("$component")
    done < <(printf '%s\n' "$COMPONENTS_LINE" | tr ',' '\n' | tr -d ' "')
else
    COMPONENTS=("rustfmt" "clippy")
fi

echo "  Rust toolchain: ${RUST_TOOLCHAIN}"
rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal

for component in "${COMPONENTS[@]}"; do
    echo "  Rust component: ${component}"
    rustup component add "$component" --toolchain "$RUST_TOOLCHAIN"
done

for target in "$@"; do
    [ -z "$target" ] && continue
    echo "  Rust target: ${target}"
    rustup target add "$target" --toolchain "$RUST_TOOLCHAIN"
done

cargo "+${RUST_TOOLCHAIN}" --version
if printf '%s\n' "${COMPONENTS[@]}" | grep -qx "rustfmt"; then
    rustfmt "+${RUST_TOOLCHAIN}" --version
fi
if printf '%s\n' "${COMPONENTS[@]}" | grep -qx "clippy"; then
    cargo "+${RUST_TOOLCHAIN}" clippy --version
fi

echo "  OK - Rust toolchain ready"
