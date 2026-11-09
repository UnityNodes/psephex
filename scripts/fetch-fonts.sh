#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/web/public/fonts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fetch() {
  local slug="$1" file="$2" sha="$3"
  if [ -f "$DEST/$file" ] && echo "$sha  $DEST/$file" | sha256sum -c --status; then
    return
  fi
  curl -sSfL --proto '=https' --max-time 60 -o "$WORK/$slug.zip" "https://api.fontshare.com/v2/fonts/download/$slug"
  mkdir -p "$WORK/$slug"
  unzip -qo "$WORK/$slug.zip" -d "$WORK/$slug"
  local found
  found="$(find "$WORK/$slug" -type f -path '*/WEB/fonts/*' -name "$file" | head -1)"
  [ -n "$found" ] || { echo "fetch-fonts: $file not found in the $slug archive" >&2; exit 1; }
  echo "$sha  $found" | sha256sum -c --status || { echo "fetch-fonts: $file does not match the pinned sha256, check the new Fontshare release before updating the hash" >&2; exit 1; }
  mkdir -p "$DEST"
  install -m 644 "$found" "$DEST/$file"
}

fetch cabinet-grotesk CabinetGrotesk-Variable.woff2 f71103771c9e32406026b6ea46c7e57cb977d5884e70d0f1beeab91ab2c7abb6
fetch satoshi Satoshi-Variable.woff2 e739aff9b4d02c264341d6d4872edcda28e79373aeda936f659566a1cd3eb47f
echo "fonts ready in $DEST"
