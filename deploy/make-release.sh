#!/usr/bin/env bash
# Assemble a release directory the server can hand out: the installers people
# download, plus the latest.json the installed app polls for updates.
#
#   ./deploy/make-release.sh 26.8.2 ./release
#
# Serve the result at https://<host>/download/ and point the updater
# `endpoints` in src-tauri/tauri.conf.json at
# https://<host>/download/latest.json
set -euo pipefail

VERSION="${1:?usage: make-release.sh <version> [outdir]}"
OUT="${2:-./release}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT/packages/hoppscotch-desktop/src-tauri/target/release/bundle"

[[ -d "$BUNDLE" ]] || { echo "No build found. Run deploy/build-client.sh first." >&2; exit 1; }

mkdir -p "$OUT"

# The updater verifies the .sig against the pubkey in tauri.conf.json, so the
# archive and its signature must travel together and stay paired.
platforms=""
add_platform() {
  local key="$1" archive="$2"
  local sig="$archive.sig"
  [[ -f "$archive" ]] || return 0
  if [[ ! -f "$sig" ]]; then
    echo "  skip $key - no .sig (was TAURI_SIGNING_PRIVATE_KEY set during the build?)" >&2
    return 0
  fi
  if grep -q "^$key|" <<<"$platforms"; then
    echo "  skip $key - already collected from another build directory" >&2
    return 0
  fi
  cp "$archive" "$sig" "$OUT/"
  platforms+="$key|$(basename "$archive")|$(cat "$sig")"$'\n'
  echo "  + $key"
}

# macOS names its bundle identically whatever it was built for, so the arch has
# to come from the binary. Shipping an arm64 archive under darwin-x86_64 would
# hand Intel machines an update they cannot run.
# The bundle is named after productName, so it is discovered rather than
# hardcoded — renaming the product must not silently stop releases working.
macos_app() {
  find "$1/macos" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null
}

macos_key() {
  local app_dir
  app_dir=$(macos_app "$1")
  [[ -n "$app_dir" ]] || return 1
  local bin
  bin=$(find "$app_dir/Contents/MacOS" -maxdepth 1 -type f -perm -u+x -print -quit 2>/dev/null)
  [[ -n "$bin" ]] || return 1
  case "$(lipo -info "$bin" 2>/dev/null)" in
    *"arm64"*[!a-z]*x86_64*|*x86_64*[!a-z]*arm64*) echo "universal" ;;
    *arm64*)  echo "darwin-aarch64" ;;
    *x86_64*) echo "darwin-x86_64" ;;
    *)        return 1 ;;
  esac
}

collect_from() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0

  if key=$(macos_key "$dir"); then
    local archive="$(macos_app "$dir").tar.gz"
    if [[ "$key" == "universal" ]]; then
      # A universal binary serves both, so it is registered under each key.
      add_platform "darwin-aarch64" "$archive"
      add_platform "darwin-x86_64"  "$archive"
    else
      add_platform "$key" "$archive"
    fi
  fi

  for msi in "$dir"/msi/*.msi.zip; do add_platform "windows-x86_64" "$msi"; done
  for app in "$dir"/appimage/*.AppImage.tar.gz; do add_platform "linux-x86_64" "$app"; done
}

echo "Collecting update artifacts:"
# The host build, then any cross-compiled targets (tauri build --target <triple>
# writes to target/<triple>/release/bundle).
collect_from "$BUNDLE"
for d in "$ROOT"/packages/hoppscotch-desktop/src-tauri/target/*/release/bundle; do
  [[ "$d" == "$BUNDLE" ]] && continue
  collect_from "$d"
done

echo "Collecting installers:"
for f in \
  "$BUNDLE"/dmg/*.dmg "$BUNDLE"/msi/*.msi "$BUNDLE"/appimage/*.AppImage "$BUNDLE"/deb/*.deb \
  "$ROOT"/packages/hoppscotch-desktop/src-tauri/target/*/release/bundle/dmg/*.dmg \
  "$ROOT"/packages/hoppscotch-desktop/src-tauri/target/*/release/bundle/msi/*.msi \
  "$ROOT"/packages/hoppscotch-desktop/src-tauri/target/*/release/bundle/appimage/*.AppImage \
  "$ROOT"/packages/hoppscotch-desktop/src-tauri/target/*/release/bundle/deb/*.deb
do
  [[ -f "$f" ]] || continue
  cp -n "$f" "$OUT/" 2>/dev/null || true
  echo "  + $(basename "$f")"
done

BASE_URL="${BASE_URL:-https://REPLACE_ME/download}"
VERSION="$VERSION" BASE_URL="$BASE_URL" PLATFORMS="$platforms" \
NOTES="${NOTES:-Internal release $VERSION}" python3 - > "$OUT/latest.json" <<'PY'
import json, os, datetime

platforms = {}
for line in os.environ["PLATFORMS"].splitlines():
    if not line.strip():
        continue
    key, filename, signature = line.split("|", 2)
    platforms[key] = {
        "signature": signature,
        "url": f"{os.environ['BASE_URL']}/{filename}",
    }

print(json.dumps({
    "version": os.environ["VERSION"],
    "notes": os.environ["NOTES"],
    "pub_date": datetime.datetime.now(datetime.timezone.utc)
                  .isoformat(timespec="seconds").replace("+00:00", "Z"),
    "platforms": platforms,
}, indent=2))
PY

echo
echo "Wrote $OUT/latest.json"
if [[ "$BASE_URL" == *REPLACE_ME* ]]; then
  echo "Set BASE_URL to your download URL and re-run, or the URLs in latest.json"
  echo "will not resolve:  BASE_URL=https://apitool.example.com/download $0 $VERSION"
fi
