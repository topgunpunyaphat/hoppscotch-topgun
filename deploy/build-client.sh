#!/usr/bin/env bash
# Build a desktop client that is already pointed at our server.
#
# The point: on a fresh machine the app has no saved instances, so
# `loadRecent()` falls through to `loadVendoredInstance()` and runs the bundle
# compiled into the binary. Build that bundle with the production .env and the
# app talks to our backend the moment it opens — no "Add an instance" step.
#
#   TAURI_SIGNING_PRIVATE_KEY=~/.tauri/topgun.key \
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD=... \
#   ./deploy/build-client.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
DESKTOP="$ROOT/packages/hoppscotch-desktop"
WEB="$ROOT/packages/hoppscotch-selfhost-web"
BUNDLER="$DESKTOP/crates/webapp-bundler"

[[ -f "$ENV_FILE" ]] || { echo "No env file at $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a

: "${VITE_BACKEND_GQL_URL:?VITE_BACKEND_GQL_URL missing — the client would be built pointing nowhere}"

case "$VITE_BACKEND_GQL_URL" in
  *localhost*|*127.0.0.1*)
    echo "VITE_BACKEND_GQL_URL is $VITE_BACKEND_GQL_URL" >&2
    echo "A client built from this would only work on the build machine." >&2
    echo "Point it at the real hostname before building." >&2
    exit 1
    ;;
esac

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  echo "WARNING: TAURI_SIGNING_PRIVATE_KEY is unset — the build will produce"
  echo "installers but no update signature, so auto-update will not work."
  echo
fi

echo "==> Backend:  $VITE_BACKEND_GQL_URL"
echo "==> Building web app"
pnpm --dir "$WEB" install
pnpm --dir "$WEB" generate

echo "==> Bundling web app into the client"
cargo build --release --manifest-path "$BUNDLER/Cargo.toml"
"$BUNDLER/target/release/webapp-bundler" \
  --input "$WEB/dist" \
  --output "$DESKTOP/bundle.zip" \
  --manifest "$DESKTOP/manifest.json"

echo "==> Building desktop app"
pnpm --dir "$DESKTOP" install
pnpm --dir "$DESKTOP" tauri build

echo
echo "Artifacts:"
find "$DESKTOP/src-tauri/target/release/bundle" \
  \( -name '*.dmg' -o -name '*.msi' -o -name '*.AppImage' -o -name '*.deb' -o -name '*.sig' \) \
  -maxdepth 2 -exec ls -lh {} \; 2>/dev/null || true
