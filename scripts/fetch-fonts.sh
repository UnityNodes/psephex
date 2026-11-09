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

fetch clash-display ClashDisplay-Variable.woff2 dbe4b338d40d727ba0f342228d3c53d5429995264cf031fd975f6265a57da662
fetch switzer Switzer-Variable.woff2 d1bf801ffb1a6096def70a7c532255722ad87d948b13a8a586e342f7091f8ee4
echo "fonts ready in $DEST"
